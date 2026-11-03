import { normalizeText, tidyLine } from "../clean";
import { type BlockSink, MAX_MILLIS, ParseFailure } from "../types";
import { type AbortHandle, openPdf, toFailure } from "./extract";
import { bodyStats, removeFurniture } from "./furniture";
import { buildPageLines, type PageLines } from "./layout";
import { buildParagraphs } from "./paragraphs";

/**
 * PDF to paragraph blocks, in the parser worker. This module is loaded on demand, and so is
 * pdf.js behind it, so a reader who never opens a PDF never pays for either.
 */

/** A file can claim any number of pages. This many is far beyond a real book. */
const MAX_PAGES = 20_000;
/** Characters of text across the whole file. */
const MAX_CHARS = 60_000_000;
/** A run of unreadable pages this long means the rest of the page tree is not real. */
const MAX_UNREADABLE_IN_A_ROW = 3;
/** A scan carries almost no text. Below this many characters per page, look for pictures. */
const SCAN_CHARS_PER_PAGE = 25;
const SCAN_PAGES_CHECKED = 3;

const LIGATURES: Record<string, string> = {
	"\ufb00": "ff",
	"\ufb01": "fi",
	"\ufb02": "fl",
	"\ufb03": "ffi",
	"\ufb04": "ffl",
	"\ufb05": "st",
	"\ufb06": "st",
};

/** Text as pdf.js gives it, made fit to read: ligatures spelled out, private-use glyphs gone. */
function tidy(text: string): string {
	return tidyLine(
		normalizeText(text)
			.replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c] ?? c)
			.replace(/\uf0b7/g, "\u2022")
			.replace(/[\ue000-\uf8ff]/g, ""),
	);
}

export type PdfResult = { title: string | null };

export type PdfOptions = {
	/** How long to spend before giving up, in milliseconds. */
	timeBudgetMs?: number;
};

const TOO_SLOW = "This PDF is taking too long to read, so Speeedy stopped.";

/**
 * Read `bytes` as a PDF and push its paragraphs into `sink`. Throws a ParseFailure for a
 * locked file (`drm`), a scan (`scanned-pdf`), a damaged file or one past a ceiling.
 *
 * The clock runs from the start. When it runs out, pdf.js's worker is killed, which stops
 * even a file built to keep it busy for minutes.
 */
export async function pdfToBlocks(
	bytes: Uint8Array,
	sink: BlockSink,
	options: PdfOptions = {},
): Promise<PdfResult> {
	const budget = options.timeBudgetMs ?? MAX_MILLIS;
	const handle: AbortHandle = { abort: () => undefined };
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			handle.abort();
			reject(new ParseFailure("too-big", TOO_SLOW));
		}, budget);
	});
	const work = readPdf(bytes, sink, handle, Date.now() + budget);
	// If the clock wins, the reading ends later with an error nobody is waiting for.
	work.catch(() => undefined);
	try {
		return await Promise.race([work, expired]);
	} finally {
		clearTimeout(timer);
	}
}

async function readPdf(
	bytes: Uint8Array,
	sink: BlockSink,
	handle: AbortHandle,
	deadline: number,
): Promise<PdfResult> {
	const source = await openPdf(bytes, handle);
	try {
		const pages: PageLines[] = [];
		const numbers: number[] = [];
		let chars = 0;
		let unreadable = 0;
		for (let number = 1; number <= source.pageCount; number++) {
			if (number > MAX_PAGES) {
				throw new ParseFailure(
					"too-big",
					"This PDF has more pages than Speeedy can open.",
				);
			}
			if (Date.now() > deadline) throw new ParseFailure("too-big", TOO_SLOW);
			const raw = await source.page(number);
			if (!raw) {
				if (++unreadable >= MAX_UNREADABLE_IN_A_ROW) break;
				continue;
			}
			unreadable = 0;
			const page = buildPageLines(raw.items, raw.view);
			chars += page.chars;
			if (chars > MAX_CHARS) {
				throw new ParseFailure(
					"too-big",
					"This PDF has more text than Speeedy can open.",
				);
			}
			pages.push(page);
			numbers.push(number);
		}
		if (pages.length === 0 && source.pageCount > 0) {
			throw toFailure(new Error("no readable pages"));
		}

		if (chars < SCAN_CHARS_PER_PAGE * pages.length) {
			const lightest = pages
				.map((page, index) => ({
					chars: page.chars,
					number: numbers[index] ?? 1,
				}))
				.sort((a, b) => a.chars - b.chars)
				.slice(0, SCAN_PAGES_CHECKED);
			for (const { number } of lightest) {
				if (await source.hasImages(number)) {
					throw new ParseFailure(
						"scanned-pdf",
						"This PDF is a scan: it holds pictures of pages, not text. Paste the text instead.",
					);
				}
			}
		}

		const stats = bodyStats(pages);
		const body = removeFurniture(pages, stats);
		for (const paragraph of buildParagraphs(body, stats)) {
			const text = tidy(paragraph);
			if (text !== "") sink.push({ kind: "paragraph", text, spans: [] });
		}
		return { title: source.title };
	} finally {
		await source.close();
	}
}
