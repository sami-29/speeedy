import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import { blocksOf, expectError, expectSuccess, textsOf } from "./helpers";

/** RTF is 7-bit ASCII with escapes, so a test writes it as a string. Bytes above 0x7f pass through. */
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

describe("rtf: paragraphs and text", () => {
	it("splits paragraphs at \\par and reports the format", async () => {
		const outcome = expectSuccess(
			await read(rtf("Hello world.\\par Second paragraph.\\par")),
		);
		expect(outcome.format).toBe("rtf");
		expect(outcome.encoding).toBeNull();
		expect(outcome.document.blocks).toEqual([
			{ kind: "paragraph", text: "Hello world.", spans: [] },
			{ kind: "paragraph", text: "Second paragraph.", spans: [] },
		]);
	});

	it("keeps a last paragraph that has no \\par and drops empty ones", async () => {
		const outcome = await read(rtf("One\\par\\par \\par   \\par Two"));
		expect(textsOf(outcome)).toEqual(["One", "Two"]);
	});

	it("ignores line breaks inside the file and treats a backslash-newline as \\par", async () => {
		expect(textsOf(await read(rtf("ab\r\ncd\\\nef")))).toEqual(["abcd", "ef"]);
	});

	it("collapses runs of spaces and turns tabs and \\line into spaces", async () => {
		const outcome = await read(rtf("a   b\\tab \\tab c\\line d\\par"));
		expect(textsOf(outcome)).toEqual(["a b c d"]);
	});

	it("reads the escaped and named special characters", async () => {
		const outcome = await read(
			rtf(
				"a\\~b\\_c\\-d\\{e\\}f\\\\g \\emdash h\\endash i\\lquote j\\rquote k\\ldblquote l\\rdblquote m\\bullet n\\zwj\\par",
			),
		);
		expect(textsOf(outcome)).toEqual(["a b-cd{e}f\\g —h–i‘j’k“l”m•n‍"]);
	});

	it("starts a new paragraph at \\sect", async () => {
		expect(textsOf(await read(rtf("One\\sect Two")))).toEqual(["One", "Two"]);
	});

	it("reads text that has no \\par at all", async () => {
		expect(textsOf(await read(bin("{\\rtf1\\ansi Just words}")))).toEqual([
			"Just words",
		]);
	});

	it("keeps going when braces are missing at the end", async () => {
		const outcome = await read(bin("{\\rtf1\\ansi Hello {\\b world"));
		const block = blocksOf(outcome)[0];
		expect(block).toMatchObject({ text: "Hello world" });
		expect(spansOf(outcome)[0]).toEqual([
			{ kind: "strong", start: 6, end: 11 },
		]);
	});

	it("ignores whatever follows the closing brace of the document", async () => {
		const outcome = await read(
			bin("{\\rtf1\\ansi Hello}\u0000\u0000 trailing \\par junk"),
		);
		expect(textsOf(outcome)).toEqual(["Hello"]);
	});

	it("tolerates an extra closing brace", async () => {
		const outcome = await read(bin("{\\rtf1\\ansi A}} B}"));
		expect(textsOf(outcome)).toEqual(["A"]);
	});
});

