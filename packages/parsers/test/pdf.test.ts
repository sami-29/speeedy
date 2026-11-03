import { describe, expect, it } from "vitest";
import { type ParseOutcome, parse } from "../src/index";
import {
	expectError,
	expectSuccess,
	expectWellFormed,
	textsOf,
} from "./helpers";
import {
	buildPdf,
	type PdfOptions,
	type PdfPage,
	type TextRun,
} from "./pdf-builder";

const open = (options: PdfOptions, name = "doc.pdf"): Promise<ParseOutcome> =>
	parse(buildPdf(options), name);

/** Greedy word wrap on character count; Helvetica 11 pt at 88 characters is about 460 pt. */
function wrap(text: string, chars = 88): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line !== "" && line.length + 1 + word.length > chars) {
			lines.push(line);
			line = word;
		} else {
			line = line === "" ? word : `${line} ${word}`;
		}
	}
	if (line !== "") lines.push(line);
	return lines;
}

type Flow = {
	x?: number;
	top?: number;
	pitch?: number;
	size?: number;
	chars?: number;
	/** Extra space between paragraphs. */
	gap?: number;
	/** First-line indent. */
	indent?: number;
};

/** Lay paragraphs out top to bottom. Returns the runs and the next free baseline. */
function flow(
	paragraphs: string[],
	options: Flow = {},
): { runs: TextRun[]; next: number } {
	const {
		x = 72,
		pitch = 14,
		size = 11,
		chars = 88,
		gap = 0,
		indent = 0,
	} = options;
	let y = options.top ?? 700;
	const runs: TextRun[] = [];
	for (const paragraph of paragraphs) {
		wrap(paragraph, chars).forEach((text, index) => {
			runs.push({ x: index === 0 ? x + indent : x, y, text, size });
			y -= pitch;
		});
		y -= gap;
	}
	return { runs, next: y };
}

/** Explicit lines, one run each, for tests that need a line to end in a given place. */
function rows(
	texts: string[],
	options: { x?: number; top?: number; pitch?: number; size?: number } = {},
): TextRun[] {
	const { x = 72, top = 700, pitch = 14, size = 11 } = options;
	return texts.map((text, index) => ({
		x,
		y: top - index * pitch,
		text,
		size,
	}));
}

const page = (runs: TextRun[], extra: Partial<PdfPage> = {}): PdfPage => ({
	runs,
	...extra,
});

/** A digit-free tag, so page text differs between pages even after digits are ignored. */
const alpha = (n: number): string =>
	n
		.toString(26)
		.replace(/\d/g, (digit) => String.fromCharCode(113 + Number(digit)));

const P1 =
	"The committee met on Tuesday to review the proposal and to decide how the remaining budget should be spent over the coming year";
const P2 =
	"Nobody objected to the schedule, although several members asked for more time to read the supporting documents before the vote";
const P3 =
	"In the afternoon the group walked to the river and talked about everything except the meeting that had just finished";

