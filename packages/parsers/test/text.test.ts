import { describe, expect, it } from "vitest";
import { parse, parseText } from "../src/index";
import {
	blocksOf,
	bytesOf,
	concat,
	expectError,
	expectSuccess,
	expectWellFormed,
	textsOf,
	utf8,
	utf16,
} from "./helpers";

describe("plain text: paragraphs", () => {
	it("returns a valid Document with one paragraph block per paragraph", async () => {
		const outcome = await parse(
			utf8("Hello world.\n\nSecond paragraph."),
			"notes.txt",
		);
		const result = expectSuccess(outcome);
		expect(result.document.blocks).toEqual([
			{ kind: "paragraph", text: "Hello world.", spans: [] },
			{ kind: "paragraph", text: "Second paragraph.", spans: [] },
		]);
		expect(result.format).toBe("txt");
		expect(result.encoding).toBe("utf-8");
		expect(result.title).toBe("notes");
	});

	it("joins hard-wrapped lines inside a paragraph with one space", async () => {
		const outcome = await parse(
			utf8("The quick brown\nfox jumps over\n\nthe lazy dog."),
			"a.txt",
		);
		expect(textsOf(outcome)).toEqual([
			"The quick brown fox jumps over",
			"the lazy dog.",
		]);
	});

	it("makes every line a paragraph when the file has no blank line at all", async () => {
		const outcome = await parse(utf8("one\ntwo\nthree"), "a.txt");
		expect(textsOf(outcome)).toEqual(["one", "two", "three"]);
	});

	it("collapses runs of blank lines, spaces and tabs and trims the ends", async () => {
		const outcome = await parse(
			utf8("\n\n  Alpha \t  beta  \n\n\n\n\n  Gamma\t\n\n"),
			"a.txt",
		);
		expect(textsOf(outcome)).toEqual(["Alpha beta", "Gamma"]);
	});

	it("treats CRLF, lone CR and Unicode line separators as line breaks", async () => {
		const outcome = await parse(
			utf8("a\r\n\r\nb\r\rc\u2029d\u2028\u2028e"),
			"a.txt",
		);
		expect(textsOf(outcome)).toEqual(["a", "b", "c", "d", "e"]);
	});

	it("drops control characters but keeps tabs and newlines as whitespace", async () => {
		const outcome = await parse(
			utf8(
				"be\u0007ll\u200Bs\u0000 ring a bell, said the old man softly\u001B",
			),
			"a.txt",
		);
		const [text] = textsOf(outcome);
		const odd = [...(text ?? "")].filter((char) => {
			const code = char.charCodeAt(0);
			return code < 32 || code === 127 || code === 0x200b;
		});
		expect(odd).toEqual([]);
		expect(text).toBe("bells ring a bell, said the old man softly");
	});

	it("keeps lone surrogates out of the Document text", async () => {
		const outcome = await parseText("ok \uD800 text");
		const [text] = textsOf(outcome);
		expect(text).toBe("ok \uFFFD text");
	});

	it("parses text with no extension when it is text", async () => {
		const outcome = await parse(utf8("Just words here."), "README");
		expect(textsOf(outcome)).toEqual(["Just words here."]);
		expect(expectSuccess(outcome).title).toBe("README");
	});
});

