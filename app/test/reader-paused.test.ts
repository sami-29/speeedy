import type { Document } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import { pausedSentence } from "../src/lib/reader/paused.ts";

const doc: Document = {
	version: 1,
	blocks: [
		{ kind: "heading", level: 1, text: "A title", spans: [] },
		{
			kind: "paragraph",
			text: "The cat sat. Then it slept on the warm mat! Nobody minded.",
			spans: [],
		},
	],
} as unknown as Document;

const at = (block: number, from: number, to: number) => ({ block, from, to });

describe("the sentence a paused reader sees", () => {
	it("is the sentence around the word, with the word marked", () => {
		// "slept" is characters 21 to 26 of the paragraph.
		expect(pausedSentence(doc, at(1, 21, 26))).toEqual({
			before: "Then it ",
			now: "slept",
			after: " on the warm mat!",
		});
	});

	it("starts at the first sentence and ends at the last", () => {
		expect(pausedSentence(doc, at(1, 0, 3))).toEqual({
			before: "",
			now: "The",
			after: " cat sat.",
		});
		expect(pausedSentence(doc, at(1, 51, 58))).toEqual({
			before: "Nobody ",
			now: "minded.",
			after: "",
		});
	});

	it("is the whole heading when the word is in one", () => {
		expect(pausedSentence(doc, at(0, 2, 7))).toEqual({
			before: "A ",
			now: "title",
			after: "",
		});
	});

	it("is nothing for a place outside the text", () => {
		expect(pausedSentence(doc, at(9, 0, 1))).toBeNull();
	});
});
