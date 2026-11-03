import type { Document } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	progressSeeker,
	progressTracker,
} from "../src/lib/library/progress.ts";

const paragraph = (text: string) => ({
	kind: "paragraph" as const,
	text,
	spans: [],
});

const document: Document = {
	version: 1,
	blocks: [paragraph("aaaa"), paragraph("bbbbbb"), paragraph("cccccccccc")],
};

describe("seeking by share of the text", () => {
	const seek = progressSeeker(document);

	it("starts at the first block and ends at the end of the last", () => {
		expect(seek(0)).toEqual({ block: 0, offset: 0 });
		expect(seek(1)).toEqual({ block: 2, offset: 10 });
	});

	it("lands inside the block that holds that share of the characters", () => {
		// 20 characters: 4 + 6 + 10. Half is character 10, the start of the third block.
		expect(seek(0.5)).toEqual({ block: 2, offset: 0 });
		expect(seek(0.3)).toEqual({ block: 1, offset: 2 });
		expect(seek(0.1)).toEqual({ block: 0, offset: 2 });
	});

	it("puts a block boundary at the start of the later block", () => {
		expect(seek(0.2)).toEqual({ block: 1, offset: 0 });
	});

	it("clamps a share outside 0 to 1", () => {
		expect(seek(-1)).toEqual({ block: 0, offset: 0 });
		expect(seek(4)).toEqual({ block: 2, offset: 10 });
		expect(seek(Number.NaN)).toEqual({ block: 0, offset: 0 });
	});

	it("is the inverse of the progress tracker", () => {
		const progress = progressTracker(document);
		for (const share of [0, 0.15, 0.4, 0.75, 0.95]) {
			expect(progress(seek(share))).toBeCloseTo(share, 1);
		}
	});

	it("skips blocks with no text, such as an image with no alt text", () => {
		const withImage: Document = {
			version: 1,
			blocks: [
				paragraph("aaaa"),
				{ kind: "image-placeholder", alt: "" },
				paragraph("bbbb"),
			],
		};
		expect(progressSeeker(withImage)(0.75)).toEqual({ block: 2, offset: 2 });
		expect(progressSeeker(withImage)(0.5)).toEqual({ block: 2, offset: 0 });
	});

	it("gives the origin for a Document with no text", () => {
		expect(progressSeeker({ version: 1, blocks: [] })(0.5)).toEqual({
			block: 0,
			offset: 0,
		});
	});
});