describe("plain text: encodings", () => {
	it("decodes UTF-8 with and without a BOM", async () => {
		const plain = await parse(utf8("héllo wörld ünï"), "a.txt");
		const withBom = await parse(
			concat(bytesOf(0xef, 0xbb, 0xbf), utf8("héllo wörld ünï")),
			"a.txt",
		);
		expect(textsOf(plain)).toEqual(["héllo wörld ünï"]);
		expect(textsOf(withBom)).toEqual(["héllo wörld ünï"]);
		expect(expectSuccess(withBom).encoding).toBe("utf-8");
	});

	it("decodes UTF-16 LE and BE with a BOM", async () => {
		const le = await parse(utf16("Привет мир", "le", true), "a.txt");
		const be = await parse(utf16("Привет мир", "be", true), "a.txt");
		expect(textsOf(le)).toEqual(["Привет мир"]);
		expect(textsOf(be)).toEqual(["Привет мир"]);
		expect(expectSuccess(le).encoding).toBe("utf-16le");
		expect(expectSuccess(be).encoding).toBe("utf-16be");
	});

	it("decodes Latin UTF-16 without a BOM by its byte pattern", async () => {
		const le = await parse(
			utf16("Hello there world.\n\nSecond.", "le", false),
			"a.txt",
		);
		const be = await parse(
			utf16("Hello there world.\n\nSecond.", "be", false),
			"a.txt",
		);
		expect(textsOf(le)).toEqual(["Hello there world.", "Second."]);
		expect(textsOf(be)).toEqual(["Hello there world.", "Second."]);
	});

	it("decodes non-Latin UTF-16 without a BOM when spaces give the pattern away", async () => {
		const le = await parse(utf16("Привет мир, как дела", "le", false), "a.txt");
		const be = await parse(utf16("Привет мир, как дела", "be", false), "a.txt");
		expect(textsOf(le)).toEqual(["Привет мир, как дела"]);
		expect(textsOf(be)).toEqual(["Привет мир, как дела"]);
	});

	it("asks for a codepage when UTF-16 without a BOM has no ASCII to give it away", async () => {
		const bytes = utf16("Привет", "le", false);
		expectError(await parse(bytes, "a.txt"), "encoding-suspect");
		const fixed = await parse(bytes, "a.txt", { encoding: "utf-16le" });
		expect(textsOf(fixed)).toEqual(["Привет"]);
	});

	it("rejects bytes that are not valid UTF-8 as encoding-suspect", async () => {
		// "Zażółć" in windows-1250
		const bytes = bytesOf(0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6);
		const error = expectError(await parse(bytes, "a.txt"), "encoding-suspect");
		expect(error.message).toMatch(/encoding/i);
	});

	it.each([
		["windows-1250", "Zażółć", [0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6]],
		["windows-1254", "ışık", [0xfd, 0xfe, 0xfd, 0x6b]],
		["windows-1251", "Привет", [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]],
		["windows-1255", "שלום", [0xf9, 0xec, 0xe5, 0xed]],
		["windows-1256", "سلام", [0xd3, 0xe1, 0xc7, 0xe3]],
	])(
		"decodes a %s TXT when the codepage is passed as a hint",
		async (label, expected, raw) => {
			const outcome = await parse(bytesOf(...raw), "legacy.txt", {
				encoding: label,
			});
			expect(textsOf(outcome)).toEqual([expected]);
			expect(expectSuccess(outcome).encoding).toBe(label);
		},
	);

	it("accepts codepage labels the way TextDecoder does (case, aliases)", async () => {
		const outcome = await parse(bytesOf(0xfd, 0xfe), "a.txt", {
			encoding: " Latin5 ",
		});
		expect(textsOf(outcome)).toEqual(["ış"]);
	});

	it("lets a BOM win over a conflicting hint", async () => {
		const outcome = await parse(utf16("Привет", "le", true), "a.txt", {
			encoding: "windows-1251",
		});
		expect(textsOf(outcome)).toEqual(["Привет"]);
	});

	it("reports an unknown or unusable codepage as unsupported", async () => {
		for (const encoding of [
			"klingon",
			"replacement",
			"iso-2022-cn",
			"",
			"x".repeat(10_000),
		]) {
			expectError(
				await parse(utf8("hello"), "a.txt", { encoding }),
				"unsupported",
			);
		}
	});

	it("ignores a hint that is not a string", async () => {
		const hints = { encoding: 42 } as unknown as Parameters<typeof parse>[2];
		expect(textsOf(await parse(utf8("hello"), "a.txt", hints))).toEqual([
			"hello",
		]);
	});

	it("rejects UTF-32 and binary content", async () => {
		expectError(
			await parse(bytesOf(0xff, 0xfe, 0, 0, 0x68, 0, 0, 0), "a.txt"),
			"unsupported",
		);
		const png = bytesOf(
			0x89,
			0x50,
			0x4e,
			0x47,
			0x0d,
			0x0a,
			0x1a,
			0x0a,
			0,
			0,
			0,
			0x0d,
		);
		expectError(await parse(png, "a.txt"), "unsupported");
		expectError(await parse(png, "photo.png"), "unsupported");
		expectError(
			await parse(bytesOf(0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0), "a.txt"),
			"unsupported",
		);
	});
});

