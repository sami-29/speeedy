import { describe, expect, it } from "vitest";
import {
	clampRange,
	DEFAULT_READER_SETTINGS,
	enginePatch,
	engineSettings,
	PARAGRAPH_PAUSE_RANGE,
	RAMP_TARGET_RANGE,
	REWIND_STEP_RANGE,
	type ReaderSettings,
	SENTENCE_PAUSE_RANGE,
} from "../src/lib/reader/settings.ts";

const settings = (change: Partial<ReaderSettings> = {}): ReaderSettings => ({
	...DEFAULT_READER_SETTINGS,
	...change,
});

describe("reader settings", () => {
	it("default to 250 WPM, one word, pauses on, smart speed and ramp off; the paused view, progress bar and citations as in 1.x", () => {
		expect(DEFAULT_READER_SETTINGS).toEqual({
			wpm: 250,
			chunkSize: 1,
			smartSpeed: false,
			punctuationPauses: true,
			sentencePause: 2,
			paragraphPause: 1.8,
			commaPause: false,
			asidePause: true,
			speedRamp: false,
			rampTarget: 500,
			rampLength: 30,
			rewindStep: 5,
			countdown: false,
			pauseView: "focus",
			showProgress: true,
			removeCitations: false,
		});
	});

	it("turn into the engine settings that shape the Timeline", () => {
		expect(engineSettings(DEFAULT_READER_SETTINGS)).toEqual({
			wpm: 250,
			chunkSize: 1,
			smartSpeed: false,
			sentencePauseMultiplier: 2,
			paragraphPauseMultiplier: 1.8,
			commaAsPause: false,
			contextPauseOnClose: true,
			rampSpanWords: 0,
		});
	});

	it("switch pauses off by zeroing every pause rule", () => {
		const off = settings({ punctuationPauses: false });
		expect(enginePatch({ punctuationPauses: false }, off)).toEqual({
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
			commaAsPause: false,
			contextPauseOnClose: false,
		});
	});

	it("send the pauses as the reader set them when pauses are on", () => {
		const on = settings({
			sentencePause: 4.5,
			paragraphPause: 2.4,
			commaPause: true,
			asidePause: false,
		});
		expect(enginePatch({ punctuationPauses: true }, on)).toEqual({
			sentencePauseMultiplier: 4.5,
			paragraphPauseMultiplier: 2.4,
			commaAsPause: true,
			contextPauseOnClose: false,
		});
	});

	it("rebuild the pauses when one of them changes, from all four", () => {
		const after = settings({ sentencePause: 3, commaPause: true });
		expect(enginePatch({ sentencePause: 3 }, after)).toEqual({
			sentencePauseMultiplier: 3,
			paragraphPauseMultiplier: 1.8,
			commaAsPause: true,
			contextPauseOnClose: true,
		});
		const comma = settings({ commaPause: true });
		expect(enginePatch({ commaPause: true }, comma)).toMatchObject({
			commaAsPause: true,
		});
		const aside = settings({ asidePause: false });
		expect(enginePatch({ asidePause: false }, aside)).toMatchObject({
			contextPauseOnClose: false,
		});
		const paragraph = settings({ paragraphPause: 1 });
		expect(enginePatch({ paragraphPause: 1 }, paragraph)).toMatchObject({
			paragraphPauseMultiplier: 1,
		});
	});

	it("leave the pauses at none while the switch is off, whatever the numbers", () => {
		const off = settings({ punctuationPauses: false, sentencePause: 6 });
		expect(enginePatch({ sentencePause: 6 }, off)).toMatchObject({
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
			contextPauseOnClose: false,
		});
	});

	it("keep the pauses in their ranges", () => {
		const wild = settings({ sentencePause: 99, paragraphPause: 0 });
		expect(enginePatch({ sentencePause: 99 }, wild)).toMatchObject({
			sentencePauseMultiplier: 10,
			paragraphPauseMultiplier: 1,
		});
	});

	it("switch the ramp on from the set speed to the target, over its length from Play", () => {
		const on = settings({ speedRamp: true, wpm: 250, rampTarget: 500 });
		expect(enginePatch({ speedRamp: true }, on)).toEqual({
			rampSpanWords: 30,
			rampStart: 1,
			rampEnd: 2,
		});
		expect(enginePatch({ speedRamp: false }, settings())).toEqual({
			rampSpanWords: 0,
		});
	});

	it("rebuild the ramp when its target or its length changes", () => {
		const target = settings({ speedRamp: true, wpm: 400, rampTarget: 600 });
		expect(enginePatch({ rampTarget: 600 }, target)).toEqual({
			rampSpanWords: 30,
			rampStart: 1,
			rampEnd: 1.5,
		});
		const length = settings({ speedRamp: true, rampLength: 80 });
		expect(enginePatch({ rampLength: 80 }, length)).toMatchObject({
			rampSpanWords: 80,
		});
	});

	it("send nothing of the ramp while it is off", () => {
		expect(enginePatch({ rampTarget: 700 }, settings())).toEqual({});
		expect(enginePatch({ rampLength: 90 }, settings())).toEqual({});
	});

	it("rebuild a ramp's end when the speed it is a fraction of changes", () => {
		const faster = settings({ speedRamp: true, wpm: 500, rampTarget: 500 });
		expect(enginePatch({ wpm: 500 }, faster)).toEqual({
			wpm: 500,
			rampSpanWords: 30,
			rampStart: 1,
			rampEnd: 1,
		});
		// With the ramp off a change of speed is only a change of speed.
		expect(enginePatch({ wpm: 500 }, settings({ wpm: 500 }))).toEqual({
			wpm: 500,
		});
	});

	it("keep the ramp's end within what the Engine takes, whatever the target", () => {
		const low = settings({ speedRamp: true, wpm: 1600, rampTarget: 100 });
		expect(enginePatch({ rampTarget: 100 }, low)).toMatchObject({
			rampEnd: 0.0625,
		});
		const high = settings({ speedRamp: true, wpm: 100, rampTarget: 1600 });
		expect(enginePatch({ rampTarget: 1600 }, high)).toMatchObject({
			rampEnd: 16,
		});
	});

	it("send only what changed", () => {
		expect(enginePatch({ wpm: 300 })).toEqual({ wpm: 300 });
		expect(enginePatch({ chunkSize: 3 })).toEqual({ chunkSize: 3 });
		expect(enginePatch({ smartSpeed: true })).toEqual({ smartSpeed: true });
		expect(enginePatch({})).toEqual({});
	});

	it("never send the rewind step or the countdown to the Engine", () => {
		expect(enginePatch({ rewindStep: 9 }, settings({ rewindStep: 9 }))).toEqual(
			{},
		);
		expect(
			enginePatch({ countdown: true }, settings({ countdown: true })),
		).toEqual({});
	});

	it("keep the chunk size between 1 and 5", () => {
		expect(enginePatch({ chunkSize: 0 })).toEqual({ chunkSize: 1 });
		expect(enginePatch({ chunkSize: 9 })).toEqual({ chunkSize: 5 });
	});
});

