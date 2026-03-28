import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderSettings } from "../models/types.js";
import { DEFAULT_SETTINGS } from "./defaults.js";
import { computeOrp, RSVPEngine, tokenize } from "./rsvp-engine.js";

function makeSettings(overrides: Partial<ReaderSettings> = {}): ReaderSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("tokenize", () => {
	it("splits plain text into tokens", () => {
		const tokens = tokenize("Hello world");
		expect(tokens).toHaveLength(2);
		expect(tokens[0].text).toBe("Hello");
		expect(tokens[1].text).toBe("world");
	});

	it("marks paragraph starts", () => {
		const tokens = tokenize("First paragraph.\n\nSecond paragraph.");
		const secondParaStart = tokens.find((t) => t.context?.paragraphStart);
		expect(secondParaStart).toBeDefined();
		expect(secondParaStart?.text).toBe("Second");
	});

	it("assigns sentence pause multiplier to period-ending words", () => {
		const tokens = tokenize("Hello world.");
		const last = tokens[tokens.length - 1];
		expect(last.pauseMultiplier).toBe(2.0);
	});

	it("assigns comma pause multiplier when commaAsPause is false", () => {
		const tokens = tokenize(
			"Hello, world.",
			makeSettings({ commaAsPause: false }),
		);
		const comma = tokens.find((t) => t.text === "Hello,");
		expect(comma?.pauseMultiplier).toBe(1.4);
	});

	it("assigns sentence pause multiplier to comma when commaAsPause is true", () => {
		const tokens = tokenize(
			"Hello, world.",
			makeSettings({ commaAsPause: true }),
		);
		const comma = tokens.find((t) => t.text === "Hello,");
		expect(comma?.pauseMultiplier).toBe(2.0);
	});

	it("returns empty array for empty text", () => {
		expect(tokenize("")).toHaveLength(0);
		expect(tokenize("   ")).toHaveLength(0);
	});

	it("marks words inside quotes", () => {
		const tokens = tokenize('"Hello world"');
		expect(tokens.every((t) => t.context?.inQuotes)).toBe(true);
	});

	it("marks words inside parentheses", () => {
		const tokens = tokenize("(aside here)");
		expect(tokens.every((t) => t.context?.inParens)).toBe(true);
	});
});

describe("computeOrp", () => {
	it("returns the whole text as pivot for single char", () => {
		const result = computeOrp("a");
		expect(result.pivot).toBe("a");
		expect(result.before).toBe("");
		expect(result.after).toBe("");
	});

	it("places pivot at index 1 for 2-5 char words", () => {
		const result = computeOrp("hello");
		expect(result.before).toBe("h");
		expect(result.pivot).toBe("e");
		expect(result.after).toBe("llo");
	});

	it("places pivot at index 2 for 6-9 char words", () => {
		const result = computeOrp("reading");
		expect(result.before).toBe("re");
		expect(result.pivot).toBe("a");
		expect(result.after).toBe("ding");
	});

	it("places pivot at index 3 for 10+ char words", () => {
		const result = computeOrp("speedreading");
		expect(result.before).toBe("spe");
		expect(result.pivot).toBe("e");
		expect(result.after).toBe("dreading");
	});

	it("handles leading punctuation", () => {
		const result = computeOrp('"hello"');
		expect(result.before).toContain('"');
		expect(result.pivot).toBeTruthy();
	});

	it("handles trailing punctuation", () => {
		const result = computeOrp("word.");
		expect(result.after).toContain(".");
	});

	it("handles pure punctuation", () => {
		const result = computeOrp("...");
		expect(result.pivot).toBe("...");
		expect(result.before).toBe("");
		expect(result.after).toBe("");
	});

	it("shifts pivot earlier with early focus position", () => {
		const balanced = computeOrp("reading", "balanced");
		const early = computeOrp("reading", "early");
		expect(early.before.length).toBeLessThan(balanced.before.length);
	});

	it("shifts pivot later with late focus position", () => {
		const balanced = computeOrp("reading", "balanced");
		const late = computeOrp("reading", "late");
		expect(late.before.length).toBeGreaterThan(balanced.before.length);
	});
});