describe("pdf: paragraphs from line geometry", () => {
	it("reads one wrapped paragraph as one block with single spaces", async () => {
		const { runs } = flow([P1]);
		const outcome = await open({ pages: [page(runs)] });
		expect(textsOf(outcome)).toEqual([P1]);
		const result = expectSuccess(outcome);
		expect(result.format).toBe("pdf");
		expect(result.encoding).toBeNull();
		expect(result.title).toBe("doc");
	});

	it("starts a new paragraph where extra vertical space appears", async () => {
		const { runs } = flow([P1, P2, P3], { gap: 10 });
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([P1, P2, P3]);
	});

	it("starts a new paragraph at a first-line indent with no extra space", async () => {
		const { runs } = flow([P1, P2, P3], { indent: 20 });
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([P1, P2, P3]);
	});

	it("starts a new paragraph after a short line that ends a sentence", async () => {
		const runs = rows([
			"The first paragraph runs for a couple of lines so that the line before the end is full",
			"and then it stops here.",
			"The second paragraph begins at the left margin with no gap and no indent at all, so only",
			"the short line above can tell the reader that one paragraph ended.",
		]);
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([
			"The first paragraph runs for a couple of lines so that the line before the end is full and then it stops here.",
			"The second paragraph begins at the left margin with no gap and no indent at all, so only the short line above can tell the reader that one paragraph ended.",
		]);
	});

	it("keeps ragged lines of one paragraph together", async () => {
		const runs = rows([
			"A ragged paragraph has lines of different lengths, but none of them is short enough",
			"to end it. This one is a bit shorter than the others in the same paragraph, which",
			"is still fine. Nothing here ends the paragraph until the very last line of the page.",
		]);
		expect(textsOf(await open({ pages: [page(runs)] }))).toHaveLength(1);
	});

	it("keeps a hanging indent inside one paragraph", async () => {
		const runs: TextRun[] = [
			{
				x: 72,
				y: 700,
				text: "Smith, J. (2019). A long reference title that wraps onto a second line because it",
				size: 11,
			},
			{
				x: 92,
				y: 686,
				text: "does not fit, with the journal name and the volume number following after.",
				size: 11,
			},
		];
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([
			"Smith, J. (2019). A long reference title that wraps onto a second line because it does not fit, with the journal name and the volume number following after.",
		]);
	});

	it("joins a paragraph that runs across a page break", async () => {
		const first = rows(
			[
				"A sentence that goes on and on and finally reaches the bottom of the page without any",
				"punctuation to stop it, so the reader has to keep going and cross over to the",
			],
			{ top: 100 },
		);
		const second = rows([
			"next page where the same sentence finally ends. A new thought follows here.",
		]);
		const outcome = await open({ pages: [page(first), page(second)] });
		expect(textsOf(outcome)).toEqual([
			"A sentence that goes on and on and finally reaches the bottom of the page without any punctuation to stop it, so the reader has to keep going and cross over to the next page where the same sentence finally ends. A new thought follows here.",
		]);
	});

	it("keeps paragraphs apart at a page break when the first ended", async () => {
		const first = rows(
			[
				"The first page ends with a complete thought that fills the whole line to the margin.",
				"And this is the end of it.",
			],
			{ top: 100 },
		);
		const second = rows([
			"The second page starts a fresh paragraph with a capital letter after a full stop here.",
		]);
		const outcome = await open({ pages: [page(first), page(second)] });
		expect(textsOf(outcome)).toHaveLength(2);
	});

	it("starts a paragraph at a bullet or a number", async () => {
		const runs = rows([
			"The list below covers the three things we agreed on during the long meeting:",
			"• buy the tickets before the end of the week",
			"• book a room that fits at least ten people",
			"1. Send the notes to everyone who attended the meeting on Tuesday afternoon",
		]);
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([
			"The list below covers the three things we agreed on during the long meeting:",
			"• buy the tickets before the end of the week",
			"• book a room that fits at least ten people",
			"1. Send the notes to everyone who attended the meeting on Tuesday afternoon",
		]);
	});

	it("joins pieces on one baseline that sit far apart", async () => {
		const runs: TextRun[] = [
			{ x: 72, y: 700, text: "Chapter one", size: 11 },
			{ x: 400, y: 700, text: "page nine", size: 11 },
		];
		const outcome = await open({ pages: [page(runs)] });
		expect(textsOf(outcome).join(" ")).toBe("Chapter one page nine");
	});

	it("inserts a space between words that arrive as separate pieces", async () => {
		const runs: TextRun[] = [
			{ x: 72, y: 700, text: "Hello", size: 11 },
			// Helvetica 11 pt: "Hello" is 25.06 wide, "world" 26.28, a space 3.06.
			{ x: 100.12, y: 700, text: "world", size: 11 },
			{ x: 129.46, y: 700, text: "again", size: 11 },
		];
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([
			"Hello world again",
		]);
	});
});

