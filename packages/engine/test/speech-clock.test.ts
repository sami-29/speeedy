import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createClockSwitch,
	createEngine,
	createManualClock,
	createSpeechClock,
	sentenceBounds,
} from "../src/index";
import { paragraphs } from "./helpers";

describe("speech Clock", () => {
	it("moves only when it is pushed, and ticks its listeners when it moves", () => {
		const clock = createSpeechClock();
		let ticks = 0;
		clock.onTick(() => ticks++);
		expect(clock.now()).toBe(0);
		expect(ticks).toBe(0);
		clock.advance(40);
		expect(clock.now()).toBe(40);
		expect(ticks).toBe(1);
	});

	it("stops ticking a listener that unsubscribed", () => {
		const clock = createSpeechClock();
		let ticks = 0;
		const stop = clock.onTick(() => ticks++);
		stop();
		clock.advance(10);
		expect(ticks).toBe(0);
	});

	it("holds an Engine on its Frame until the speech moves it", () => {
		const timeline = buildTimeline(paragraphs("one two three four"), {
			wpm: 300,
		});
		const clock = createSpeechClock();
		const engine = createEngine({ clock, timeline });
		const shown: string[] = [];
		engine.on("frameShown", ({ frame }) => shown.push(frame.text));
		engine.play();
		expect(shown).toEqual(["one"]);
		// Nothing pushed the Clock, so the Cursor stays however long the page waits.
		expect(engine.frame?.text).toBe("one");
		const third = timeline.frames[2];
		const first = timeline.frames[0];
		clock.advance((third?.startMs ?? 0) - (first?.startMs ?? 0));
		expect(shown).toEqual(["one", "three"]);
		expect(engine.index).toBe(2);
	});
});

describe("Clock switch", () => {
	it("reads the Clock it points at", () => {
		const timer = createManualClock();
		const speech = createSpeechClock();
		timer.advance(100);
		speech.advance(7);
		const clock = createClockSwitch(timer);
		expect(clock.now()).toBe(100);
		clock.use(speech);
		expect(clock.now()).toBe(7);
	});

	it("passes ticks from the current Clock to every listener", () => {
		const timer = createManualClock();
		const speech = createSpeechClock();
		const clock = createClockSwitch(timer);
		const seen: string[] = [];
		clock.onTick(() => seen.push("a"));
		clock.onTick(() => seen.push("b"));
		timer.advance(1);
		expect(seen).toEqual(["a", "b"]);
		clock.use(speech);
		speech.advance(1);
		expect(seen).toEqual(["a", "b", "a", "b"]);
	});

	it("leaves the old Clock with no listeners after a switch", () => {
		const timer = createManualClock();
		const speech = createSpeechClock();
		const clock = createClockSwitch(timer);
		clock.onTick(() => {});
		expect(timer.listeners).toBe(1);
		clock.use(speech);
		expect(timer.listeners).toBe(0);
		expect(speech.listeners).toBe(1);
	});

	it("stops a listener on whichever Clock it is on now", () => {
		const timer = createManualClock();
		const speech = createSpeechClock();
		const clock = createClockSwitch(timer);
		const stop = clock.onTick(() => {});
		clock.use(speech);
		stop();
		expect(speech.listeners).toBe(0);
		expect(timer.listeners).toBe(0);
	});

	it("switching to the Clock already in use changes nothing", () => {
		const timer = createManualClock();
		const clock = createClockSwitch(timer);
		clock.onTick(() => {});
		clock.use(timer);
		expect(timer.listeners).toBe(1);
	});

	it("lets a paused Engine carry on from the same Frame on the next Clock", () => {
		const timeline = buildTimeline(paragraphs("one two three four"), {
			wpm: 300,
		});
		const timer = createManualClock();
		const speech = createSpeechClock();
		const clock = createClockSwitch(timer);
		const engine = createEngine({ clock, timeline });
		engine.play();
		timer.advance(250);
		expect(engine.index).toBe(1);
		engine.pause();
		clock.use(speech);
		engine.play();
		expect(engine.index).toBe(1);
		// The speech Clock's time is its own: the Engine measures from where it started.
		speech.advance(250);
		expect(engine.index).toBe(2);
		// The timer no longer moves the Cursor.
		timer.advance(1000);
		expect(engine.index).toBe(2);
	});
});

describe("sentenceBounds", () => {
	const frames = (...texts: string[]) =>
		buildTimeline(paragraphs(...texts), { wpm: 300 }).frames;

	it("finds the first and last Frame of the sentence a Frame is in", () => {
		const f = frames("One two. Three four five. Six.");
		expect(sentenceBounds(f, 0)).toEqual({ from: 0, to: 1 });
		expect(sentenceBounds(f, 1)).toEqual({ from: 0, to: 1 });
		expect(sentenceBounds(f, 3)).toEqual({ from: 2, to: 4 });
		expect(sentenceBounds(f, 5)).toEqual({ from: 5, to: 5 });
	});

	it("ends a sentence at a block even without punctuation", () => {
		const f = frames("A heading here", "Then a paragraph.");
		expect(sentenceBounds(f, 1)).toEqual({ from: 0, to: 2 });
		expect(sentenceBounds(f, 3)).toEqual({ from: 3, to: 5 });
	});

	it("counts a closing quote after the full stop as part of the sentence end", () => {
		const f = frames('He said "go now." Then left.');
		const last = f.length - 1;
		expect(sentenceBounds(f, 0).to).toBe(3);
		expect(sentenceBounds(f, last).from).toBe(4);
	});

	it("agrees with the starts a rewind lands on", () => {
		const f = frames("Alpha beta. Gamma delta epsilon. Zeta.", "Eta theta.");
		const starts = new Set<number>();
		for (let i = 0; i < f.length; i++) starts.add(sentenceBounds(f, i).from);
		expect([...starts]).toEqual([0, 2, 5, 6]);
	});

	it("treats an out-of-range index as the nearest Frame", () => {
		const f = frames("One. Two.");
		expect(sentenceBounds(f, 99)).toEqual({ from: 1, to: 1 });
		expect(sentenceBounds(f, -3)).toEqual({ from: 0, to: 0 });
	});
});
