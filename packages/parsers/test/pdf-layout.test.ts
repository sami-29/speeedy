import { describe, expect, it } from "vitest";
import { buildPageLines, type RawItem } from "../src/pdf/layout";

/** One run of text at (x, y) with the given width, drawn upright at 10 pt. */
const item = (
	str: string,
	x: number,
	y: number,
	width: number,
	dir = "ltr",
): RawItem => ({
	str,
	transform: [10, 0, 0, 10, x, y],
	width,
	fontName: "f1",
	dir,
});

const VIEW = [0, 0, 612, 792];

describe("pdf layout: right-to-left pages", () => {
	// Words are in reading (logical) order; the first word sits furthest right.
	const words = ["אחד", "שתיים", "שלוש"];

	it("reads a right-to-left line from its right end", () => {
		const items = [0, 1, 2, 3, 4, 5].flatMap((row) =>
			words.map((word, i) =>
				item(word, 500 - i * 60, 700 - row * 14, 56, "rtl"),
			),
		);
		const page = buildPageLines(items, VIEW);
		expect(page.lines).toHaveLength(6);
		for (const line of page.lines) expect(line.text).toBe(words.join(" "));
	});

	it("reads the right column of a right-to-left page first", () => {
		const column = (x: number, label: string) =>
			[0, 1, 2, 3].flatMap((row) => [
				item(`${label}${row}a`, x + 120, 700 - row * 14, 60, "rtl"),
				item(`${label}${row}b`, x + 56, 700 - row * 14, 60, "rtl"),
			]);
		const items = [...column(60, "L"), ...column(340, "R")];
		const page = buildPageLines(items, VIEW);
		expect(page.lines.map((l) => l.text)).toEqual([
			"R0a R0b",
			"R1a R1b",
			"R2a R2b",
			"R3a R3b",
			"L0a L0b",
			"L1a L1b",
			"L2a L2b",
			"L3a L3b",
		]);
	});

	it("leaves a left-to-right page alone", () => {
		const items = [0, 1, 2, 3, 4, 5].flatMap((row) =>
			["one", "two", "three"].map((word, i) =>
				item(word, 72 + i * 60, 700 - row * 14, 56),
			),
		);
		const page = buildPageLines(items, VIEW);
		for (const line of page.lines) expect(line.text).toBe("one two three");
	});
});

describe("pdf layout: bad numbers", () => {
	it("ignores items with non-finite or absurd geometry", () => {
		const items: RawItem[] = [
			item("fine", 72, 700, 30),
			{ ...item("nan", Number.NaN, 700, 30) },
			{ ...item("inf", Number.POSITIVE_INFINITY, 690, 30) },
			{ ...item("wide", 72, 680, Number.NaN) },
			{ ...item("huge", 72, 670, 30), transform: [1e12, 0, 0, 1e12, 72, 670] },
			{ ...item("short", 72, 660, 30), transform: [10, 0] },
			{ ...item("noise", 72, 650, 30), transform: "nope" as never },
		];
		const page = buildPageLines(items, VIEW);
		const text = page.lines.map((l) => l.text).join("|");
		expect(text).toContain("fine");
		expect(text).not.toContain("nan");
		expect(text).not.toContain("inf");
		expect(text).not.toContain("huge");
	});

	it("copes with a missing or empty page box", () => {
		const items = [item("hello", 72, 700, 30)];
		expect(buildPageLines(items, []).lines).toHaveLength(1);
		expect(buildPageLines(items, [0, 0, 0, 0]).lines).toHaveLength(1);
		expect(buildPageLines([], VIEW).lines).toHaveLength(0);
	});
});
