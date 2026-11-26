import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import {
	cfb,
	docFile,
	type Piece,
	simpleDoc,
	wordStreams,
} from "./doc-builder";
import { blocksOf, expectError, expectSuccess, textsOf, utf8 } from "./helpers";

const read = (bytes: Uint8Array, name = "doc.doc") => parse(bytes, name);

const fixture = (name: string) =>
	new Uint8Array(
		readFileSync(join(import.meta.dirname, "fixtures", "doc", name)),
	);

describe("doc: text and pieces", () => {
	it("reads UTF-16 text and splits paragraphs at the paragraph mark", async () => {
		const outcome = expectSuccess(
			await read(
				simpleDoc("First paragraph.\rSecond paragraph.\r"),
				"Notes.doc",
			),
		);
		expect(outcome.format).toBe("doc");
		expect(outcome.encoding).toBeNull();
		expect(outcome.title).toBe("Notes");
		expect(outcome.document.blocks).toEqual([
			{ kind: "paragraph", text: "First paragraph.", spans: [] },
			{ kind: "paragraph", text: "Second paragraph.", spans: [] },
		]);
	});

	it("reads 8-bit (compressed) pieces as Windows-1252", async () => {
		const bytes = docFile({
			pieces: [{ text: "Café – “quoted” €5 naïve.\r", compressed: true }],
		});
		expect(textsOf(await read(bytes))).toEqual(["Café – “quoted” €5 naïve."]);
	});

	it("joins 8-bit and UTF-16 pieces in order, even inside one paragraph", async () => {
		const pieces: Piece[] = [
			{ text: "Plain start, ", compressed: true },
			{ text: "şapka буквы" },
			{ text: " and an 8-bit end.\rNext.\r", compressed: true },
		];
		expect(textsOf(await read(docFile({ pieces })))).toEqual([
			"Plain start, şapka буквы and an 8-bit end.",
			"Next.",
		]);
	});

	it("reads a file whose pieces are out of file order", async () => {
		const bytes = docFile({
			pieces: [{ text: "first " }, { text: "second\r" }],
			// The bytes of the second piece are stored before the bytes of the first.
			storage: [1, 0],
		});
		expect(textsOf(await read(bytes))).toEqual(["first second"]);
		expect(
			textsOf(
				await read(
					docFile({ pieces: [{ text: "first " }, { text: "second\r" }] }),
				),
			),
		).toEqual(["first second"]);
	});

	it("reads the piece table from 0Table or 1Table, whichever the flag names", async () => {
		const one = docFile({ pieces: [{ text: "One\r" }], table: "1Table" });
		const zero = docFile({ pieces: [{ text: "Zero\r" }], table: "0Table" });
		expect(textsOf(await read(one))).toEqual(["One"]);
		expect(textsOf(await read(zero))).toEqual(["Zero"]);
	});

	it("leaves out footnote, header and comment text that follows the main text", async () => {
		const bytes = docFile({
			pieces: [
				{ text: "Body text.\r" },
				{ text: "Footnote text.\rHeader text.\r" },
			],
			ccpText: "Body text.\r".length,
		});
		expect(textsOf(await read(bytes))).toEqual(["Body text."]);
	});

	it("reads a document big enough to leave the mini stream", async () => {
		const text = "Line of the document.\r".repeat(3000);
		const outcome = await read(docFile({ pieces: [{ text }] }));
		expect(textsOf(outcome)).toHaveLength(3000);
	});

	it("reads a file with 4096-byte sectors", async () => {
		const outcome = await read(
			docFile({ pieces: [{ text: "Big sectors.\r" }] }, { version: 4 }),
		);
		expect(textsOf(outcome)).toEqual(["Big sectors."]);
	});

	it("reads a file whose FAT needs DIFAT sectors", async () => {
		const outcome = await read(
			docFile({ pieces: [{ text: "Far away.\r" }], padTo: 9 * 1024 * 1024 }),
		);
		expect(textsOf(outcome)).toEqual(["Far away."]);
	});

	it("ignores unrelated streams and takes the table the FIB names", async () => {
		const streams = [
			...wordStreams({ pieces: [{ text: "Right one.\r" }], table: "1Table" }),
			{ name: "0Table", data: new Uint8Array(100).fill(0x55) },
			{ name: "SummaryInformation", data: new Uint8Array(40) },
		];
		expect(textsOf(await read(cfb(streams).bytes))).toEqual(["Right one."]);
	});
});

