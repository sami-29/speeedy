import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	DEFAULT_SETTINGS,
	type EngineSettings,
	PACING_RULES,
	type PacingContext,
	type PacingFrame,
	pacingMultiplier,
	punctuationRule,
	rampRule,
	smartSpeedRule,
	sprintRule,
} from "../src/index";
import { framesOf, paragraphs } from "./helpers";

const durations = (text: string, settings: Partial<EngineSettings> = {}) =>
	framesOf(text, { wpm: 300, ...settings }).map((frame) => frame.durationMs);

const plainContext = {
	paragraphStart: false,
	inQuotes: false,
	inParens: false,
	inBrackets: false,
	closesAside: false,
};

function frame(
	text: string,
	overrides: Partial<PacingFrame> = {},
): PacingFrame {
	return {
		text,
		words: text.split(/\s+/u).length,
		context: plainContext,
		...overrides,
	};
}

function context(
	settings: Partial<EngineSettings> = {},
	wordsSinceAnchor = 0,
	language?: string,
): PacingContext {
	return {
		settings: { ...DEFAULT_SETTINGS, ...settings },
		wordsSinceAnchor,
		...(language ? { language } : {}),
	};
}

function expectCloseTo(got: number[], want: number[]) {
	expect(got).toHaveLength(want.length);
	got.forEach((ms, i) => {
		expect(ms).toBeCloseTo(want[i] as number, 2);
	});
}

describe("smart speed rule", () => {
	const smart = { smartSpeed: true };

	it("does nothing when smart speed is off", () => {
		expect(smartSpeedRule(frame("wonderful"), context())).toBe(1);
	});

	it("speeds up short words (3 letters or fewer)", () => {
		expect(smartSpeedRule(frame("cat"), context(smart))).toBeCloseTo(
			1 / 1.3,
			6,
		);
	});

	it("leaves 4 and 5 letter words alone", () => {
		expect(smartSpeedRule(frame("word"), context(smart))).toBe(1);
		expect(smartSpeedRule(frame("brown"), context(smart))).toBe(1);
	});

	it("slows 6 to 7 letter words a little and 8 or more letter words more", () => {
		expect(smartSpeedRule(frame("reader"), context(smart))).toBeCloseTo(
			1 / 0.9,
			6,
		);
		expect(smartSpeedRule(frame("wonderful"), context(smart))).toBeCloseTo(
			1 / 0.75,
			6,
		);
	});

	it("counts letters and digits only, not attached punctuation", () => {
		expect(smartSpeedRule(frame("(wonderful),"), context(smart))).toBeCloseTo(
			1 / 0.75,
			6,
		);
	});

	it("speeds up common English words even when longer than 3 letters", () => {
		expect(smartSpeedRule(frame("that"), context(smart))).toBeCloseTo(
			1 / 1.3,
			6,
		);
		expect(smartSpeedRule(frame("that"), context(smart, 0, "pl"))).toBe(1);
	});

	it("averages over the words of a chunk", () => {
		expect(smartSpeedRule(frame("cat wonderful"), context(smart))).toBeCloseTo(
			(1 / 1.3 + 1 / 0.75) / 2,
			6,
		);
	});
});

describe("punctuation rule", () => {
	it("stretches a sentence end by the sentence pause multiplier", () => {
		expect(punctuationRule(frame("end."), context())).toBe(3);
		expect(
			punctuationRule(frame("end."), context({ sentencePauseMultiplier: 3 })),
		).toBe(4);
		expect(
			punctuationRule(frame("end."), context({ sentencePauseMultiplier: 0 })),
		).toBe(1);
	});

	it("looks through closing quotes and brackets", () => {
		expect(punctuationRule(frame('stop."'), context())).toBe(3);
		expect(punctuationRule(frame("what?)"), context())).toBe(3);
	});

	it("stretches commas less, or like a sentence with commaAsPause", () => {
		expect(punctuationRule(frame("so,"), context())).toBeCloseTo(1.8, 6);
		expect(punctuationRule(frame("so,"), context({ commaAsPause: true }))).toBe(
			3,
		);
	});

	it("adds the paragraph pause on a paragraph start", () => {
		const start = frame("Word", {
			context: { ...plainContext, paragraphStart: true },
		});
		expect(punctuationRule(start, context())).toBeCloseTo(1.8, 6);
		expect(
			punctuationRule(start, context({ paragraphPauseMultiplier: 1 })),
		).toBe(1);
	});

	it("adds a short pause when a Frame closes an aside, if enabled", () => {
		const closes = frame("really)", {
			context: { ...plainContext, closesAside: true },
		});
		expect(punctuationRule(closes, context())).toBeCloseTo(1.15, 6);
		expect(
			punctuationRule(closes, context({ contextPauseOnClose: false })),
		).toBe(1);
	});

	it("looks at the last word of a chunk", () => {
		expect(punctuationRule(frame("one two."), context())).toBe(3);
		expect(punctuationRule(frame("one. two"), context())).toBe(1);
	});
});