describe("plain text: failures say why", () => {
	it("returns empty for no bytes, whitespace, a BOM alone or only control characters", async () => {
		expectError(await parse(new Uint8Array(0), "a.txt"), "empty");
		expectError(await parse(utf8(" \n\t\r\n "), "a.txt"), "empty");
		expectError(await parse(bytesOf(0xef, 0xbb, 0xbf), "a.txt"), "empty");
		expectError(await parse(utf8("\u200B\u0007"), "a.txt"), "empty");
		expectError(await parseText(""), "empty");
		expectError(await parseText("   \n "), "empty");
	});

	it("returns too-big above the byte limit and accepts exactly the limit", async () => {
		expectError(
			await parse(utf8("0123456789A"), "a.txt", { maxBytes: 10 }),
			"too-big",
		);
		expect(
			textsOf(await parse(utf8("0123456789"), "a.txt", { maxBytes: 10 })),
		).toEqual(["0123456789"]);
	});

	it("never lets a hint raise the built-in 100 MB limit", async () => {
		const big = new Uint8Array(100_000_001);
		expectError(await parse(big, "a.txt"), "too-big");
		expectError(
			await parse(big, "a.txt", { maxBytes: Number.MAX_SAFE_INTEGER }),
			"too-big",
		);
		expectError(await parse(big, "a.txt", { maxBytes: Number.NaN }), "too-big");
	});

	it("returns too-big when the paragraph count passes the block limit", async () => {
		const text = "a\n\nb\n\nc\n\nd";
		expectError(await parse(utf8(text), "a.txt", { maxBlocks: 3 }), "too-big");
		expect(
			blocksOf(await parse(utf8(text), "a.txt", { maxBlocks: 4 })),
		).toHaveLength(4);
		expectError(await parseText(text, { maxBlocks: 3 }), "too-big");
	});

	it("returns unsupported for files that are neither text nor a known format", async () => {
		expectError(
			await parse(bytesOf(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0), "setup.exe"),
			"unsupported",
		);
		expectError(
			await parse(bytesOf(1, 2, 3, 4, 5, 0, 0, 0, 9, 9), "mystery"),
			"unsupported",
		);
	});

	it("returns unsupported for markup formats whose parser has not landed yet", async () => {
		expectError(
			await parse(
				utf8("<FictionBook><body>x</body></FictionBook>"),
				"book.fb2",
			),
			"unsupported",
		);
	});

	it("treats a control-heavy file without NUL bytes as an encoding problem", async () => {
		const noise = Uint8Array.from({ length: 200 }, (_, i) => (i % 7) + 1);
		expectError(await parse(noise, "a.txt"), "encoding-suspect");
	});

	it("returns unsupported, never throws, for input that is not bytes", async () => {
		for (const bad of [
			null,
			undefined,
			"text",
			12,
			{},
			[1, 2, 3],
			new Date(0),
		]) {
			const outcome = await parse(bad as unknown as Uint8Array, "a.txt");
			expectError(outcome, "unsupported");
		}
	});

	it("never throws on hostile file names and hints", async () => {
		const throwing = {
			get encoding(): string {
				throw new Error("boom");
			},
		} as unknown as Parameters<typeof parse>[2];
		for (const hints of [
			null,
			"x",
			5,
			[],
			throwing,
			{ maxBytes: "10" },
			{ language: {} },
		]) {
			expectWellFormed(await parse(utf8("hello"), "a.txt", hints as never));
		}
		for (const name of [
			undefined,
			null,
			5,
			{},
			"",
			".",
			"..",
			"a.",
			".txt",
			"\u0000.txt",
			`${"x".repeat(50_000)}.txt`,
		]) {
			expectWellFormed(await parse(utf8("hello"), name as never));
		}
	});
});

describe("plain text: titles and views", () => {
	it("takes the title from the file name stem and cleans it", async () => {
		const title = async (name: string) =>
			expectSuccess(await parse(utf8("body"), name)).title;
		expect(await title("My Book.TXT")).toBe("My Book");
		expect(await title("../../etc/notes.txt")).toBe("notes");
		expect(await title("C:\\docs\\story.txt")).toBe("story");
		expect(await title("tab\tname\u0007.txt")).toBe("tab name");
		expect(await title(".txt")).toBeNull();
		expect(await title("")).toBeNull();
		expect(
			((await title(`${"w".repeat(500)}.txt`)) ?? "").length,
		).toBeLessThanOrEqual(200);
	});

	it("honours the byte view of a subarray, not the whole buffer", async () => {
		const backing = utf8("XXXXhello worldYYYY");
		const view = backing.subarray(4, 15);
		expect(textsOf(await parse(view, "a.txt"))).toEqual(["hello world"]);
		expect(
			textsOf(await parse(view.buffer.slice(4, 15) as ArrayBuffer, "a.txt")),
		).toEqual(["hello world"]);
	});

	it("treats a detached buffer as empty", async () => {
		const buffer = utf8("hello").buffer.slice(0) as ArrayBuffer;
		structuredClone(buffer, { transfer: [buffer] });
		expectError(await parse(buffer, "a.txt"), "empty");
	});
});

describe("pasted text", () => {
	it("parses a string into paragraphs with no title", async () => {
		const result = expectSuccess(await parseText("First.\n\nSecond."));
		expect(
			result.document.blocks.map((b) => (b.kind === "paragraph" ? b.text : "")),
		).toEqual(["First.", "Second."]);
		expect(result.format).toBe("pasted");
		expect(result.title).toBeNull();
		expect(result.encoding).toBeNull();
	});
});