describe("doc: Word's special characters", () => {
	it("maps line breaks, page breaks, hyphens and drops object anchors", async () => {
		const text = "A\u000bb\u000cc\u001ed\u0001e\u0008f\u0002g\u0005h\u001fi\r";
		expect(textsOf(await read(simpleDoc(text)))).toEqual(["A b", "c-defghi"]);
	});

	it("keeps a tab as a space and collapses whitespace", async () => {
		expect(textsOf(await read(simpleDoc("a\t\tb   c \r")))).toEqual(["a b c"]);
	});

	it("hides field instructions and keeps field results", async () => {
		const text =
			'See \u0013 HYPERLINK "http://example.org" \u0014the site\u0015 now.\r' +
			"Page \u0013 PAGE \u0014 3\u0015 of text.\r";
		expect(textsOf(await read(simpleDoc(text)))).toEqual([
			"See the site now.",
			"Page 3 of text.",
		]);
	});

	it("handles fields inside fields", async () => {
		const text =
			"x \u0013 A \u0013 B \u0014 inner\u0015 C \u0014outer\u0015 end\r";
		expect(textsOf(await read(simpleDoc(text)))).toEqual(["x outer end"]);
	});

	it("lets a field result run across paragraphs", async () => {
		const text = "\u0013 TOC \u0014One\rTwo\r\u0015Three\r";
		expect(textsOf(await read(simpleDoc(text)))).toEqual([
			"One",
			"Two",
			"Three",
		]);
	});

	it("does not let a field that never closes hide the rest of the document", async () => {
		const text = "Before \u0013 HYPERLINK\rAfter one.\rAfter two.\r";
		expect(textsOf(await read(simpleDoc(text)))).toEqual([
			"Before",
			"After one.",
			"After two.",
		]);
	});

	it("reads cells (0x07) as table text and ignores the row mark", async () => {
		const text = "Name\u0007Age\u0007\u0007Ann\u00073\u0007\u0007After.\r";
		expect(blocksOf(await read(simpleDoc(text)))).toEqual([
			{ kind: "table-text", text: "Name", spans: [] },
			{ kind: "table-text", text: "Age", spans: [] },
			{ kind: "table-text", text: "Ann", spans: [] },
			{ kind: "table-text", text: "3", spans: [] },
			{ kind: "paragraph", text: "After.", spans: [] },
		]);
	});

	it("drops empty paragraphs", async () => {
		expect(textsOf(await read(simpleDoc("\r\r One\r \r\r")))).toEqual(["One"]);
	});

	it("keeps a last paragraph with no paragraph mark", async () => {
		expect(textsOf(await read(simpleDoc("One\rTwo")))).toEqual(["One", "Two"]);
	});
});

describe("doc: recognising the file", () => {
	it("reads a Word file whatever it is called", async () => {
		const bytes = simpleDoc("Hello\r");
		for (const name of ["a.txt", "noext", "a.docx.bin", "a.html", "A.DOC"]) {
			const outcome = expectSuccess(await read(bytes, name));
			expect(outcome.format).toBe("doc");
		}
	});

	it("reads RTF saved with a .doc name", async () => {
		const outcome = expectSuccess(
			await read(utf8("{\\rtf1\\ansi Saved as rtf.\\par}"), "Letter.doc"),
		);
		expect(outcome.format).toBe("rtf");
		expect(textsOf(outcome)).toEqual(["Saved as rtf."]);
	});

	it("does not call an Excel or PowerPoint file a document", async () => {
		const sheet = cfb([
			{ name: "Workbook", data: new Uint8Array(600).fill(1) },
		]).bytes;
		expectError(await read(sheet, "sheet.doc"), "unsupported");
		expectError(await read(sheet, "sheet.xls"), "unsupported");
	});

	it("refuses a .doc that is neither a compound file, RTF nor a package", async () => {
		expectError(
			await read(utf8("<html><body>Word as web page</body></html>"), "a.doc"),
			"unsupported",
		);
		expectError(
			await read(utf8("plain text in a .doc"), "a.doc"),
			"unsupported",
		);
	});

	it("tells an older Word 6 or 95 file apart", async () => {
		const error = expectError(
			await read(docFile({ pieces: [{ text: "Old\r" }], nFib: 0x0065 })),
			"unsupported",
		);
		expect(error.message).toMatch(/older|Word 97/);
	});

	it("reports a password-protected Word file as drm", async () => {
		expectError(
			await read(docFile({ pieces: [{ text: "Secret\r" }], encrypted: true })),
			"drm",
		);
		expectError(
			await read(docFile({ pieces: [{ text: "Secret\r" }], obfuscated: true })),
			"drm",
		);
	});

	it("reports a Word file with no text as empty", async () => {
		expectError(await read(simpleDoc("\r\r \r")), "empty");
		expectError(await read(docFile({ pieces: [{ text: "" }] })), "empty");
	});
});