describe("ramp rule", () => {
	const ramp = { rampSpanWords: 4, rampStart: 0.5 };

	it("does nothing when the span is 0", () => {
		expect(rampRule(frame("word"), context({ rampSpanWords: 0 }, 0))).toBe(1);
	});

	it("starts at the start fraction of the speed", () => {
		expect(rampRule(frame("word"), context(ramp, 0))).toBeCloseTo(2, 6);
	});

	it("builds linearly to full speed over the span", () => {
		expect(rampRule(frame("word"), context(ramp, 2))).toBeCloseTo(1 / 0.75, 6);
		expect(rampRule(frame("word"), context(ramp, 4))).toBe(1);
		expect(rampRule(frame("word"), context(ramp, 400))).toBe(1);
	});

	it("leaves Frames before the anchor alone", () => {
		expect(rampRule(frame("word"), context(ramp, -1))).toBe(1);
	});
});

describe("sprint rule", () => {
	const sprint = { sprintEveryWords: 4, sprintWords: 2, sprintSpeedup: 2 };

	it("does nothing when sprints are off", () => {
		expect(sprintRule(frame("word"), context({ sprintEveryWords: 0 }, 3))).toBe(
			1,
		);
	});

	it("reads normally, then fast for the last words of every period", () => {
		const at = (words: number) =>
			sprintRule(frame("word"), context(sprint, words));
		expect([0, 1, 2, 3, 4, 5, 6, 7].map(at)).toEqual([
			1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5,
		]);
	});

	it("leaves Frames before the anchor alone", () => {
		expect(sprintRule(frame("word"), context(sprint, -1))).toBe(1);
	});
});

describe("combined rules", () => {
	const settings = {
		smartSpeed: true,
		rampSpanWords: 2,
		rampStart: 0.5,
		sprintEveryWords: 4,
		sprintWords: 2,
		sprintSpeedup: 2,
	};

	it("lists base-adjacent rules in order: smart speed, punctuation, ramp, sprints", () => {
		expect(PACING_RULES).toEqual([
			smartSpeedRule,
			punctuationRule,
			rampRule,
			sprintRule,
		]);
	});

	it("multiplies every rule's multiplier", () => {
		// "fox." is 3 letters (x1/1.3), a sentence end (x3 at the default sentence pause), past the ramp, in a sprint (x0.5).
		expect(pacingMultiplier(frame("fox."), context(settings, 3))).toBeCloseTo(
			(1 / 1.3) * 3 * 0.5,
			6,
		);
	});

	it("shapes a Timeline: base WPM first, then every rule", () => {
		const timeline = buildTimeline(
			paragraphs("the quick brown fox. wonderful day"),
			{ wpm: 300, ...settings },
		);
		const want = [307.692, 266.667, 100, 230.769, 266.667, 153.846];
		expectCloseTo(
			timeline.frames.map((f) => f.durationMs),
			want,
		);
		expect(timeline.totalMs).toBeCloseTo(
			want.reduce((a, b) => a + b, 0),
			1,
		);
	});
});

describe("smart speed in a Timeline", () => {
	it("is off by default", () => {
		expect(durations("the wonderful")).toEqual([200, 200]);
	});

	it("changes durations when on", () => {
		expectCloseTo(
			durations("the wonderful", { smartSpeed: true }),
			[153.846, 266.667],
		);
	});
});