describe("pdf: dehyphenation", () => {
	const joinedFor = async (lines: string[]) =>
		textsOf(await open({ pages: [page(rows(lines))] }));

	it("joins a word split across two lines", async () => {
		expect(
			await joinedFor([
				"The new building includes an exam-",
				"ple of a roof that is also a garden for the people who live there.",
			]),
		).toEqual([
			"The new building includes an example of a roof that is also a garden for the people who live there.",
		]);
	});

	it("keeps a real compound whose second half is lower case when the stem is a known head", async () => {
		expect(
			await joinedFor([
				"It is a well-",
				"known result that readers with practice skim ahead of the words they are reading.",
			]),
		).toEqual([
			"It is a well-known result that readers with practice skim ahead of the words they are reading.",
		]);
		expect(
			await joinedFor([
				"The self-",
				"paced mode lets the reader choose how quickly the words appear on the screen today.",
			]),
		).toEqual([
			"The self-paced mode lets the reader choose how quickly the words appear on the screen today.",
		]);
	});

	it("keeps a hyphen before a capital letter or a digit", async () => {
		expect(
			await joinedFor([
				"The play was written by Jean-",
				"Paul and then rewritten twice before the opening night in the old theatre.",
			]),
		).toEqual([
			"The play was written by Jean-Paul and then rewritten twice before the opening night in the old theatre.",
		]);
		expect(
			await joinedFor([
				"The survey covered the years 1990-",
				"2000 in nine different regions and was repeated by a second team in the same years.",
			]),
		).toEqual([
			"The survey covered the years 1990-2000 in nine different regions and was repeated by a second team in the same years.",
		]);
	});

	it("keeps a suspended hyphen before a conjunction", async () => {
		expect(
			await joinedFor([
				"The pre-",
				"and post-war years were very different for the town and for the families there.",
			]),
		).toEqual([
			"The pre- and post-war years were very different for the town and for the families there.",
		]);
	});

	it("keeps a dash that stands alone at the end of a line", async () => {
		expect(
			await joinedFor([
				"The first part ended there -",
				"then the second part began after a long pause in the proceedings of the day.",
			]),
		).toEqual([
			"The first part ended there - then the second part began after a long pause in the proceedings of the day.",
		]);
	});

	it("follows the spelling used elsewhere in the same document", async () => {
		const hyphenated = rows([
			"The teams agreed to co-operate on the project and to share the results with everyone.",
			"We will co-",
			"operate again next year if the funding allows it and the schedule permits the work.",
		]);
		const text = textsOf(await open({ pages: [page(hyphenated)] }))[0] ?? "";
		expect(text).toContain("co-operate again next year");

		const closed = rows([
			"The teams agreed to cooperate on the project and to share the results with everyone.",
			"We will co-",
			"operate again next year if the funding allows it and the schedule permits the work.",
		]);
		const joined = textsOf(await open({ pages: [page(closed)] }))[0] ?? "";
		expect(joined).toContain("cooperate again next year");
		expect(joined).not.toContain("co-");
	});

	it("joins a split word across a page break", async () => {
		const first = rows(
			["The last line of the first page ends in the middle of an exam-"],
			{
				top: 100,
			},
		);
		const second = rows([
			"ple and the sentence goes on to the end of the second page.",
		]);
		expect(textsOf(await open({ pages: [page(first), page(second)] }))).toEqual(
			[
				"The last line of the first page ends in the middle of an example and the sentence goes on to the end of the second page.",
			],
		);
	});

	it("leaves a hyphen at the very end of a paragraph alone", async () => {
		const texts = await joinedFor(["The paragraph ends with a dash-"]);
		expect(texts).toEqual(["The paragraph ends with a dash-"]);
	});
});

const BODY_PAGE = (n: number): TextRun[] =>
	flow(
		[
			`Page ${n} body begins here and says something that only this page says, number ${n * 7}.`,
		],
		{
			chars: 120,
		},
	).runs;

function furnished(options: {
	pages: number;
	header?: (n: number) => string;
	footer?: (n: number) => string;
	size?: number;
}): PdfPage[] {
	const out: PdfPage[] = [];
	for (let n = 1; n <= options.pages; n++) {
		const runs = BODY_PAGE(n);
		if (options.header) {
			runs.push({
				x: 200,
				y: 750,
				text: options.header(n),
				size: options.size ?? 8,
			});
		}
		if (options.footer) {
			runs.push({
				x: 280,
				y: 40,
				text: options.footer(n),
				size: options.size ?? 8,
			});
		}
		out.push(page(runs));
	}
	return out;
}