describe("doc: broken extraction is encoding-suspect", () => {
	it("flags text made mostly of private-use characters", async () => {
		const text = `${"".repeat(80)} and a few real words\r`;
		expectError(await read(simpleDoc(text)), "encoding-suspect");
	});

	it("flags 8-bit text made mostly of bytes Windows-1252 does not define", async () => {
		const raw = Uint8Array.from(
			{ length: 100 },
			(_, k) => [0x81, 0x8d, 0x8f, 0x90, 0x9d][k % 5] ?? 0x81,
		);
		const outcome = await read(
			docFile({ pieces: [{ text: "x".repeat(100), compressed: true, raw }] }),
		);
		expectError(outcome, "encoding-suspect");
	});

	it("keeps a document with a few bullets in the Symbol range", async () => {
		const text = `\tOne item in a long enough sentence.\r\tTwo items follow, also in a longer sentence.\r`;
		const outcome = await read(simpleDoc(text));
		expect(textsOf(outcome)).toHaveLength(2);
	});

	it("explains what to do in the message", async () => {
		const error = expectError(
			await read(simpleDoc(`${"".repeat(80)} words\r`)),
			"encoding-suspect",
		);
		expect(error.message.toLowerCase()).toContain("paste");
	});
});

describe("doc: files made by LibreOffice", () => {
	it("reads headings, a list, a link and a table as paragraphs and table text", async () => {
		const outcome = await read(
			fixture("lamp-structure.doc"),
			"lamp-structure.doc",
		);
		expect(blocksOf(outcome).map((b) => b.kind)).toEqual([
			...Array(7).fill("paragraph"),
			...Array(4).fill("table-text"),
			"paragraph",
		]);
		expect(textsOf(outcome)).toEqual([
			"The Lamp Room",
			"The keeper climbed the stairs every evening, carrying the oil and a small brass key. He read the tide tables before he began.",
			"Night shift",
			"Trim the wick",
			"Polish the glass",
			"Count the steps",
			"Log the weather",
			"North",
			"Calm",
			"South",
			"Fog",
			"Last line of the page.",
		]);
	});

	it("reads Turkish, Cyrillic, Arabic and Hebrew text from UTF-16 pieces", async () => {
		expect(textsOf(await read(fixture("libreoffice-turkish.doc")))[1]).toBe(
			"Çok güzel bir gün. İstanbul'da ğüşıöç harfleri var. Şapka, ışık, ödül ve çiçek.",
		);
		expect(textsOf(await read(fixture("libreoffice-cyrillic.doc")))[0]).toBe(
			"Маяк",
		);
		expect(textsOf(await read(fixture("libreoffice-arabic.doc")))[0]).toBe(
			"المنارة",
		);
		expect(textsOf(await read(fixture("libreoffice-hebrew.doc")))[0]).toBe(
			"המגדלור",
		);
	});
});

describe("doc: 8-bit pieces from Word", () => {
	// The spec (seam 2) keeps this test but skips it: LibreOffice writes only UTF-16 pieces, so
	// the 8-bit path is covered by built files above, and a Word-made file with Turkish text in
	// 8-bit pieces has not turned up. Add the file to the corpus and enable this test then.
	it.skip("reads Turkish text from a .doc made by Word (skipped until a real sample turns up)", async () => {
		const bytes = fixture("word-turkish-8bit.doc");
		const outcome = await read(bytes, "word-turkish-8bit.doc");
		expect(textsOf(outcome).join(" ")).toContain("ş");
	});
});

describe("doc: pieces and symbol glyphs", () => {
	it("turns a dangling surrogate half before an 8-bit piece into U+FFFD and keeps the 8-bit text", async () => {
		const outcome = await read(
			docFile({
				pieces: [{ text: "a \ud83d" }, { text: "b\r", compressed: true }],
			}),
		);
		expect(textsOf(outcome)).toEqual(["a �b"]);
	});

	it("still flags text that is mostly symbol-font glyphs", async () => {
		const text = `${"".repeat(80)} and a few real words\r`;
		expectError(await read(simpleDoc(text)), "encoding-suspect");
	});
});