describe("RSVPEngine", () => {
	let engine: RSVPEngine;

	beforeEach(() => {
		engine = new RSVPEngine();
		vi.useFakeTimers();
	});

	afterEach(() => {
		engine.stop();
		vi.useRealTimers();
	});

	describe("load", () => {
		it("tokenizes text and sets totalWords", () => {
			engine.load("Hello world foo", makeSettings());
			expect(engine.getState().totalWords).toBe(3);
		});

		it("resets wordIndex to 0 on load", () => {
			engine.load("Hello world", makeSettings());
			engine.seekBy(1);
			engine.load("New text here", makeSettings());
			expect(engine.getState().wordIndex).toBe(0);
		});

		it("sets baseWpm from settings", () => {
			engine.load("Hello world", makeSettings({ wpm: 450 }));
			expect(engine.getState().baseWpm).toBe(450);
		});

		it("emits stateChange event on load", () => {
			const listener = vi.fn();
			engine.on("stateChange", listener);
			engine.load("Hello world", makeSettings());
			// load() calls stop() internally (1 stateChange) then emits its own (2 total)
			expect(listener).toHaveBeenCalledTimes(2);
		});

		it("sets currentTokens to first token after load", () => {
			engine.load("Hello world", makeSettings());
			const state = engine.getState();
			expect(state.currentTokens).toHaveLength(1);
			expect(state.currentTokens[0].text).toBe("Hello");
		});

		it("handles empty text gracefully", () => {
			engine.load("", makeSettings());
			expect(engine.getState().totalWords).toBe(0);
		});
	});

	describe("stop", () => {
		it("resets wordIndex to 0", () => {
			engine.load("Hello world foo", makeSettings());
			engine.seekBy(2);
			engine.stop();
			expect(engine.getState().wordIndex).toBe(0);
		});

		it("sets playing to false", () => {
			engine.load("Hello world", makeSettings());
			engine.stop();
			expect(engine.getState().playing).toBe(false);
		});

		it("emits stateChange on stop", () => {
			engine.load("Hello world", makeSettings());
			const listener = vi.fn();
			engine.on("stateChange", listener);
			engine.stop();
			expect(listener).toHaveBeenCalledOnce();
		});
	});

	describe("pause", () => {
		it("sets playing to false", () => {
			engine.load("Hello world foo bar", makeSettings());
			engine.play(makeSettings());
			engine.pause();
			expect(engine.getState().playing).toBe(false);
		});

		it("emits stateChange on pause", () => {
			engine.load("Hello world", makeSettings());
			engine.play(makeSettings());
			const listener = vi.fn();
			engine.on("stateChange", listener);
			engine.pause();
			expect(listener).toHaveBeenCalledOnce();
		});

		it("preserves elapsedMs after pause", () => {
			engine.load("Hello world foo bar baz", makeSettings({ wpm: 60 }));
			engine.play(makeSettings({ wpm: 60 }));
			vi.advanceTimersByTime(1000);
			engine.pause();
			expect(engine.getState().elapsedMs).toBeGreaterThan(0);
		});
	});

	describe("seekBy", () => {
		it("moves wordIndex forward by delta", () => {
			engine.load("one two three four five", makeSettings());
			engine.seekBy(3);
			expect(engine.getState().wordIndex).toBe(3);
		});

		it("clamps to 0 when seeking before start", () => {
			engine.load("one two three", makeSettings());
			engine.seekBy(-10);
			expect(engine.getState().wordIndex).toBe(0);
		});

		it("clamps to last token when seeking past end", () => {
			engine.load("one two three", makeSettings());
			engine.seekBy(100);
			expect(engine.getState().wordIndex).toBe(2);
		});

		it("updates currentTokens when not playing", () => {
			engine.load("one two three", makeSettings());
			engine.seekBy(2);
			const state = engine.getState();
			expect(state.currentTokens[0].text).toBe("three");
		});
	});

	describe("seekToWord", () => {
		it("sets wordIndex to given index", () => {
			engine.load("one two three four", makeSettings());
			engine.seekToWord(2);
			expect(engine.getState().wordIndex).toBe(2);
		});

		it("clamps to 0 for negative index", () => {
			engine.load("one two three", makeSettings());
			engine.seekToWord(-5);
			expect(engine.getState().wordIndex).toBe(0);
		});

		it("clamps to last token for out-of-bounds index", () => {
			engine.load("one two three", makeSettings());
			engine.seekToWord(999);
			expect(engine.getState().wordIndex).toBe(2);
		});
	});

	describe("getProgressPercent", () => {
		it("returns 0 when no tokens loaded", () => {
			expect(engine.getProgressPercent()).toBe(0);
		});

		it("returns 0 at start", () => {
			engine.load("one two three four", makeSettings());
			expect(engine.getProgressPercent()).toBe(0);
		});

		it("returns correct percentage mid-way", () => {
			engine.load("one two three four", makeSettings());
			engine.seekToWord(2);
			expect(engine.getProgressPercent()).toBe(50);
		});

		it("returns 75 at third of four tokens", () => {
			engine.load("one two three four", makeSettings());
			engine.seekToWord(3);
			expect(engine.getProgressPercent()).toBe(75);
		});
	});

	describe("getEstimatedRemainingMs", () => {
		it("returns 0 when no tokens", () => {
			expect(engine.getEstimatedRemainingMs(makeSettings())).toBe(0);
		});

		it("returns positive value for loaded text", () => {
			engine.load("one two three four five", makeSettings({ wpm: 300 }));
			const ms = engine.getEstimatedRemainingMs(makeSettings({ wpm: 300 }));
			expect(ms).toBeGreaterThan(0);
		});

		it("returns 0 when at end of text", () => {
			// getEstimatedRemainingMs returns 0 when current >= total
			// seekToWord clamps to tokens.length - 1, so we need to play through to completion
			engine.load("one two", makeSettings({ wpm: 600, chunkSize: 1 }));
			engine.play(makeSettings({ wpm: 600, chunkSize: 1 }));
			// Advance past all words so wordIndex reaches tokens.length
			vi.advanceTimersByTime(1000);
			const ms = engine.getEstimatedRemainingMs(makeSettings({ wpm: 600 }));
			expect(ms).toBe(0);
		});

		it("decreases as we advance through text", () => {
			engine.load(
				"one two three four five six seven eight nine ten",
				makeSettings({ wpm: 300 }),
			);
			const settings = makeSettings({ wpm: 300 });
			const msAtStart = engine.getEstimatedRemainingMs(settings);
			engine.seekToWord(5);
			const msAtMid = engine.getEstimatedRemainingMs(settings);
			expect(msAtMid).toBeLessThan(msAtStart);
		});
	});

	describe("event system", () => {
		it("registers and fires listeners for 'word' event on load", () => {
			const listener = vi.fn();
			engine.on("word", listener);
			engine.load("Hello world", makeSettings());
			expect(listener).toHaveBeenCalledOnce();
		});

		it("removes listeners with off()", () => {
			const listener = vi.fn();
			engine.on("stateChange", listener);
			engine.off("stateChange", listener);
			engine.load("Hello world", makeSettings());
			expect(listener).not.toHaveBeenCalled();
		});

		it("emits 'complete' event when playback finishes", () => {
			const completeListener = vi.fn();
			engine.on("complete", completeListener);
			engine.load("one", makeSettings({ wpm: 600, chunkSize: 1 }));
			engine.play(makeSettings({ wpm: 600, chunkSize: 1 }));
			vi.advanceTimersByTime(500);
			expect(completeListener).toHaveBeenCalledOnce();
		});

		it("emits 'progress' event during playback", () => {
			const progressListener = vi.fn();
			engine.on("progress", progressListener);
			engine.load("one two three", makeSettings({ wpm: 600, chunkSize: 1 }));
			engine.play(makeSettings({ wpm: 600, chunkSize: 1 }));
			vi.advanceTimersByTime(100);
			expect(progressListener).toHaveBeenCalled();
		});

		it("supports multiple listeners for the same event", () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();
			engine.on("stateChange", listener1);
			engine.on("stateChange", listener2);
			engine.load("Hello", makeSettings());
			// load() calls stop() (1 stateChange) then emits its own (2 total per listener)
			expect(listener1).toHaveBeenCalledTimes(2);
			expect(listener2).toHaveBeenCalledTimes(2);
		});
	});

	describe("setWpm", () => {
		it("updates baseWpm in state", () => {
			engine.load("Hello world", makeSettings({ wpm: 300 }));
			engine.setWpm(makeSettings({ wpm: 500 }));
			expect(engine.getState().baseWpm).toBe(500);
		});
	});

	describe("getState", () => {
		it("returns a copy of state (not reference)", () => {
			engine.load("Hello world", makeSettings());
			const state1 = engine.getState();
			const state2 = engine.getState();
			expect(state1).not.toBe(state2);
			expect(state1).toEqual(state2);
		});
	});

	describe("play", () => {
		it("sets playing to true", () => {
			engine.load("Hello world foo", makeSettings());
			engine.play(makeSettings());
			expect(engine.getState().playing).toBe(true);
			engine.pause();
		});

		it("restarts from beginning when play is called after completion", () => {
			const stateChanges: number[] = [];
			engine.on("stateChange", (s) => stateChanges.push(s.wordIndex));
			engine.load("one two", makeSettings({ wpm: 600, chunkSize: 1 }));
			engine.play(makeSettings({ wpm: 600, chunkSize: 1 }));
			// Advance past all words to trigger completion
			vi.advanceTimersByTime(1000);
			// wordIndex should be at tokens.length (2) after completion
			expect(engine.getState().wordIndex).toBeGreaterThanOrEqual(2);
			// Play again - should reset wordIndex to 0 before advancing
			engine.play(makeSettings({ wpm: 600, chunkSize: 1 }));
			// The stateChange emitted by play() should have wordIndex 0
			const playResetState = stateChanges[stateChanges.length - 1];
			expect(playResetState).toBe(0);
			engine.pause();
		});

		it("emits stateChange on play", () => {
			engine.load("Hello world", makeSettings());
			const listener = vi.fn();
			engine.on("stateChange", listener);
			engine.play(makeSettings());
			expect(listener).toHaveBeenCalledOnce();
			engine.pause();
		});
	});
});