const bodies = (pages: number) =>
	Array.from(
		{ length: pages },
		(_, i) =>
			`Page ${i + 1} body begins here and says something that only this page says, number ${(i + 1) * 7}.`,
	);

describe("pdf: headers, footers and page numbers", () => {
	it("removes a running head and a numbered footer that repeat", async () => {
		const outcome = await open({
			pages: furnished({
				pages: 6,
				header: () => "The Journal of Careful Tests",
				footer: (n) => `Page ${n} of 6`,
			}),
		});
		expect(textsOf(outcome)).toEqual(bodies(6));
	});

	it("removes bare page numbers in several styles", async () => {
		for (const style of [
			(n: number) => String(n),
			(n: number) => `- ${n} -`,
			(n: number) => `Page ${n}`,
			(n: number) => ["i", "ii", "iii", "iv", "v", "vi"][n - 1] ?? "",
			(n: number) => `${n} / 6`,
		]) {
			const outcome = await open({
				pages: furnished({ pages: 6, footer: style }),
			});
			expect(textsOf(outcome), style(3)).toEqual(bodies(6));
		}
	});

	it("removes headers that alternate between left and right pages", async () => {
		const outcome = await open({
			pages: furnished({
				pages: 6,
				header: (n) =>
					n % 2 === 0 ? "A Short History of Tests" : "Chapter 4 Careful Design",
			}),
		});
		expect(textsOf(outcome)).toEqual(bodies(6));
	});

	it("removes a header whose page number changes", async () => {
		const outcome = await open({
			pages: furnished({
				pages: 5,
				header: (n) => `Annual Report 2021 | ${n + 10}`,
			}),
		});
		expect(textsOf(outcome)).toEqual(bodies(5));
	});

	it("removes a lone page number from a one-page file", async () => {
		const runs = [...BODY_PAGE(1), { x: 300, y: 40, text: "1", size: 9 }];
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual(bodies(1));
	});

	it("keeps text that repeats in the middle of the page", async () => {
		const pages = Array.from({ length: 6 }, (_, i) =>
			page([
				...BODY_PAGE(i + 1),
				{
					x: 72,
					y: 400,
					text: "Remember to breathe slowly while you read.",
					size: 11,
				},
			]),
		);
		const texts = textsOf(await open({ pages }));
		expect(
			texts.filter((t) => t === "Remember to breathe slowly while you read."),
		).toHaveLength(6);
	});

	it("keeps a line at the top of two pages that looks like body text", async () => {
		const pages = Array.from({ length: 8 }, (_, i) => {
			const body = flow([bodies(8)[i] ?? ""], { top: 716, chars: 120 }).runs;
			return page(
				i === 1 || i === 4
					? [{ x: 72, y: 730, text: "Yes, she said.", size: 11 }, ...body]
					: body,
			);
		});
		const texts = textsOf(await open({ pages })).join("\n");
		expect(texts.match(/Yes, she said\./g)).toHaveLength(2);
	});

	it("keeps a number that sits inside the text", async () => {
		const runs = rows([
			"The totals for the year were as follows and are listed here one under the other:",
			"1990",
			"The totals for the following year were higher in every region that was surveyed.",
		]);
		expect(textsOf(await open({ pages: [page(runs)] })).join(" ")).toContain(
			"1990",
		);
	});

	it("keeps a first heading that is large and appears once", async () => {
		const pages = furnished({ pages: 4, header: () => "Running Head" });
		pages[0]?.runs?.push({
			x: 200,
			y: 770,
			text: "The Title Of This Work",
			size: 20,
		});
		const texts = textsOf(await open({ pages }));
		expect(texts).toContain("The Title Of This Work");
		expect(texts.join(" ")).not.toContain("Running Head");
	});
});