describe("rtf: bold, italic and links", () => {
	it("maps bold and italic groups to strong and emphasis spans", async () => {
		const outcome = await read(
			rtf("Plain {\\b bold} and {\\i italic} and {\\b\\i both}.\\par"),
		);
		const [block] = blocksOf(outcome);
		expect(block).toMatchObject({ text: "Plain bold and italic and both." });
		const spans = spansOf(outcome)[0] ?? [];
		expect(spans).toHaveLength(4);
		expect(spans).toEqual(
			expect.arrayContaining([
				{ kind: "strong", start: 6, end: 10 },
				{ kind: "emphasis", start: 15, end: 21 },
				{ kind: "strong", start: 26, end: 30 },
				{ kind: "emphasis", start: 26, end: 30 },
			]),
		);
	});

	it("turns a mark off with a zero parameter and with \\plain", async () => {
		const outcome = await read(
			rtf("\\b one\\b0  two \\i three\\plain  four\\par"),
		);
		expect(textsOf(outcome)).toEqual(["one two three four"]);
		expect(spansOf(outcome)[0]).toEqual([
			{ kind: "strong", start: 0, end: 3 },
			{ kind: "emphasis", start: 8, end: 13 },
		]);
	});

	it("keeps spans inside the trimmed text", async () => {
		const outcome = await read(rtf("{\\b   padded   }\\par"));
		expect(textsOf(outcome)).toEqual(["padded"]);
		expect(spansOf(outcome)[0]).toEqual([{ kind: "strong", start: 0, end: 6 }]);
	});

	it("reads complex-script bold (\\ab) while a right-to-left run is active", async () => {
		const outcome = await read(
			rtf("\\rtlch\\ab word\\ltrch\\ab0  plain\\par\\par"),
		);
		expect(spansOf(outcome)[0]).toEqual([{ kind: "strong", start: 0, end: 4 }]);
	});

	it("keeps a hyperlink field's result as a link span and drops the instruction", async () => {
		const outcome = await read(
			rtf(
				'See {\\field{\\*\\fldinst HYPERLINK "https://example.org/x"}{\\fldrslt {\\ul the page}}} now.\\par',
			),
		);
		expect(textsOf(outcome)).toEqual(["See the page now."]);
		expect(spansOf(outcome)[0]).toEqual([
			{ kind: "link", start: 4, end: 12, href: "https://example.org/x" },
		]);
	});

	it("keeps the text of a link with an unsafe target but not the link", async () => {
		const outcome = await read(
			rtf(
				'{\\field{\\*\\fldinst HYPERLINK "javascript:alert(1)"}{\\fldrslt click me}}\\par',
			),
		);
		expect(textsOf(outcome)).toEqual(["click me"]);
		expect(spansOf(outcome)[0]).toEqual([]);
	});

	it("keeps the result of other fields and never shows their instruction", async () => {
		const outcome = await read(
			rtf(
				"Page {\\field{\\*\\fldinst PAGE \\\\* MERGEFORMAT}{\\fldrslt 3}} of text.\\par",
			),
		);
		expect(textsOf(outcome)).toEqual(["Page 3 of text."]);
	});
});

