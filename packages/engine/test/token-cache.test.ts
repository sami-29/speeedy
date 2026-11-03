import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	rebuildTimeline,
	rebuildWindow,
	type TokenizedBlock,
} from "../src/index";
import { paragraphs } from "./helpers";

const document = paragraphs(
	'He said "stop (now)." Then left. Another sentence here.',
	"A second block, with (an aside) in it.",
);

describe("token cache", () => {
	it("is filled by a build, one entry per block, and changes nothing", () => {
		const tokenCache = new Map<number, TokenizedBlock>();
		const cached = buildTimeline(document, { wpm: 300 }, { tokenCache });
		expect([...tokenCache.keys()]).toEqual([0, 1]);
		expect(cached).toEqual(buildTimeline(document, { wpm: 300 }));
	});

	it("gives the same rebuild and window as no cache, and reuses the tokens", () => {
		const tokenCache = new Map<number, TokenizedBlock>();
		const base = buildTimeline(document, { wpm: 300 }, { tokenCache });
		const stored = [...tokenCache.values()];
		const settings = { wpm: 300, chunkSize: 2, smartSpeed: true };
		expect(
			rebuildTimeline(document, base, 3, settings, { tokenCache }),
		).toEqual(rebuildTimeline(document, base, 3, settings));
		expect(
			rebuildWindow(document, base, 3, settings, { tokenCache }, 5),
		).toEqual(rebuildWindow(document, base, 3, settings, {}, 5));
		// Nothing was tokenized again: the very same entries are still there.
		expect([...tokenCache.values()]).toEqual(stored);
		stored.forEach((entry, i) =>
			expect([...tokenCache.values()][i]).toBe(entry),
		);
	});
});