describe("pdf: columns and reading order", () => {
	const left = [
		"Left column one starts here and runs down the page in a narrow strip of its own.",
		"It carries on for a few more words before it stops.",
	];
	const right = [
		"Right column two starts here and also runs down the page in a narrow strip.",
		"It is read after the left column has been read in full.",
	];
	const LX = 72;
	const RX = 320;
	const wrapNarrow = (text: string) => wrap(text, 42);

	function twoColumns(order: "columns" | "rows"): TextRun[] {
		const l = wrapNarrow(left.join(" "));
		const r = wrapNarrow(right.join(" "));
		const mk = (xs: number, texts: string[]) =>
			texts.map((text, i) => ({ x: xs, y: 700 - i * 14, text, size: 11 }));
		const lr = mk(LX, l);
		const rr = mk(RX, r);
		if (order === "columns") return [...lr, ...rr];
		const out: TextRun[] = [];
		for (let i = 0; i < Math.max(lr.length, rr.length); i++) {
			const a = lr[i];
			const b = rr[i];
			if (a) out.push(a);
			if (b) out.push(b);
		}
		return out;
	}

	it("reads a column at a time when the file lists one column then the other", async () => {
		const texts = textsOf(await open({ pages: [page(twoColumns("columns"))] }));
		expect(texts.join(" ")).toBe(`${left.join(" ")} ${right.join(" ")}`);
	});

	it("reads a column at a time even when the file lists the lines row by row", async () => {
		const texts = textsOf(await open({ pages: [page(twoColumns("rows"))] }));
		expect(texts.join(" ")).toBe(`${left.join(" ")} ${right.join(" ")}`);
	});

	it("reads a title that spans both columns before the columns", async () => {
		const runs = [
			...twoColumns("rows"),
			{
				x: 150,
				y: 740,
				text: "A Title That Spans The Whole Width Of The Page",
				size: 11,
			},
		];
		const texts = textsOf(await open({ pages: [page(runs)] }));
		expect(texts[0]).toBe("A Title That Spans The Whole Width Of The Page");
		expect(texts.slice(1).join(" ")).toBe(
			`${left.join(" ")} ${right.join(" ")}`,
		);
	});

	it("joins a paragraph that runs from the bottom of one column to the top of the next", async () => {
		const runs: TextRun[] = [
			...rows(
				[
					"A paragraph that starts at the foot of",
					"the left column and runs on past the",
					"gutter into the right column where",
				],
				{ x: LX },
			),
			...rows(
				[
					"it finishes here.",
					"Another paragraph starts afterwards",
					"on the right with some words more.",
				],
				{ x: RX },
			),
		];
		const texts = textsOf(await open({ pages: [page(runs)] }));
		expect(texts[0]).toBe(
			"A paragraph that starts at the foot of the left column and runs on past the gutter into the right column where it finishes here.",
		);
	});

	it("drops a rotated margin stamp", async () => {
		const runs: TextRun[] = [
			...flow([P1]).runs,
			{
				x: 30,
				y: 200,
				text: "arXiv:1234.56789v1 [cs.CL] 1 Jan 2020",
				size: 20,
				rotate: true,
			},
		];
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([P1]);
	});

	it("reads a page whose text is all turned a quarter turn", async () => {
		const runs: TextRun[] = wrap(P1, 60).map((text, i) => ({
			x: 100 + i * 14,
			y: 100,
			text,
			size: 11,
			rotate: true,
		}));
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([P1]);
	});
});

