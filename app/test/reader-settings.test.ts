import { describe, expect, it } from "vitest";
import {
	DEFAULT_READER_SETTINGS,
	enginePatch,
	engineSettings,
} from "../src/lib/reader/settings.ts";

describe("reader settings", () => {
	it("default to 250 WPM, one word, pauses on, smart speed and ramp off", () => {
		expect(DEFAULT_READER_SETTINGS).toEqual({
			wpm: 250,
			chunkSize: 1,
			smartSpeed: false,
			punctuationPauses: true,
			speedRamp: false,
		});
	});

	it("turn into the engine settings that shape the Timeline", () => {
		expect(engineSettings(DEFAULT_READER_SETTINGS)).toEqual({
			wpm: 250,
			chunkSize: 1,
			smartSpeed: false,
			sentencePauseMultiplier: 2,
			paragraphPauseMultiplier: 1.8,
			contextPauseOnClose: true,
			rampSpanWords: 0,
		});
	});

	it("switch pauses off by zeroing every pause rule", () => {
		const patch = enginePatch({ punctuationPauses: false });
		expect(patch).toEqual({
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
			contextPauseOnClose: false,
		});
	});

	it("switch the ramp on with a 30-word span from half speed", () => {
		expect(enginePatch({ speedRamp: true })).toEqual({
			rampSpanWords: 30,
			rampStart: 0.5,
		});
		expect(enginePatch({ speedRamp: false })).toEqual({ rampSpanWords: 0 });
	});

	it("send only what changed", () => {
		expect(enginePatch({ wpm: 300 })).toEqual({ wpm: 300 });
		expect(enginePatch({ chunkSize: 3 })).toEqual({ chunkSize: 3 });
		expect(enginePatch({ smartSpeed: true })).toEqual({ smartSpeed: true });
		expect(enginePatch({})).toEqual({});
	});

	it("keep the chunk size between 1 and 5", () => {
		expect(enginePatch({ chunkSize: 0 })).toEqual({ chunkSize: 1 });
		expect(enginePatch({ chunkSize: 9 })).toEqual({ chunkSize: 5 });
	});
});