describe("rtf: structure", () => {
	const styles =
		"{\\stylesheet{\\s0 Normal;}{\\s1\\sbasedon0 heading 1;}{\\s2 Heading 2;}{\\s3\\outlinelevel2 My Chapter;}{\\s4 Quote;}{\\s5 heading 9;}{\\s6 Heading;}}";

	it("makes a heading from a style named heading N", async () => {
		const outcome = await read(
			rtf(
				`${styles}\\pard\\s1 Title\\par\\pard\\s2 Sub\\par\\pard\\s5 Deep\\par\\pard\\s6 Not one\\par\\pard Body\\par`,
			),
		);
		expect(blocksOf(outcome)).toEqual([
			{ kind: "heading", level: 1, text: "Title", spans: [] },
			{ kind: "heading", level: 2, text: "Sub", spans: [] },
			{ kind: "heading", level: 6, text: "Deep", spans: [] },
			{ kind: "paragraph", text: "Not one", spans: [] },
			{ kind: "paragraph", text: "Body", spans: [] },
		]);
	});

	it("makes a heading from an outline level, on the style or on the paragraph", async () => {
		const outcome = await read(
			rtf(
				`${styles}\\pard\\s3 Chapter\\par\\pard\\outlinelevel1 Direct\\par\\pard\\outlinelevel9 Body\\par`,
			),
		);
		expect(
			blocksOf(outcome).map((b) => [b.kind, "level" in b ? b.level : 0]),
		).toEqual([
			["heading", 3],
			["heading", 2],
			["paragraph", 0],
		]);
	});

	it("drops a bold span that only repeats the heading's own weight", async () => {
		const outcome = await read(rtf(`${styles}\\pard\\s1 {\\b Title}\\par`));
		expect(spansOf(outcome)[0]).toEqual([]);
	});

	it("makes a quote from a Quote style", async () => {
		const outcome = await read(rtf(`${styles}\\pard\\s4 To be.\\par`));
		expect(blocksOf(outcome)).toEqual([
			{ kind: "quote", text: "To be.", spans: [] },
		]);
	});

	it("reads list items with their depth and whether they are numbered", async () => {
		const outcome = await read(
			rtf(
				"\\pard\\ls1\\ilvl0{\\listtext\\pard \\u8226\\'95\\tab}Bullet\\par" +
					"\\pard\\ls2\\ilvl1{\\listtext\\pard  1.\\tab}Numbered\\par" +
					"\\pard\\ls2\\ilvl0{\\*\\listtext a)\\tab}Lettered\\par" +
					"\\pard Plain\\par",
			),
		);
		expect(blocksOf(outcome)).toEqual([
			{
				kind: "list-item",
				depth: 0,
				ordered: false,
				text: "Bullet",
				spans: [],
			},
			{
				kind: "list-item",
				depth: 1,
				ordered: true,
				text: "Numbered",
				spans: [],
			},
			{
				kind: "list-item",
				depth: 0,
				ordered: true,
				text: "Lettered",
				spans: [],
			},
			{ kind: "paragraph", text: "Plain", spans: [] },
		]);
	});

	it("reads table cells as table text and returns to paragraphs after the row", async () => {
		const outcome = await read(
			rtf(
				"\\trowd\\cellx1000\\cellx2000\\pard\\intbl A\\cell B\\cell\\row\\pard After\\par",
			),
		);
		expect(blocksOf(outcome)).toEqual([
			{ kind: "table-text", text: "A", spans: [] },
			{ kind: "table-text", text: "B", spans: [] },
			{ kind: "paragraph", text: "After", spans: [] },
		]);
	});

	it("keeps a paragraph with list formatting off the next paragraph after \\pard", async () => {
		const outcome = await read(rtf("\\pard\\ls1 One\\par\\pard Two\\par"));
		expect(blocksOf(outcome).map((b) => b.kind)).toEqual([
			"list-item",
			"paragraph",
		]);
	});

	it("makes an image placeholder for a picture and skips its data", async () => {
		const outcome = await read(
			rtf(
				"Before {\\pict\\pngblip\\picw10\\pich10 89504e470d0a1a0a00ff} after.\\par",
			),
		);
		expect(blocksOf(outcome)).toEqual([
			{ kind: "paragraph", text: "Before after.", spans: [] },
			{ kind: "image-placeholder", alt: "" },
		]);
	});

	it("makes one placeholder for a picture and its non-shape fallback", async () => {
		const outcome = await read(
			rtf(
				"{\\*\\shppict{\\pict\\jpegblip ffd8}}{\\nonshppict{\\pict\\wmetafile8 0102}}\\par x\\par",
			),
		);
		expect(
			blocksOf(outcome).filter((b) => b.kind === "image-placeholder"),
		).toHaveLength(1);
		expect(textsOf(outcome)).toContain("x");
	});
});