describe("pdf: files that cannot be read", () => {
	it("says a scan is a scan", async () => {
		expectError(
			await open({ pages: [{ scan: true }, { scan: true }] }),
			"scanned-pdf",
		);
	});

	it("still says scan when the scan has page numbers on it", async () => {
		const numbered = [1, 2, 3].map((n) =>
			page([{ x: 300, y: 30, text: String(n), size: 9 }], { scan: true }),
		);
		expectError(await open({ pages: numbered }), "scanned-pdf");
	});

	it("reads the text pages of a file that also has scanned pages", async () => {
		const outcome = await open({
			pages: [{ scan: true }, page(flow([P1, P2]).runs)],
		});
		expect(textsOf(outcome).join(" ")).toContain("committee met on Tuesday");
	});

	it("calls a page with nothing on it empty", async () => {
		expectError(await open({ pages: [{}] }), "empty");
		expectError(await open({ pages: [{}, {}, {}] }), "empty");
	});

	it("reports a file that needs a password as locked", async () => {
		const outcome = await open({
			pages: [page(flow([P1]).runs)],
			encrypt: { userPassword: "secret" },
		});
		const error = expectError(outcome, "drm");
		expect(error.message).toMatch(/password|locked|protected/i);
	});

	it("opens a file that is only locked against editing", async () => {
		const outcome = await open({
			pages: [page(flow([P1]).runs)],
			encrypt: { userPassword: "", ownerPassword: "owner" },
		});
		expect(textsOf(outcome)).toEqual([P1]);
	});

	it("refuses bytes that only carry a PDF name", async () => {
		const junk = new Uint8Array(500).map((_, i) => (i * 31) & 255);
		expectError(await parse(junk, "fake.pdf"), "unsupported");
		expectError(
			await parse(new TextEncoder().encode("hello world"), "fake.pdf"),
			"unsupported",
		);
	});

	it("refuses a header with nothing after it", async () => {
		const bytes = new TextEncoder().encode("%PDF-1.7\n");
		expectError(await parse(bytes, "a.pdf"), "unsupported");
	});

	it("recognises a PDF by its first bytes whatever it is called", async () => {
		const bytes = buildPdf({ pages: [page(flow([P1]).runs)] });
		expect(textsOf(await parse(bytes, "report.txt"))).toEqual([P1]);
		expect(textsOf(await parse(bytes, "report"))).toEqual([P1]);
	});

	it("allows junk before the header, as the PDF format does", async () => {
		const bytes = buildPdf({ pages: [page(flow([P1]).runs)] });
		const lead = new TextEncoder().encode("junk before the header\n");
		const shifted = new Uint8Array(lead.length + bytes.length);
		shifted.set(lead);
		shifted.set(bytes, lead.length);
		expectWellFormed(await parse(shifted, "a.pdf"));
	});
});