describe("speed ramp in a Timeline", () => {
	it("starts slower and reaches the target WPM over its span", () => {
		expectCloseTo(
			durations("one two three four five six", {
				rampSpanWords: 4,
				rampStart: 0.5,
			}),
			[400, 320, 266.667, 228.571, 200, 200],
		);
	});

	it("counts from the anchor Position, not the start of the Document", () => {
		const timeline = buildTimeline(
			paragraphs("one two three four five six"),
			{ wpm: 300, rampSpanWords: 2, rampStart: 0.5 },
			{ anchor: { block: 0, offset: 8 } },
		);
		expectCloseTo(
			timeline.frames.map((f) => f.durationMs),
			[200, 200, 400, 266.667, 200, 200],
		);
	});
});

describe("sprints in a Timeline", () => {
	it("read the last words of each period faster", () => {
		expect(
			durations("a b c d e f g h", {
				sprintEveryWords: 4,
				sprintWords: 2,
				sprintSpeedup: 2,
			}),
		).toEqual([200, 200, 100, 100, 200, 200, 100, 100]);
	});
});

describe("chunk size", () => {
	const chunked = (text: string, chunkSize: number) =>
		framesOf(text, { wpm: 300, chunkSize });

	it("is 1 by default: one word per Frame", () => {
		const frames = framesOf("one two three");
		expect(frames.map((f) => f.text)).toEqual(["one", "two", "three"]);
		expect(frames.every((f) => f.words === 1)).toBe(true);
	});

	it("groups words into Frames", () => {
		expect(chunked("one two three four five", 2).map((f) => f.text)).toEqual([
			"one two",
			"three four",
			"five",
		]);
	});

	it("gives a chunk the range of its words and the time of each of them", () => {
		const [first, second] = chunked("one two three", 2);
		expect(first?.position).toEqual({ block: 0, offset: 0 });
		expect(first?.end).toEqual({ block: 0, offset: 7 });
		expect(first?.words).toBe(2);
		expect(first?.durationMs).toBe(400);
		expect(second?.startMs).toBe(400);
		expect(second?.durationMs).toBe(200);
	});

	it("never crosses a sentence end", () => {
		expect(
			chunked("Hi there. Go now please. Done", 3).map((f) => f.text),
		).toEqual(["Hi there.", "Go now please.", "Done"]);
	});

	it("looks through closing quotes when ending a chunk at a sentence", () => {
		expect(
			chunked('He said "stop." Then left now', 3).map((f) => f.text),
		).toEqual(['He said "stop."', "Then left now"]);
	});

	it("never crosses a block boundary", () => {
		const timeline = buildTimeline(paragraphs("one two three", "four five"), {
			chunkSize: 2,
		});
		expect(timeline.frames.map((f) => f.text)).toEqual([
			"one two",
			"three",
			"four five",
		]);
		expect(timeline.frames[2]?.position).toEqual({ block: 1, offset: 0 });
		expect(timeline.frames[2]?.context.paragraphStart).toBe(true);
	});

	it("applies the pause of the chunk's last word", () => {
		const [first] = chunked("one two.", 2);
		expect(first?.durationMs).toBe(1200);
	});

	it("puts the ORP pivot on the chunk's first word", () => {
		const [first] = chunked("wonderful day", 2);
		expect(first?.orp).toEqual({
			before: "wo",
			pivot: "n",
			after: "derful day",
		});
		expect(first?.orpIndex).toBe(2);
	});

	it("treats a missing, fractional or absurd chunk size as a sane one", () => {
		expect(chunked("a b c d", 0).map((f) => f.text)).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(chunked("a b c d", 2.9).map((f) => f.text)).toEqual(["a b", "c d"]);
		expect(chunked("a b c d", Number.NaN).map((f) => f.text)).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(chunked("a b c d", 1000)).toHaveLength(1);
	});

	it("keeps Positions of later Frames exact", () => {
		const frames = chunked("alpha  beta\tgamma delta", 2);
		expect(frames.map((f) => f.text)).toEqual(["alpha beta", "gamma delta"]);
		expect(frames[0]?.end).toEqual({ block: 0, offset: 11 });
		expect(frames[1]?.position).toEqual({ block: 0, offset: 12 });
	});
});
