/// <reference path="./modules.d.ts" />
/**
 * The only file that touches pdf.js.
 *
 * pdf.js does its heavy lifting (decompressing streams, interpreting page content) in a Web
 * Worker of its own. Here that worker is a nested worker of the parser worker, one per file,
 * so it can be killed. A small hostile file can make pdf.js work for minutes, and nothing
 * running on the same thread could stop it; a nested worker can be terminated while the parser
 * worker watches the clock.
 *
 * pdf.js cannot start that worker itself from inside a worker (it reads `window`), so the
 * worker is created here and handed over as a port.
 *
 * Where a nested worker is not available (Node, an old browser), pdf.js runs on the same
 * thread instead: importing `pdf.worker.mjs` registers its handler on `globalThis.pdfjsWorker`
 * and pdf.js finds it there. That path cannot be interrupted.
 *
 * Everything is imported on demand, so a reader who never opens a PDF never downloads any of it.
 */
import { clip, normalizeText, tidyLine } from "../clean";
import { ParseFailure } from "../types";
import type { RawItem } from "./layout";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const LOAD_FAILED =
	"Speeedy could not load its PDF reader. Check your connection and try again.";

/** Text pieces on one page. A page needing more than this is hostile, not a book. */
const MAX_ITEMS_PER_PAGE = 250_000;

export type PdfPageText = { items: RawItem[]; view: number[] };

/** Filled in by `openPdf` as soon as there is something to kill. */
export type AbortHandle = { abort: () => void };

export type PdfSource = {
	pageCount: number;
	title: string | null;
	/** The text of page `number` (from 1), or null when that page cannot be read. */
	page(number: number): Promise<PdfPageText | null>;
	/** Does the page draw any image? Used to tell a scan from a page with little text. */
	hasImages(number: number): Promise<boolean>;
	close(): Promise<void>;
};

/** `workerUrl` is where pdf.js's worker file is served, or null when it runs on this thread. */
type Loaded = { pdfjs: PdfJs; workerUrl: string | null };

let loading: Promise<Loaded> | null = null;

function loadPdfJs(): Promise<Loaded> {
	if (!loading) {
		loading = (async () => {
			const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
			if (typeof Worker === "function") {
				const { default: url } = await import(
					"pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"
				);
				pdfjs.GlobalWorkerOptions.workerSrc = url;
				return { pdfjs, workerUrl: url };
			}
			await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
			return { pdfjs, workerUrl: null };
		})();
		// A failed download must not be remembered: the next file gets a fresh attempt.
		loading.catch(() => {
			loading = null;
		});
	}
	return loading;
}

const nameOf = (error: unknown): string =>
	typeof error === "object" && error !== null && "name" in error
		? String((error as { name: unknown }).name)
		: "";

const messageOf = (error: unknown): string =>
	typeof error === "object" && error !== null && "message" in error
		? String((error as { message: unknown }).message)
		: "";

/** Turn anything pdf.js throws into a typed failure. */
export function toFailure(error: unknown): ParseFailure {
	if (error instanceof ParseFailure) return error;
	if (nameOf(error) === "PasswordException") {
		return new ParseFailure(
			"drm",
			"This PDF is locked with a password, and Speeedy cannot open locked files.",
		);
	}
	// A lock pdf.js has no key for: a certificate, a vendor's own scheme.
	if (/encryption|key length/i.test(messageOf(error))) {
		return new ParseFailure(
			"drm",
			"This PDF is protected, and Speeedy cannot open protected files.",
		);
	}
	if (
		error instanceof RangeError ||
		/allocation|out of memory|array length|too large/i.test(messageOf(error))
	) {
		return new ParseFailure(
			"too-big",
			"This PDF is too large for Speeedy to open.",
		);
	}
	return new ParseFailure(
		"unsupported",
		"This PDF is damaged or is not a PDF, so Speeedy could not read it.",
	);
}

function cleanTitle(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const title = clip(tidyLine(normalizeText(value.slice(0, 2000))), 200);
	if (title.length < 2) return null;
	// Titles that word processors fill in by themselves say nothing about the document.
	if (/^(untitled|microsoft word\b|document\d*$)/i.test(title)) return null;
	if (/\.(docx?|tex|odt|rtf|indd|pages|pdf)$/i.test(title)) return null;
	return title;
}