describe("pdf: hostile and damaged files", () => {
	const good = (): Uint8Array =>
		buildPdf({
			pages: Array.from({ length: 4 }, (_, i) =>
				page(flow([P1, P2, `${P3} number ${i}`], { gap: 10 }).runs),
			),
		});

	it("never throws or hangs on a file cut short at any point", async () => {
		const bytes = good();
		for (let cut = 0; cut < bytes.length; cut += Math.ceil(bytes.length / 40)) {
			expectWellFormed(await parse(bytes.slice(0, cut), "cut.pdf"));
		}
	}, 60_000);

	it("never throws on a file with damaged bytes", async () => {
		const bytes = good();
		let seed = 12345;
		const next = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
			return seed;
		};
		for (let round = 0; round < 60; round++) {
			const copy = bytes.slice();
			const hits = 1 + (next() % 12);
			for (let i = 0; i < hits; i++) copy[next() % copy.length] = next() & 255;
			expectWellFormed(await parse(copy, "damaged.pdf"));
		}
	}, 120_000);

	it("never throws on random text operators", async () => {
		let seed = 99;
		const next = () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 4294967296;
		};
		for (let round = 0; round < 25; round++) {
			const runs: TextRun[] = Array.from(
				{ length: 1 + Math.floor(next() * 80) },
				() => ({
					x: (next() - 0.2) * 900,
					y: (next() - 0.2) * 1000,
					text: "word ".repeat(1 + Math.floor(next() * 12)).trim(),
					size: next() < 0.1 ? 0.01 : 4 + next() * 40,
					bold: next() < 0.2,
					rotate: next() < 0.1,
				}),
			);
			expectWellFormed(
				await open({ pages: [page(runs), page(runs.slice(2))] }),
			);
		}
	}, 60_000);

	it("survives huge and tiny type sizes and coordinates", async () => {
		const content = new TextEncoder().encode(
			[
				"BT /F1 1e9 Tf 1 0 0 1 72 700 Tm (enormous) Tj ET",
				"BT /F1 0 Tf 1 0 0 1 72 690 Tm (zero) Tj ET",
				"BT /F1 -11 Tf 1 0 0 1 72 680 Tm (negative) Tj ET",
				"BT /F1 11 Tf 1 0 0 1 1e30 650 Tm (faraway) Tj ET",
				"BT /F1 11 Tf 1 0 0 1 72 600 Tm (This line is ordinary and must survive the others.) Tj ET",
			].join("\n"),
		);
		const outcome = await open({ pages: [{ content: { data: content } }] });
		const text = textsOf(outcome).join(" ");
		expect(text).toContain(
			"This line is ordinary and must survive the others.",
		);
		expect(text).not.toContain("faraway");
	});

	it("drops text placed outside the page", async () => {
		const runs: TextRun[] = [
			...flow([P1]).runs,
			{ x: -5000, y: 400, text: "hidden off to the left", size: 11 },
			{ x: 72, y: 5000, text: "hidden far above", size: 11 },
		];
		expect(textsOf(await open({ pages: [page(runs)] }))).toEqual([P1]);
	});

	it("does not trust a page count in the file", async () => {
		const started = Date.now();
		const outcome = await open({
			pages: [page(flow([P1]).runs)],
			claimedPageCount: 2_000_000_000,
		});
		expect(Date.now() - started).toBeLessThan(15_000);
		expect(textsOf(outcome)).toEqual([P1]);
	}, 30_000);

	it("reads three hundred pages in a sensible time", async () => {
		const pages = Array.from({ length: 300 }, (_, i) =>
			page(
				flow([`${P1} number ${alpha(i)}`, `${P2} ${alpha(i)}`], { gap: 10 })
					.runs,
			),
		);
		const started = Date.now();
		const outcome = await open({ pages });
		expect(Date.now() - started).toBeLessThan(40_000);
		expect(textsOf(outcome).length).toBe(600);
	}, 60_000);

	it("copes with thousands of text pieces on one page", async () => {
		const runs: TextRun[] = Array.from({ length: 6000 }, (_, i) => ({
			x: 72 + (i % 40) * 11,
			y: 780 - Math.floor(i / 40) * 0.1,
			text: "a",
			size: 11,
		}));
		const started = Date.now();
		expectWellFormed(await open({ pages: [page(runs)] }));
		expect(Date.now() - started).toBeLessThan(20_000);
	}, 30_000);

	it("stops at the block ceiling the reader sets", async () => {
		const { runs } = flow([P1, P2, P3], { gap: 10 });
		const bytes = buildPdf({ pages: [page(runs)] });
		expectError(await parse(bytes, "a.pdf", { maxBlocks: 2 }), "too-big");
		expect(textsOf(await parse(bytes, "a.pdf", { maxBlocks: 3 }))).toHaveLength(
			3,
		);
	});

	it("stops at the size ceiling the reader sets", async () => {
		const bytes = buildPdf({ pages: [page(flow([P1]).runs)] });
		expectError(await parse(bytes, "a.pdf", { maxBytes: 100 }), "too-big");
	});

	it("leaves the caller's bytes intact", async () => {
		const bytes = buildPdf({ pages: [page(flow([P1]).runs)] });
		const copy = bytes.slice();
		await parse(bytes, "a.pdf");
		expect(bytes.byteLength).toBe(copy.byteLength);
		expect(bytes).toEqual(copy);
	});

	it("keeps control characters and odd code points out of the text", async () => {
		const content = new TextEncoder().encode(
			"BT /F1 11 Tf 1 0 0 1 72 700 Tm (A line with \\000 a NUL and \\001\\002 controls and a \\377 byte.) Tj ET",
		);
		const outcome = await open({ pages: [{ content: { data: content } }] });
		const text = textsOf(outcome).join(" ");
		expect(text).toContain("A line with");
		// biome-ignore lint/suspicious/noControlCharactersInRegex: checking they are gone
		expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
	});
});
