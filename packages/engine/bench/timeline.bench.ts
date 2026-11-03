import { bench, describe } from "vitest";
import { buildTimeline, rebuildTimeline } from "../src/index";

const WORDS = [
	"the",
	"reader",
	"quietly",
	"opened",
	"a",
	"wonderful,",
	"old",
	"book.",
	'"Stop,"',
	"she",
	"said",
	"(really)",
	"and",
	"turned",
	"every",
	"page;",
	"nothing",
	"else",
	"mattered?",
	"Yes.",
];

const TOTAL_WORDS = 100_000;
const WORDS_PER_PARAGRAPH = 100;

/** 100k words in 1000 paragraphs, with a realistic spread of punctuation and word lengths. */
const document = {
	version: 1 as const,
	blocks: Array.from({ length: TOTAL_WORDS / WORDS_PER_PARAGRAPH }, (_, p) => ({
		kind: "paragraph" as const,
		text: Array.from(
			{ length: WORDS_PER_PARAGRAPH },
			(_, w) => WORDS[(p * 7 + w * 3) % WORDS.length],
		).join(" "),
		spans: [],
	})),
};

const everything = {
	wpm: 300,
	smartSpeed: true,
	chunkSize: 3,
	rampSpanWords: 30,
	sprintEveryWords: 50,
	sprintWords: 10,
};

describe("Timeline build, 100k words", () => {
	bench("defaults", () => {
		buildTimeline(document, { wpm: 300 });
	});

	bench("every pacing rule and chunk size 3", () => {
		buildTimeline(document, everything);
	});

	const built = buildTimeline(document, { wpm: 300 });
	bench("rebuild from the middle (live setting change)", () => {
		rebuildTimeline(document, built, Math.floor(built.frames.length / 2), {
			wpm: 400,
		});
	});
});
