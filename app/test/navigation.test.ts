import type { Document } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	chapterAt,
	chapterList,
	PROGRESS_BIG_STEP,
	PROGRESS_STEP,
	progressForKey,
	progressFromPointer,
} from "../src/lib/reader/navigation.ts";

const heading = (text: string, level: 1 | 2 | 3 = 1) => ({
	kind: "heading" as const,
	level,
	text,
	spans: [],
});
const paragraph = (text: string) => ({
	kind: "paragraph" as const,
	text,
	spans: [],
});

const book: Document = {
	version: 1,
	blocks: [
		paragraph("A preface with no heading."),
		heading("One", 1),
		paragraph("First chapter text."),
		heading("A section", 3),
		paragraph("Still chapter one."),
		heading("Two", 2),
		paragraph("Second chapter text."),
	],
};

describe("the chapter list", () => {
	it("holds every level 1 or 2 heading, with its title and where it starts", () => {
		expect(chapterList(book)).toEqual([
			{ title: "One", position: { block: 1, offset: 0 } },
			{ title: "Two", position: { block: 5, offset: 0 } },
		]);
	});

	it("is empty for a text with no headings", () => {
		expect(
			chapterList({ version: 1, blocks: [paragraph("Just text.")] }),
		).toEqual([]);
	});

	it("tidies the title and falls back to a number for an empty heading", () => {
		const document: Document = {
			version: 1,
			blocks: [heading("  Spaced   title \n"), heading("   "), paragraph("x")],
		};
		expect(chapterList(document).map((chapter) => chapter.title)).toEqual([
			"Spaced title",
			"2",
		]);
	});
});

describe("the chapter the reader is in", () => {
	const chapters = chapterList(book);

	it("is the last chapter that has started", () => {
		expect(chapterAt(chapters, { block: 1, offset: 0 })).toBe(0);
		expect(chapterAt(chapters, { block: 4, offset: 3 })).toBe(0);
		expect(chapterAt(chapters, { block: 5, offset: 0 })).toBe(1);
		expect(chapterAt(chapters, { block: 6, offset: 9 })).toBe(1);
	});

	it("is none before the first chapter or when there are none", () => {
		expect(chapterAt(chapters, { block: 0, offset: 5 })).toBe(-1);
		expect(chapterAt([], { block: 3, offset: 0 })).toBe(-1);
	});
});

describe("the progress slider's keys", () => {
	const key = (name: string, shiftKey = false) => ({ key: name, shiftKey });

	it("steps by 1% with the arrows, 10% with Shift or the Page keys", () => {
		expect(PROGRESS_STEP).toBeCloseTo(0.01);
		expect(PROGRESS_BIG_STEP).toBeCloseTo(0.1);
		expect(progressForKey(key("ArrowRight"), 0.5)).toBeCloseTo(0.51);
		expect(progressForKey(key("ArrowUp"), 0.5)).toBeCloseTo(0.51);
		expect(progressForKey(key("ArrowLeft"), 0.5)).toBeCloseTo(0.49);
		expect(progressForKey(key("ArrowDown"), 0.5)).toBeCloseTo(0.49);
		expect(progressForKey(key("ArrowRight", true), 0.5)).toBeCloseTo(0.6);
		expect(progressForKey(key("PageUp"), 0.5)).toBeCloseTo(0.6);
		expect(progressForKey(key("PageDown"), 0.5)).toBeCloseTo(0.4);
	});

	it("jumps to the start with Home and the end with End", () => {
		expect(progressForKey(key("Home"), 0.5)).toBe(0);
		expect(progressForKey(key("End"), 0.5)).toBe(1);
	});

	it("stays between 0 and 1", () => {
		expect(progressForKey(key("ArrowLeft"), 0)).toBe(0);
		expect(progressForKey(key("PageDown"), 0.05)).toBe(0);
		expect(progressForKey(key("ArrowRight"), 1)).toBe(1);
		expect(progressForKey(key("PageUp"), 0.95)).toBe(1);
	});

	it("leaves other keys alone", () => {
		expect(progressForKey(key("a"), 0.5)).toBeUndefined();
		expect(progressForKey(key("Enter"), 0.5)).toBeUndefined();
	});
});

describe("dragging on the progress bar", () => {
	it("turns the pointer's place on the bar into a share of the text", () => {
		expect(progressFromPointer(150, 100, 200)).toBeCloseTo(0.25);
		expect(progressFromPointer(100, 100, 200)).toBe(0);
		expect(progressFromPointer(300, 100, 200)).toBe(1);
	});

	it("clamps a pointer outside the bar, and a bar with no width is the start", () => {
		expect(progressFromPointer(20, 100, 200)).toBe(0);
		expect(progressFromPointer(900, 100, 200)).toBe(1);
		expect(progressFromPointer(150, 100, 0)).toBe(0);
	});
});