describe("rtf: what is not body text", () => {
	it("ignores the font, colour and style tables, document info and unknown groups", async () => {
		const outcome = await read(
			bin(
				"{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Arial;}{\\f1 Times New Roman;}}" +
					"{\\colortbl;\\red0\\green0\\blue0;}{\\stylesheet{\\s0 Normal;}}" +
					"{\\info{\\author Someone}{\\company Acme}}{\\*\\generator Writer 9.9;}" +
					"{\\*\\unknowndest secret words}" +
					"\\pard Only this.\\par}",
			),
		);
		expect(textsOf(outcome)).toEqual(["Only this."]);
	});

	it("ignores headers, footers, footnotes and comments", async () => {
		const outcome = await read(
			rtf(
				"{\\header Running head}{\\footerl Foot}Body{\\footnote\\pard Note text} goes on.{\\annotation Comment}\\par",
			),
		);
		expect(textsOf(outcome)).toEqual(["Body goes on."]);
	});

	it("skips raw binary data after \\bin, even when it holds braces", async () => {
		const outcome = await read(bin("{\\rtf1\\ansi A{\\pict\\bin3 }}{}x\\par}"));
		expect(blocksOf(outcome)).toEqual([
			{ kind: "paragraph", text: "Ax", spans: [] },
			{ kind: "image-placeholder", alt: "" },
		]);
	});

	it("reads the document title from the info group", async () => {
		const outcome = expectSuccess(
			await read(
				rtf("{\\info{\\title Lamp notes}{\\author A}}Body\\par"),
				"x.rtf",
			),
		);
		expect(outcome.title).toBe("Lamp notes");
	});

	it("falls back to the file name for the title", async () => {
		const outcome = expectSuccess(await read(rtf("Body\\par"), "My Notes.rtf"));
		expect(outcome.title).toBe("My Notes");
	});
});

describe("rtf: Unicode and code pages", () => {
	it("reads \\u escapes and skips the fallback after them", async () => {
		const outcome = await read(
			rtf("caf\\u233?x \\u233\\'e9y \\uc0 \\u233 z \\uc2\\u233ab c\\par"),
		);
		expect(textsOf(outcome)).toEqual(["caféx éy éz é c"]);
	});

	it("reads a negative \\u value and a surrogate pair", async () => {
		const outcome = await read(rtf("\\u-10179?\\u-8704?\\par"));
		expect(textsOf(outcome)).toEqual(["\u{1F600}"]);
	});

	it("ends the fallback skip at a group boundary", async () => {
		const outcome = await read(rtf("{\\uc1\\u233}x?\\par"));
		expect(textsOf(outcome)).toEqual(["éx?"]);
	});

	it("decodes \\'hh with the document code page", async () => {
		expect(textsOf(await read(rtf("caf\\'e9\\par")))).toEqual(["café"]);
		expect(
			textsOf(await read(rtf("\\'cf\\'f0\\'e8\\par", "\\ansi\\ansicpg1251"))),
		).toEqual(["При"]);
	});

	it("prefers the font's character set over the document code page", async () => {
		const outcome = await read(
			rtf(
				"{\\fonttbl{\\f0\\fcharset162 A;}{\\f1\\fcharset204 B;}{\\f2\\fcharset177 C;}{\\f3\\fcharset178 D;}{\\f4\\fcharset0 E;}}" +
					"\\f0\\'fe\\f1\\'f0\\f2\\'f9\\'ec\\'e5\\'ed\\f3\\'e3\\'d1\\'cd\\'c8\\'c7\\f4\\'e9\\par",
				"\\ansi\\ansicpg1252",
			),
		);
		expect(textsOf(outcome)).toEqual(["şрשלוםمرحباé"]);
	});

	it("uses a font's own \\cpg over its character set", async () => {
		const outcome = await read(
			rtf("{\\fonttbl{\\f0\\fcharset0\\cpg1251 A;}}\\f0\\'cf\\par"),
		);
		expect(textsOf(outcome)).toEqual(["П"]);
	});

	it("falls back to the default font when no font is selected", async () => {
		const outcome = await read(
			rtf("{\\fonttbl{\\f7\\fcharset204 A;}}\\'cf\\par", "\\ansi\\deff7"),
		);
		expect(textsOf(outcome)).toEqual(["П"]);
	});

	it("reads double-byte code pages (Shift JIS, GBK) split across escapes", async () => {
		expect(
			textsOf(
				await read(
					rtf("{\\fonttbl{\\f0\\fcharset128 A;}}\\f0\\'82\\'a0\\'82\\'a2\\par"),
				),
			),
		).toEqual(["あい"]);
		expect(
			textsOf(
				await read(
					rtf("{\\fonttbl{\\f0\\fcharset134 A;}}\\f0\\'c4\\'e3\\'ba\\'c3\\par"),
				),
			),
		).toEqual(["你好"]);
	});

	it("decodes raw bytes above 0x7f with the code page too", async () => {
		const bytes = Uint8Array.from([
			...bin("{\\rtf1\\ansi\\ansicpg1251 "),
			0xcf,
			0xf0,
			...bin("\\par}"),
		]);
		expect(textsOf(await read(bytes))).toEqual(["Пр"]);
	});

	it("falls back to Windows-1252 for a code page it cannot decode", async () => {
		expect(
			textsOf(await read(rtf("\\'e9\\par", "\\ansi\\ansicpg99999"))),
		).toEqual(["é"]);
	});
});

