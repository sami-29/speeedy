import type { Block, ParagraphBlock, Span } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	expandWindow,
	flatPieces,
	listMarkers,
	listStarts,
	overlapping,
	type Piece,
	pieces,
	safeHref,
} from "../src/lib/reader/pacer/pieces.ts";

const paragraph = (text: string, spans: Span[] = []): ParagraphBlock => ({
	kind: "paragraph",
	text,
	spans,
});

const joined = (list: readonly Piece[]) => list.map((p) => p.text).join("");

describe("pieces", () => {
	it("cuts a block at word edges, keeping every character exactly once", () => {
		const block = paragraph("One two  three.\tFour");
		const list = pieces(block);
		expect(joined(list)).toBe(block.text);
		expect(list.filter((p) => p.kind === "word").map((p) => p.text)).toEqual([
			"One",
			"two",
			"three.",
			"Four",
		]);
		// Whitespace is a piece too, so the highlight is unbroken between two words.
		expect(list.filter((p) => p.kind === "space").map((p) => p.text)).toEqual([
			" ",
			"  ",
			"\t",
		]);
	});

	it("gives each piece its start and end offsets in UTF-16 units", () => {
		const list = pieces(paragraph("ab cd"));
		expect(list.map((p) => [p.start, p.end])).toEqual([
			[0, 2],
			[2, 3],
			[3, 5],
		]);
	});

	it("cuts at span edges and tells which pieces are emphasis, strong or links", () => {
		const block = paragraph("a bold word", [
			{ kind: "strong", start: 2, end: 6 },
			{ kind: "emphasis", start: 2, end: 11 },
			{ kind: "link", start: 7, end: 11, href: "https://example.com/" },
		]);
		const list = pieces(block);
		expect(joined(list)).toBe(block.text);
		const bold = list.find((p) => p.text === "bold");
		expect(bold).toMatchObject({ strong: true, emphasis: true, href: null });
		const word = list.find((p) => p.text === "word");
		expect(word).toMatchObject({
			strong: false,
			emphasis: true,
			href: "https://example.com/",
		});
		expect(list.find((p) => p.text === "a")).toMatchObject({
			strong: false,
			emphasis: false,
			href: null,
		});
	});

	it("splits a word where a span starts or ends inside it", () => {
		const list = pieces(
			paragraph("unbelievable", [{ kind: "strong", start: 2, end: 6 }]),
		);
		expect(list.map((p) => p.text)).toEqual(["un", "beli", "evable"]);
		expect(list.map((p) => p.strong)).toEqual([false, true, false]);
		expect(list.every((p) => p.kind === "word")).toBe(true);
	});

	it("keeps every character of Turkish, Arabic and astral text", () => {
		for (const text of [
			"İstanbul'da çocuklar ışık görüyor",
			"مرحبا بالعالم الجميل",
			"smile 😀 and 𝒳 done",
		]) {
			const list = pieces(paragraph(text));
			expect(joined(list)).toBe(text);
			let at = 0;
			for (const piece of list) {
				expect(piece.start).toBe(at);
				at = piece.end;
			}
			expect(at).toBe(text.length);
		}
	});

	it("keeps newlines in code as whitespace pieces", () => {
		const list = pieces({
			kind: "code",
			text: "let x = 1;\nlet y = 2;",
			spans: [],
		});
		expect(list.some((p) => p.kind === "space" && p.text === "\n")).toBe(true);
		expect(joined(list)).toBe("let x = 1;\nlet y = 2;");
	});

	it("reads an image placeholder's alt text, which is what its Positions point into", () => {
		const list = pieces({ kind: "image-placeholder", alt: "A red fox" });
		expect(list.filter((p) => p.kind === "word").map((p) => p.text)).toEqual([
			"A",
			"red",
			"fox",
		]);
		expect(pieces({ kind: "image-placeholder", alt: "" })).toEqual([]);
	});

	it("gives an empty block no pieces", () => {
		expect(pieces(paragraph(""))).toEqual([]);
	});

	it("drops a link whose address is not http, https or mailto", () => {
		for (const href of [
			"javascript:alert(1)",
			" JaVaScRiPt:alert(1)",
			"java\nscript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:x",
			"file:///etc/passwd",
			"/relative/path",
			"#anchor",
			"//evil.example/",
		]) {
			const list = pieces(
				paragraph("click here", [{ kind: "link", start: 0, end: 10, href }]),
			);
			expect(list.every((p) => p.href === null)).toBe(true);
			expect(joined(list)).toBe("click here");
		}
		for (const href of [
			"http://a.example/x",
			"HTTPS://a.example/x",
			"mailto:me@example.com",
		]) {
			const list = pieces(
				paragraph("mail", [{ kind: "link", start: 0, end: 4, href }]),
			);
			expect(list[0]?.href).not.toBeNull();
		}
	});
});

describe("safeHref", () => {
	it("keeps the three safe schemes and nothing else", () => {
		expect(safeHref("https://a.example/")).toBe("https://a.example/");
		expect(safeHref("http://a.example/")).toBe("http://a.example/");
		expect(safeHref("mailto:a@b.example")).toBe("mailto:a@b.example");
		expect(safeHref("javascript:alert(1)")).toBeNull();
		expect(safeHref("")).toBeNull();
		expect(safeHref("not a url")).toBeNull();
	});
});

