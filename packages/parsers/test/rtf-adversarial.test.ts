/**
 * Adversarial gate for ticket #26 (RTF). Two kinds of test live here.
 *
 * - "holds": inputs the parser must keep handling correctly; they pass and are regression cover.
 * - "DEFECT": inputs the parser gets wrong today. They fail by design; each names the source of
 *   its expected value. Do not weaken them: fix the parser.
 *
 * Sources: RTF Specification 1.9.1 (Microsoft), the Windows code page tables (CP437, CP850,
 * CP866), the project's own DOCX parser (src/docx.ts leaves out hidden and tracked-deleted
 * text), and the ticket's rule that `encoding-suspect` is for extraction that "looks broken".
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import { blocksOf, expectError, expectSuccess, textsOf } from "./helpers";

const bin = (text: string): Uint8Array => {
	const out = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
	return out;
};
const rtf = (body: string, header = "\\ansi") =>
	bin(`{\\rtf1${header} ${body}}`);
const read = (bytes: Uint8Array, name = "doc.rtf") => parse(bytes, name);

const spansOf = (outcome: Awaited<ReturnType<typeof read>>) =>
	blocksOf(outcome).map((block) =>
		block.kind === "image-placeholder" ? [] : block.spans,
	);

const link = (target: string, shown = "click") =>
	rtf(`{\\field{\\*\\fldinst HYPERLINK "${target}"}{\\fldrslt ${shown}}} x`);

describe("rtf adversarial (holds): link targets", () => {
	it("never makes a link from a script, data, file or VBScript target, however it is spelled", async () => {
		const targets = [
			"javascript:alert(1)",
			"JavaScript:alert(1)",
			"JAVASCRIPT:alert(1)",
			"  javascript:alert(1)",
			"java\\tab script:alert(1)",
			"java\\u115 cript:alert(1)",
			"javascript\\'3aalert(1)",
			"\\u8203 javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"file:///etc/passwd",
			"VBScript:msgbox(1)",
			"blob:https://a.example/1",
		];
		for (const target of targets) {
			const outcome = await read(link(target));
			expect(textsOf(outcome), target).toEqual(["click x"]);
			expect(spansOf(outcome)[0], target).toEqual([]);
		}
	});

	it("never makes a link from a target hidden in a nested group or behind a datafield", async () => {
		const nested = rtf(
			'{\\field{\\*\\fldinst {HYPERLINK "javascript:1"}}{\\fldrslt click}}',
		);
		expect(spansOf(await read(nested))[0]).toEqual([]);
		const data = rtf(
			'{\\field{\\*\\fldinst{\\*\\datafield 00}HYPERLINK "javascript:1"}{\\fldrslt click}}',
		);
		expect(spansOf(await read(data))[0]).toEqual([]);
	});

	it("keeps http, https and mailto links, and a lower-case instruction", async () => {
		for (const target of [
			"http://a.example/x",
			"https://a.example/x?y=1",
			"mailto:a@b.example",
		]) {
			const outcome = await read(link(target));
			expect(spansOf(outcome)[0]).toEqual([
				{ kind: "link", start: 0, end: 5, href: target },
			]);
		}
		const lower = rtf(
			'{\\field{\\*\\fldinst hyperlink "https://a.example/"}{\\fldrslt X}}',
		);
		expect(spansOf(await read(lower))[0]).toHaveLength(1);
	});

	it("does not let a link leak onto the text after the field", async () => {
		const outcome = await read(link("https://a.example/", "A"));
		expect(spansOf(outcome)[0]).toEqual([
			{ kind: "link", start: 0, end: 1, href: "https://a.example/" },
		]);
	});
});

describe("rtf adversarial (holds): text", () => {
	it("pairs \\u surrogates, and a fallback never eats the next letter", async () => {
		expect(textsOf(await read(rtf("\\u-10179?\\u-8704? ok")))).toEqual([
			"\u{1F600} ok",
		]);
		expect(textsOf(await read(rtf("\\u-10179\\'3f\\u-8704\\'3f ok")))).toEqual([
			"\u{1F600} ok",
		]);
		expect(textsOf(await read(rtf("\\uc0\\u8364 abc")))).toEqual(["€abc"]);
		expect(textsOf(await read(rtf("\\uc2\\u8364 ab c")))).toEqual(["€ c"]);
	});

	it("reads Arabic, Hebrew, CJK and emoji heavy text without calling it scrambled", async () => {
		const arabic =
			"\\rtlch " +
			[..."مرحبا بالعالم"]
				.map((ch) => (ch === " " ? " " : `\\u${ch.charCodeAt(0)}?`))
				.join("");
		expect(textsOf(await read(rtf(arabic)))).toEqual(["مرحبا بالعالم"]);
		const emoji = "\\u-10179?\\u-8704? ".repeat(30);
		expectSuccess(await read(rtf(emoji)));
		const cjk = [..."日本語のテキストです"]
			.map((ch) => `\\u${ch.charCodeAt(0)}?`)
			.join("");
		expect(textsOf(await read(rtf(cjk)))).toEqual(["日本語のテキストです"]);
	});

	it("decodes Hebrew and Arabic from a font charset, bold only through the right switch", async () => {
		const outcome = await read(
			bin(
				"{\\rtf1\\ansi{\\fonttbl{\\f0\\fcharset178 A;}}\\f0 {\\rtlch\\fcs1 \\ab\\af0 \\ltrch\\fcs0 \\b \\'c7\\'e1\\'e3\\'e4\\'c7\\'d1\\'c9}}",
			),
		);
		expect(textsOf(outcome)).toEqual(["المنارة"]);
		expect(spansOf(outcome)[0]).toEqual([{ kind: "strong", start: 0, end: 7 }]);
	});

	it("reads a font table written without a brace per font", async () => {
		const outcome = await read(
			bin(
				"{\\rtf1\\ansi{\\fonttbl\\f0\\fcharset0 A;\\f1\\fcharset204 B;}\\f1 \\'cf\\'f0\\'e8\\'e2\\'e5\\'f2}",
			),
		);
		expect(textsOf(outcome)).toEqual(["Привет"]);
	});

	it("keeps a picture's non-shape fallback out and the shape picture in, once", async () => {
		const outcome = await read(
			rtf(
				"{\\*\\shppict{\\pict\\pngblip 0102}}{\\nonshppict{\\pict\\wmetafile8 0102}} t",
			),
		);
		const kinds = blocksOf(outcome).map((b) => b.kind);
		expect(kinds.filter((k) => k === "image-placeholder")).toHaveLength(1);
	});
});

describe("rtf adversarial (holds): no superlinear blowup, same-run ratios", () => {
	const best = async (make: (n: number) => Uint8Array, n: number) => {
		const bytes = make(n);
		let min = Number.POSITIVE_INFINITY;
		for (let k = 0; k < 3; k++) {
			const t0 = performance.now();
			await read(bytes);
			min = Math.min(min, performance.now() - t0);
		}
		return Math.max(min, 1);
	};
	const cases: Record<string, (n: number) => Uint8Array> = {
		"alternating bold and italic groups in one paragraph": (n) =>
			rtf("{\\b a}{\\i b}".repeat(n)),
		"hyperlinks in one paragraph": (n) =>
			rtf(
				'{\\field{\\*\\fldinst HYPERLINK "http://a.example/"}{\\fldrslt x}} '.repeat(
					n,
				),
			),
		"list items with captured labels": (n) =>
			rtf("{\\*\\listtext 1.\\tab}\\ls1 item\\par ".repeat(n)),
		"one paragraph of unicode escapes": (n) => rtf("\\u1234? ".repeat(n)),
	};
	for (const [label, make] of Object.entries(cases)) {
		it(`stays near-linear: ${label}`, async () => {
			await best(make, 500);
			const small = await best(make, 15_000);
			const large = await best(make, 60_000);
			// Four times the input: linear is about 4, quadratic about 16.
			expect(large / small).toBeLessThan(11);
		}, 60_000);
	}
});

describe("rtf adversarial DEFECT D1: IBM PC code pages are decoded as Windows-1252", () => {
	// CP437 (RTF \pc, \ansicpg437): 0x82 = e acute, 0x8A = e grave, 0xA4 = n tilde.
	// Source: the Windows code page 437 table; RTF 1.9.1 defines \pc as IBM PC code page 437.
	it("reads \\pc text as code page 437", async () => {
		const outcome = await read(bin("{\\rtf1\\pc \\'82\\'8a\\'a4 x}"));
		expect(textsOf(outcome)).toEqual(["éèñ x"]);
	});

	it("reads \\ansicpg437 text as code page 437", async () => {
		const outcome = await read(rtf("\\'82\\'8a\\'a4 x", "\\ansi\\ansicpg437"));
		expect(textsOf(outcome)).toEqual(["éèñ x"]);
	});

	// CP850 (RTF \pca): 0x82 = e acute, 0x87 = c cedilla, 0xA5 = N tilde.
	it("reads \\pca text as code page 850", async () => {
		const outcome = await read(bin("{\\rtf1\\pca \\'82\\'87\\'a5 x}"));
		expect(textsOf(outcome)).toEqual(["éçÑ x"]);
	});

	// CP866 (DOS Cyrillic): 0x8F = P, 0xE0 = r, 0xA8 = i, 0xA2 = v, 0xA5 = e, 0xE2 = t.
	it("reads \\ansicpg866 text as code page 866", async () => {
		const outcome = await read(
			rtf("\\'8f\\'e0\\'a8\\'a2\\'a5\\'e2", "\\ansi\\ansicpg866"),
		);
		expect(textsOf(outcome)).toEqual(["Привет"]);
	});
});

describe("rtf adversarial DEFECT D2/D3: text a reader of the page never sees is shown", () => {
	// Source: RTF 1.9.1 \v (hidden text) and \deleted (revision-tracked deletion); the project's own
	// DOCX parser documents "Deleted text (tracked changes), hidden text ... are left out".
	it("D2: leaves out hidden text (\\v)", async () => {
		const outcome = await read(rtf("Visible {\\v secret} text"));
		expect(textsOf(outcome)).toEqual(["Visible text"]);
	});

	it("D2: shows text again after \\v0", async () => {
		const outcome = await read(rtf("A {\\v hidden\\v0  shown} B"));
		expect(textsOf(outcome)).toEqual(["A shown B"]);
	});

	it("D3: leaves out tracked deletions and keeps tracked insertions", async () => {
		const outcome = await read(
			rtf(
				"Hello {\\deleted\\revauthdel1\\revdttmdel12345 old }{\\revised\\revauth1 new }world",
			),
		);
		expect(textsOf(outcome)).toEqual(["Hello new world"]);
	});
});

describe("rtf adversarial DEFECT D4: correct text with symbol glyphs is called scrambled", () => {
	// Word writes a Symbol or Wingdings glyph typed as text as a private-use \u value
	// (U+F0B7 bullet = \u-3913, U+F0A8 check box = \u-3928) followed by its 8-bit fallback.
	// A short list or a form with a handful of them is not broken extraction.
	// Hand count for four bullet lines: 4 glyphs among 4+4+5+4 letters + 4 glyphs = 21 characters
	// that are not spaces, so 19 percent private-use; the parser's threshold is 10 percent.
	it("keeps a four-item bulleted list typed with Symbol bullets", async () => {
		const bullet = "\\u-3913\\'b7 ";
		const outcome = await read(
			rtf(
				`${bullet}Milk\\par ${bullet}Eggs\\par ${bullet}Bread\\par ${bullet}Rice\\par`,
			),
		);
		expect(textsOf(outcome)).toHaveLength(4);
	});

	it("keeps a form with four Wingdings check boxes", async () => {
		const box = "\\u-3928\\'a8 ";
		const outcome = await read(
			rtf(`${box}Yes ${box}No ${box}Maybe ${box}Other`),
		);
		expect(outcome.ok).toBe(true);
	});
});

describe("rtf adversarial DEFECT D5: a page break joins the words around it", () => {
	// Source: RTF 1.9.1 \page: "Required page break". Text on either side is on different pages.
	// \line already becomes a space; \page, \column and \lbr must at least separate words.
	it("does not glue 'one' and 'two' across \\page", async () => {
		const outcome = await read(rtf("one\\page two"));
		expect(textsOf(outcome).join(" ")).not.toContain("onetwo");
	});
});

describe("rtf adversarial DEFECT D6: legal-style list labels are read as bullets", () => {
	// Labels such as (a), (1) and (i) are numbering; only a bullet glyph is a bullet.
	it("marks a (a) label ordered", async () => {
		const outcome = await read(
			rtf(
				"\\pard{\\*\\listtext (a)\\tab}\\ls1 First\\par\\pard{\\*\\listtext (b)\\tab}\\ls1 Second\\par",
			),
		);
		const blocks = blocksOf(outcome);
		expect(
			blocks.map((b) => (b.kind === "list-item" ? b.ordered : null)),
		).toEqual([true, true]);
	});

	it("marks a (1) label ordered", async () => {
		const outcome = await read(
			rtf("\\pard{\\*\\listtext (1)\\tab}\\ls1 First\\par"),
		);
		const block = blocksOf(outcome)[0];
		expect(block?.kind === "list-item" && block.ordered).toBe(true);
	});
});

describe("rtf adversarial (holds): sniffing", () => {
	it("does not call a plain text file that mentions RTF later an RTF file", async () => {
		const outcome = await read(bin("hello {\\rtf1 hi}"), "notes.txt");
		expect(expectSuccess(outcome).format).toBe("txt");
	});

	it("reports a package or a PDF named .rtf as unsupported, never as encoding-suspect", async () => {
		expectError(
			await read(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), "a.rtf"),
			"unsupported",
		);
		expectError(await read(bin("%PDF-1.4\n"), "a.rtf"), "unsupported");
	});
});
