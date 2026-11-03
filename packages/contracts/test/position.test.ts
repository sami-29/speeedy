import { describe, expect, it } from "vitest";
import {
	type Block,
	blockText,
	clampPosition,
	comparePositions,
	type Document,
	isPosition,
	type Position,
} from "../src/index";

const document: Document = {
	version: 1,
	blocks: [
		{ kind: "heading", level: 1, text: "Title", spans: [] },
		{ kind: "image-placeholder", alt: "Chart" },
		{ kind: "paragraph", text: "Hello world", spans: [] },
	],
};

const at = (block: number, offset: number): Position => ({ block, offset });

const blockAt = (index: number): Block => {
	const block = document.blocks[index];
	if (!block) throw new Error(`no block ${index}`);
	return block;
};

describe("blockText", () => {
	it("returns the text of a text block", () => {
		expect(blockText(blockAt(2))).toBe("Hello world");
	});

	it("returns the alt text of an image placeholder", () => {
		expect(blockText(blockAt(1))).toBe("Chart");
	});
});

describe("comparePositions", () => {
	it("orders by block first", () => {
		expect(comparePositions(at(0, 9), at(1, 0))).toBeLessThan(0);
		expect(comparePositions(at(2, 0), at(1, 9))).toBeGreaterThan(0);
	});

	it("orders by offset within a block", () => {
		expect(comparePositions(at(1, 2), at(1, 5))).toBeLessThan(0);
		expect(comparePositions(at(1, 5), at(1, 2))).toBeGreaterThan(0);
	});

	it("returns 0 for equal positions", () => {
		expect(comparePositions(at(3, 4), at(3, 4))).toBe(0);
	});

	it("sorts a list into reading order", () => {
		const sorted = [at(2, 1), at(0, 5), at(2, 0), at(1, 0)].sort(
			comparePositions,
		);
		expect(sorted).toEqual([at(0, 5), at(1, 0), at(2, 0), at(2, 1)]);
	});
});

describe("clampPosition", () => {
	it("leaves a valid position alone", () => {
		expect(clampPosition(at(2, 5), document)).toEqual(at(2, 5));
	});

	it("allows the end of a block (offset equal to the text length)", () => {
		expect(clampPosition(at(2, 11), document)).toEqual(at(2, 11));
	});

	it("clamps an offset past the end of its block", () => {
		expect(clampPosition(at(0, 99), document)).toEqual(at(0, 5));
	});

	it("clamps a negative offset to the start of the block", () => {
		expect(clampPosition(at(2, -3), document)).toEqual(at(2, 0));
	});

	it("clamps a block past the last block to the end of the last block", () => {
		expect(clampPosition(at(9, 0), document)).toEqual(at(2, 11));
	});

	it("clamps a negative block to the start of the document", () => {
		expect(clampPosition(at(-1, 4), document)).toEqual(at(0, 0));
	});

	it("measures an image placeholder by its alt text", () => {
		expect(clampPosition(at(1, 50), document)).toEqual(at(1, 5));
	});

	it("floors fractional offsets", () => {
		expect(clampPosition(at(2, 2.9), document)).toEqual(at(2, 2));
	});

	it("maps NaN to the start", () => {
		expect(clampPosition(at(Number.NaN, Number.NaN), document)).toEqual(
			at(0, 0),
		);
	});

	it("returns the origin for an empty Document", () => {
		expect(clampPosition(at(4, 4), { version: 1, blocks: [] })).toEqual(
			at(0, 0),
		);
	});

	it("does not mutate its input", () => {
		const input = at(0, 99);
		clampPosition(input, document);
		expect(input).toEqual(at(0, 99));
	});
});

describe("isPosition", () => {
	it("accepts a block index and character offset", () => {
		expect(isPosition({ block: 0, offset: 0 })).toBe(true);
		expect(isPosition({ block: 12, offset: 340 })).toBe(true);
	});

	it.each([
		null,
		"x",
		[],
		{},
		{ block: 0 },
		{ offset: 0 },
		{ block: -1, offset: 0 },
		{ block: 0, offset: -1 },
		{ block: 0.5, offset: 0 },
		{ block: 0, offset: Number.NaN },
		{ block: 0, offset: Number.POSITIVE_INFINITY },
		{ block: 0, offset: 0, word: 3 },
	])("rejects %j", (value) => {
		expect(isPosition(value)).toBe(false);
	});
});