describe("number ranges", () => {
	it("round to the range's decimals and hold between its ends", () => {
		expect(clampRange(SENTENCE_PAUSE_RANGE, 2.26)).toBe(2.3);
		expect(clampRange(SENTENCE_PAUSE_RANGE, 0)).toBe(1);
		expect(clampRange(SENTENCE_PAUSE_RANGE, 11)).toBe(10);
		expect(clampRange(PARAGRAPH_PAUSE_RANGE, 1.84)).toBe(1.8);
		expect(clampRange(REWIND_STEP_RANGE, 7.5)).toBe(8);
		expect(clampRange(RAMP_TARGET_RANGE, 9000)).toBe(1600);
	});

	it("take the minimum for a value that is not a number", () => {
		expect(clampRange(REWIND_STEP_RANGE, Number.NaN)).toBe(1);
	});

	it("step by a pause's own step without drifting", () => {
		let tenths = 1;
		for (let n = 0; n < 20; n++) {
			tenths = clampRange(PARAGRAPH_PAUSE_RANGE, tenths + 0.1);
		}
		expect(tenths).toBe(3);
		let halves = 1;
		for (let n = 0; n < 4; n++) {
			halves = clampRange(SENTENCE_PAUSE_RANGE, halves + 0.5);
		}
		expect(halves).toBe(3);
	});
});