describe("rtf: recognising the file", () => {
	it("reads RTF whatever the file is called", async () => {
		const bytes = rtf("Hello\\par");
		for (const name of ["a.doc", "a.txt", "noext", "a.docx.rtf", "a.html"]) {
			const outcome = expectSuccess(await read(bytes, name));
			expect(outcome.format).toBe("rtf");
		}
	});

	it("allows a byte-order mark and blank space before the header", async () => {
		const bytes = Uint8Array.from([
			0xef,
			0xbb,
			0xbf,
			0x0d,
			0x0a,
			...rtf("Hello\\par"),
		]);
		expect(textsOf(await read(bytes, "a.rtf"))).toEqual(["Hello"]);
	});

	it("refuses a .rtf file that is not RTF", async () => {
		expectError(await read(bin("Just some text."), "notes.rtf"), "unsupported");
		expectError(await read(bin("{\\rtfx broken}"), "notes.rtf"), "unsupported");
	});

	it("does not take text that merely mentions RTF for RTF", async () => {
		const outcome = expectSuccess(
			await read(bin("Write {\\rtf1 like this} in the file.\n"), "a.txt"),
		);
		expect(outcome.format).toBe("txt");
	});

	it("reports an RTF with no text as empty", async () => {
		expectError(await read(bin("{\\rtf1\\ansi}")), "empty");
		expectError(await read(rtf("\\pard\\plain\\b \\par\\par")), "empty");
	});

	it("honours a language hint", async () => {
		const outcome = expectSuccess(
			await parse(rtf("Hello\\par"), "a.rtf", { language: "tr" }),
		);
		expect(outcome.language).toEqual({ code: "tr", source: "hint" });
	});
});

describe("rtf: broken extraction is encoding-suspect", () => {
	it("flags text that is mostly replacement characters", async () => {
		const bad = "\\u-3?".repeat(80);
		const outcome = await read(rtf(`${bad} and a few words\\par`));
		expectError(outcome, "encoding-suspect");
	});

	it("flags text that is mostly question marks left by a failed conversion", async () => {
		const outcome = await read(rtf(`${"? ".repeat(80)}word\\par`));
		expectError(outcome, "encoding-suspect");
	});

	it("flags text that is mostly private-use characters", async () => {
		const outcome = await read(rtf(`${"\\u61472?".repeat(60)} text\\par`));
		expectError(outcome, "encoding-suspect");
	});

	it("keeps a text with a few questions and one stray character", async () => {
		const outcome = await read(
			rtf(
				"Who was there? Nobody knew. Did anyone ask? Not once. \\u-3? Where did it go? Nobody can say, and that is the end of it.\\par",
			),
		);
		expectSuccess(outcome);
	});

	it("explains what to do in the message", async () => {
		const outcome = await read(rtf(`${"\\u-3?".repeat(80)}\\par`));
		const error = expectError(outcome, "encoding-suspect");
		expect(error.message.toLowerCase()).toContain("paste");
	});
});
