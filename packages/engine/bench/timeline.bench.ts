import { bench, describe } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	rebuildTimeline,
	rebuildWindow,
	resolveSettings,
	spliceTimeline,
	type TokenizedBlock,
} from "../src/index";

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

describe("A live settings change, 100k words, Cursor in the middle", () => {
	// The Timeline worker keeps the tokens of the Document it built, so a rebuild skips them.
	const tokenCache = new Map<number, TokenizedBlock>();
	const timeline = buildTimeline(document, { wpm: 300 }, { tokenCache });
	const middle = Math.floor(timeline.frames.length / 2);
	const engine = createEngine({
		clock: createManualClock(),
		timeline: buildTimeline(document, { wpm: 300 }),
		settings: { wpm: 300 },
	});
	let fast = false;

	// A change of speed: a constant-time change of the Engine's clock rate, no rebuild.
	bench("speed change (Engine.setWpm)", () => {
		fast = !fast;
		engine.setWpm(fast ? 450 : 300);
	});

	// A chunk size or toggle change, phase one: the first Frames, which the reader waits for.
	bench("structural change, phase one: the window (2000 words)", () => {
		rebuildWindow(
			document,
			timeline,
			middle,
			{ wpm: 300, chunkSize: 3 },
			{ tokenCache },
			2000,
		);
	});

	// Phase two: everything after it, built while the reader keeps reading the window.
	bench("structural change, both phases: the full tail", () => {
		rebuildTimeline(
			document,
			timeline,
			middle,
			{ wpm: 300, chunkSize: 3 },
			{ tokenCache },
		);
	});
});

describe("A structural change as the reader sees it, 100k words, Cursor in the middle", () => {
	const tokenCache = new Map<number, TokenizedBlock>();
	const base = buildTimeline(document, { wpm: 300 }, { tokenCache });
	const middle = Math.floor(base.frames.length / 2);
	const engine = createEngine({
		clock: createManualClock(),
		timeline: base,
		settings: { wpm: 300 },
	});

	// Everything on the path except the debounce and the thread hop's latency: the worker's
	// window, its copy across (structuredClone stands in for postMessage), and laying it over
	// the Frames the Engine has.
	bench("window, copy across, splice and replace", () => {
		const settings = { wpm: 300, chunkSize: 3 };
		const window = rebuildWindow(
			document,
			engine.timeline,
			middle,
			settings,
			{ tokenCache },
			2000,
		);
		const frames = structuredClone(window.frames);
		const last = frames[frames.length - 1];
		const next = engine.timeline.frames.findIndex(
			(frame, index) =>
				index >= middle &&
				last !== undefined &&
				(frame.position.block > last.end.block ||
					(frame.position.block === last.end.block &&
						frame.position.offset >= last.end.offset)),
		);
		engine.replaceTimeline(
			spliceTimeline(
				engine.timeline,
				{
					id: 1,
					phase: "window",
					fromIndex: middle,
					replaceCount: next - middle,
					last: false,
					endMs: last ? last.startMs + last.durationMs : 0,
					settings: resolveSettings(settings),
					frames,
				},
				300,
			),
			settings,
		);
	});
});
