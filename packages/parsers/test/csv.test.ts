import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import {
	blocksOf,
	bytesOf,
	concat,
	expectError,
	expectSuccess,
	textsOf,
	utf8,
} from "./helpers";

const csv = (source: string, name = "data.csv") => parse(utf8(source), name);

describe("csv", () => {
	it("makes one table-text block per row, with cells joined by a space", async () => {
		const outcome = await csv("name,age\nAnn,31\nBob,42\n");
		expect(blocksOf(outcome)).toEqual([
			{ kind: "table-text", text: "name age", spans: [] },
			{ kind: "table-text", text: "Ann 31", spans: [] },
			{ kind: "table-text", text: "Bob 42", spans: [] },
		]);
		const result = expectSuccess(outcome);
		expect(result.format).toBe("csv");
		expect(result.title).toBe("data");
	});

	it("keeps commas and escaped quotes inside quoted cells", async () => {
		expect(textsOf(await csv('a,"b, c","say ""hi""",d'))).toEqual([
			'a b, c say "hi" d',
		]);
	});

	it("keeps a quoted cell that contains a line break in one row", async () => {
		const outcome = await csv(
			'name,notes\n"Ann","line one\nline two"\nBob,ok\n',
		);
		expect(textsOf(outcome)).toEqual([
			"name notes",
			"Ann line one line two",
			"Bob ok",
		]);
	});

	it("handles CRLF, lone CR, trims cells and drops empty cells and rows", async () => {
		const outcome = await csv("a , b,,c\r\n\r\n,,\r\n  d  ,\re,f\r");
		expect(textsOf(outcome)).toEqual(["a b c", "d", "e f"]);
	});

	it("detects semicolon and tab separated files that have no comma", async () => {
		expect(textsOf(await csv("a;b;c\n1;2;3"))).toEqual(["a b c", "1 2 3"]);
		expect(textsOf(await csv("a\tb\tc\n1\t2\t3"))).toEqual(["a b c", "1 2 3"]);
		expect(textsOf(await csv("a,b;c\n1,2;3"))).toEqual(["a b;c", "1 2;3"]);
	});

	it("treats a quote inside an unquoted cell as a plain character", async () => {
		expect(textsOf(await csv('5" pipe,ab"c,d'))).toEqual(['5" pipe ab"c d']);
	});

	it("reads an unterminated quote to the end of the file", async () => {
		expect(textsOf(await csv('a,"open cell\nstill open'))).toEqual([
			"a open cell still open",
		]);
	});

	it("keeps text after a closing quote in the same cell", async () => {
		expect(textsOf(await csv('"ab"cd,e'))).toEqual(["abcd e"]);
	});

	it("decodes a UTF-8 BOM and a codepage hint like any text file", async () => {
		const bom = concat(bytesOf(0xef, 0xbb, 0xbf), utf8("naïve,café"));
		expect(textsOf(await parse(bom, "a.csv"))).toEqual(["naïve café"]);
		const turkish = bytesOf(0xfd, 0xfe, 0x2c, 0xf0); // ış,ğ in windows-1254
		expect(
			textsOf(await parse(turkish, "a.csv", { encoding: "windows-1254" })),
		).toEqual(["ış ğ"]);
	});

	it("returns empty when every cell is empty", async () => {
		expectError(await csv(",,,\n,,\n\n"), "empty");
		expectError(await csv('"",""\n'), "empty");
	});

	it("applies the block limit per row", async () => {
		expectError(
			await parse(utf8("a\nb\nc\nd"), "a.csv", { maxBlocks: 3 }),
			"too-big",
		);
	});
});