describe("flatPieces", () => {
	it("cuts only at span edges, so a long block is a few nodes", () => {
		const block = paragraph("many words in a long block of text", [
			{ kind: "emphasis", start: 5, end: 10 },
		]);
		const list = flatPieces(block);
		expect(list.map((p) => p.text)).toEqual([
			"many ",
			"words",
			" in a long block of text",
		]);
		expect(list.every((p) => p.kind === "flat")).toBe(true);
		expect(list[1]?.emphasis).toBe(true);
	});
});

describe("expanded window", () => {
	const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
	const block = paragraph(text);

	it("splits words only inside the window and keeps the rest flat", () => {
		const from = text.indexOf("word50");
		const to = text.indexOf("word60");
		const list = pieces(block, { from, to });
		expect(joined(list)).toBe(text);
		const inside = list.filter((p) => p.kind !== "flat");
		expect(inside[0]?.start).toBe(from);
		expect(inside[inside.length - 1]?.end).toBe(to);
		expect(inside.filter((p) => p.kind === "word")).toHaveLength(10);
		expect(list.filter((p) => p.kind === "flat")).toHaveLength(2);
	});

	it("finds a window that holds the offset and starts and ends between words", () => {
		const around = text.indexOf("word100");
		const win = expandWindow(text, around, 300);
		expect(win.from).toBeLessThanOrEqual(around);
		expect(win.to).toBeGreaterThan(around);
		expect(win.from === 0 || /\s/.test(text[win.from - 1] ?? "")).toBe(true);
		expect(win.to === text.length || /\s/.test(text[win.to] ?? "")).toBe(true);
		expect(win.to - win.from).toBeLessThan(800);
	});

	it("covers a short text whole", () => {
		expect(expandWindow("a few words", 4, 300)).toEqual({ from: 0, to: 11 });
	});

	it("clamps at both ends of the text", () => {
		expect(expandWindow(text, 0, 100).from).toBe(0);
		expect(expandWindow(text, text.length, 100).to).toBe(text.length);
	});
});

describe("overlapping", () => {
	const list = pieces(paragraph("aa bb cc dd"));
	// aa(0-2) _(2-3) bb(3-5) _(5-6) cc(6-8) _(8-9) dd(9-11)

	it("finds the pieces a range touches, and the ones read before it", () => {
		expect(overlapping(list, 3, 5)).toEqual({ lo: 2, hi: 3 });
		expect(overlapping(list, 3, 8)).toEqual({ lo: 2, hi: 5 });
		expect(overlapping(list, 0, 2)).toEqual({ lo: 0, hi: 1 });
		expect(overlapping(list, 9, 11)).toEqual({ lo: 6, hi: 7 });
	});

	it("gives an empty range at the position for a range with no width", () => {
		const { lo, hi } = overlapping(list, 6, 6);
		expect(hi).toBe(lo);
	});

	it("puts everything before a range that starts past the end", () => {
		expect(overlapping(list, 50, 60)).toEqual({ lo: 7, hi: 7 });
	});
});

describe("listMarkers", () => {
	const item = (depth: number, ordered: boolean): Block => ({
		kind: "list-item",
		depth,
		ordered,
		text: "x",
		spans: [],
	});
	const text: Block = { kind: "paragraph", text: "x", spans: [] };

	it("numbers an ordered run and bullets an unordered one", () => {
		expect(
			listMarkers([item(0, true), item(0, true), item(0, false), text]),
		).toEqual(["1.", "2.", "•", null]);
	});

	it("restarts the count after any other block", () => {
		expect(
			listMarkers([item(0, true), item(0, true), text, item(0, true)]),
		).toEqual(["1.", "2.", null, "1."]);
	});

	it("counts each depth on its own and restarts a nested list", () => {
		expect(
			listMarkers([
				item(0, true),
				item(1, true),
				item(1, true),
				item(0, true),
				item(1, true),
			]),
		).toEqual(["1.", "1.", "2.", "2.", "1."]);
	});

	it("copes with a list that starts deeper than its first level", () => {
		expect(listMarkers([item(2, true), item(0, true)])).toEqual(["1.", "1."]);
	});
});

describe("listStarts", () => {
	const item = (depth: number, ordered: boolean): Block => ({
		kind: "list-item",
		depth,
		ordered,
		text: "x",
		spans: [],
	});
	const text: Block = { kind: "paragraph", text: "x", spans: [] };

	it("starts a list at the first item after any other block", () => {
		expect(
			listStarts([text, item(0, false), item(0, false), text, item(0, false)]),
		).toEqual([false, true, false, false, true]);
	});

	it("starts a new list where a bullet list turns into a numbered one", () => {
		expect(
			listStarts([
				item(0, false),
				item(1, false),
				item(0, true),
				item(0, true),
			]),
		).toEqual([true, false, true, false]);
	});

	it("keeps a nested list inside the list it belongs to", () => {
		expect(listStarts([item(0, true), item(1, false), item(0, true)])).toEqual([
			true,
			false,
			false,
		]);
	});
});