/** Open a PDF. Throws a ParseFailure (locked, damaged, not a PDF, or the code would not load). */
export async function openPdf(
	bytes: Uint8Array,
	handle: AbortHandle,
): Promise<PdfSource> {
	let pdfjs: PdfJs;
	let workerUrl: string | null;
	try {
		({ pdfjs, workerUrl } = await loadPdfJs());
	} catch {
		throw new ParseFailure("unsupported", LOAD_FAILED);
	}
	// One worker per file, so that abandoning the file can kill it.
	let port: Worker | undefined;
	let worker: InstanceType<PdfJs["PDFWorker"]> | undefined;
	let broken: Promise<never> | undefined;
	if (workerUrl) {
		try {
			const started = new Worker(workerUrl, { type: "module" });
			port = started;
			worker = new pdfjs.PDFWorker({ port: started as never });
			broken = new Promise<never>((_, reject) => {
				const fail = () => reject(new ParseFailure("unsupported", LOAD_FAILED));
				started.addEventListener("error", fail, { once: true });
				started.addEventListener("messageerror", fail, { once: true });
			});
			broken.catch(() => undefined);
		} catch {
			port?.terminate();
			port = undefined;
			worker = undefined;
		}
	}
	const abort = () => {
		try {
			worker?.destroy();
			port?.terminate();
		} catch {
			// Already gone.
		}
	};
	handle.abort = abort;
	// pdf.js takes ownership of the bytes it is given, so it gets its own copy.
	const task = pdfjs.getDocument({
		worker,
		data: new Uint8Array(bytes),
		verbosity: 0,
		useSystemFonts: false,
		disableFontFace: true,
		enableXfa: false,
		stopAtErrors: false,
		useWorkerFetch: false,
		disableAutoFetch: true,
		disableStream: true,
		disableRange: true,
		useWasm: false,
		isOffscreenCanvasSupported: false,
		isImageDecoderSupported: false,
	});
	let doc: Awaited<typeof task.promise>;
	try {
		doc = await (broken ? Promise.race([task.promise, broken]) : task.promise);
	} catch (error) {
		await task.destroy().catch(() => undefined);
		abort();
		throw toFailure(error);
	}

	let title: string | null = null;
	try {
		const meta = await doc.getMetadata();
		title = cleanTitle((meta.info as { Title?: unknown } | undefined)?.Title);
	} catch {
		// A broken info dictionary costs the title and nothing else.
	}

	const IMAGE_OPS = [
		pdfjs.OPS.paintImageXObject,
		pdfjs.OPS.paintImageMaskXObject,
		pdfjs.OPS.paintInlineImageXObject,
		pdfjs.OPS.paintImageXObjectRepeat,
		pdfjs.OPS.paintImageMaskXObjectGroup,
		pdfjs.OPS.paintInlineImageXObjectGroup,
	].filter((op): op is number => typeof op === "number");

	return {
		pageCount: Number.isInteger(doc.numPages) ? doc.numPages : 0,
		title,
		async page(number) {
			let reader: ReadableStreamDefaultReader<{ items: unknown[] }> | null =
				null;
			try {
				const page = await doc.getPage(number);
				reader = page
					.streamTextContent({ includeMarkedContent: false })
					.getReader() as ReadableStreamDefaultReader<{ items: unknown[] }>;
				const items: RawItem[] = [];
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					for (const item of value.items) {
						const raw = item as Partial<RawItem>;
						if (typeof raw.str !== "string") continue;
						items.push({
							str: raw.str,
							transform: raw.transform as number[],
							width: raw.width as number,
							fontName: raw.fontName as string,
							dir: raw.dir,
						});
					}
					if (items.length > MAX_ITEMS_PER_PAGE) {
						throw new ParseFailure(
							"too-big",
							"A page of this PDF has more text pieces than Speeedy can open.",
						);
					}
				}
				const view = Array.isArray(page.view) ? [...page.view] : [];
				page.cleanup();
				return { items, view };
			} catch (error) {
				if (error instanceof ParseFailure) throw error;
				if (nameOf(error) === "PasswordException") throw toFailure(error);
				return null;
			} finally {
				await reader?.cancel().catch(() => undefined);
			}
		},
		async hasImages(number) {
			try {
				const page = await doc.getPage(number);
				const list = await page.getOperatorList();
				page.cleanup();
				return list.fnArray.some((op) => IMAGE_OPS.includes(op));
			} catch {
				return false;
			}
		},
		async close() {
			await task.destroy().catch(() => undefined);
			abort();
		},
	};
}
