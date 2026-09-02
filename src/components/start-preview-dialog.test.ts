import { describe, expect, it } from "vitest";
import { buildPreviewParagraphs } from "../components/start-preview-dialog.js";
import { tokenize } from "../services/rsvp-engine.js";

describe("buildPreviewParagraphs", () => {
	it("assigns word indices that match tokenize()", () => {
		const text = `Copyright 2024.\n\nAll rights reserved.\n\nChapter One\n\nIt was a dark and stormy night.`;
		const paras = buildPreviewParagraphs(text);
		const tokens = tokenize(text);

		expect(paras.length).toBe(4);
		expect(paras[0].startWordIndex).toBe(0);
		expect(paras[2].text).toContain("Chapter One");

		const last = paras[paras.length - 1];
		expect(last.startWordIndex + last.wordCount).toBe(tokens.length);
	});

	it("returns empty for blank text", () => {
		expect(buildPreviewParagraphs("   ")).toEqual([]);
	});
});
