/**
 * Adversarial gate for ticket #26 (.doc). "holds" tests pass and are regression cover; "DEFECT"
 * tests fail by design and name the source of their expected value. Sources: [MS-DOC] (the Word
 * 97 binary format: field marks 0x13/0x14/0x15, cell mark 0x07, UTF-16 text in pieces) and the
 * ticket's rule that `encoding-suspect` is for extraction that "looks broken".
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import { docFile, simpleDoc } from "./doc-builder";
import { expectSuccess, textsOf } from "./helpers";

const read = (bytes: Uint8Array, name = "doc.doc") => parse(bytes, name);

describe("doc adversarial (holds)", () => {
	it("keeps emoji and CJK text, and does not call them scrambled", async () => {
		expect(textsOf(await read(simpleDoc("😀😀😀😀😀 ok\r")))).toEqual([
			"😀😀😀😀😀 ok",
		]);
		expect(textsOf(await read(simpleDoc("日本語のテキストです\r")))).toEqual([
			"日本語のテキストです",
		]);
	});

	it("keeps a surrogate pair that sits inside one piece", async () => {
		const outcome = await read(docFile({ pieces: [{ text: "a 😀 b\r" }] }));
		expect(textsOf(outcome)).toEqual(["a 😀 b"]);
	});

	it("maps the non-breaking hyphen and drops the optional hyphen", async () => {
		expect(textsOf(await read(simpleDoc("a\x1eb\x1fc\r")))).toEqual(["a-bc"]);
	});

	it("reads a field with its result inside a table cell", async () => {
		const outcome = await read(simpleDoc("\x13 PAGE \x14 3\x15\x07x\x07\r"));
		expect(textsOf(outcome)).toEqual(["3", "x"]);
	});

	it("names the file by its bytes: a Word file under a .txt name is read as Word", async () => {
		expect(
			expectSuccess(await read(simpleDoc("hello\r"), "notes.txt")).format,
		).toBe("doc");
	});
});

describe("doc adversarial DEFECT D4: correct text with symbol glyphs is called scrambled", () => {
	// Word stores a Symbol-font bullet typed as text as U+F0B7 and a Wingdings check box as U+F0A8.
	// Hand count for the list: 4 glyphs + 4+4+5+4 letters = 21 characters that are not spaces, so
	// 19 percent private use, over the parser's 10 percent line. The text is not broken.
	it("keeps a four-item list typed with Symbol bullets", async () => {
		const outcome = await read(simpleDoc(" Milk\r Eggs\r Bread\r Rice\r"));
		expect(textsOf(outcome)).toHaveLength(4);
	});

	it("keeps a form with four Wingdings check boxes", async () => {
		const outcome = await read(simpleDoc(" Yes  No  Maybe  Other\r"));
		expect(outcome.ok).toBe(true);
	});
});

describe("doc adversarial DEFECT D7: a field that never opens its result swallows table cells", () => {
	// [MS-DOC]: a field instruction cannot hold a paragraph mark or a cell mark. The parser already
	// ends a damaged field at a paragraph mark (0x0D) but not at a cell mark (0x07), so the cell
	// after a dangling field-begin vanishes. Expected: both cells survive.
	it("keeps the cell that follows a dangling field start", async () => {
		const outcome = await read(simpleDoc("A\x13 foo\x07B\x07\rafter\r"));
		expect(textsOf(outcome)).toEqual(["A", "B", "after"]);
	});
});

describe("doc adversarial DEFECT D8: a surrogate pair split across two pieces becomes two U+FFFD", () => {
	// [MS-DOC]: pieces are ranges of one character stream; a piece boundary carries no meaning for
	// the characters. U+1F600 is the pair D83D DE00; Unicode text is the concatenation of pieces.
	it("joins a pair whose halves sit in neighbouring pieces", async () => {
		const outcome = await read(
			docFile({ pieces: [{ text: "a \ud83d" }, { text: "\ude00 b\r" }] }),
		);
		expect(textsOf(outcome)).toEqual(["a 😀 b"]);
	});
});
