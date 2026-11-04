import { describe, expect, it } from "vitest";
import {
	type AudioTimeSource,
	buildTimeline,
	createAudioClock,
	createEngine,
} from "../src/index";
import { paragraphs } from "./helpers";

/** An audio context's clock fields, moved by hand. Seconds, as in the Web Audio API. */
function fakeOutput(initial: Partial<AudioTimeSource> = {}) {
	const output: { currentTime: number; outputLatency?: number } = {
		currentTime: 0,
		...initial,
	};
	return output;
}

/** The browser's two ways of calling back: a frame, and a timer that still runs in a hidden tab. */
function fakeScheduler() {
	let nextHandle = 1;
	const frames = new Map<number, () => void>();
	const timers = new Map<number, () => void>();
	return {
		options: {
			requestFrame: (callback: () => void) => {
				const handle = nextHandle++;
				frames.set(handle, callback);
				return handle;
			},
			cancelFrame: (handle: number) => {
				frames.delete(handle);
			},
			setTimer: (callback: () => void, _ms: number) => {
				const handle = nextHandle++;
				timers.set(handle, callback);
				return handle;
			},
			clearTimer: (handle: unknown) => {
				timers.delete(handle as number);
			},
		},
		/** A visible tab: the next frame comes. */
		frame() {
			const [first] = frames.values();
			first?.();
		},
		/** A hidden tab: frames never come, the timer does. */
		timer() {
			const [first] = timers.values();
			first?.();
		},
		get pending() {
			return frames.size + timers.size;
		},
	};
}

describe("audio Clock", () => {
	it("reads the context's time minus its output latency, in milliseconds", () => {
		const output = fakeOutput({ currentTime: 2, outputLatency: 0.05 });
		const clock = createAudioClock(() => output);
		expect(clock.now()).toBeCloseTo(1950, 6);
		output.currentTime = 2.5;
		expect(clock.now()).toBeCloseTo(2450, 6);
	});

	it("falls back to the context's time alone where the browser has no output latency", () => {
		const output = fakeOutput({ currentTime: 1.25 });
		const clock = createAudioClock(() => output);
		expect(clock.now()).toBe(1250);
		expect(clock.hasOutputLatency).toBe(false);
		output.outputLatency = 0;
		expect(clock.hasOutputLatency).toBe(true);
	});

	it("reads zero until there is a context, then follows it", () => {
		let output: AudioTimeSource | undefined;
		const clock = createAudioClock(() => output);
		expect(clock.now()).toBe(0);
		expect(clock.hasOutputLatency).toBe(false);
		output = fakeOutput({ currentTime: 3 });
		expect(clock.now()).toBe(3000);
	});

	it("never runs backwards when the output latency grows", () => {
		const output = fakeOutput({ currentTime: 1, outputLatency: 0.01 });
		const clock = createAudioClock(() => output);
		const before = clock.now();
		output.outputLatency = 0.04;
		expect(clock.now()).toBe(before);
		output.currentTime = 1.1;
		expect(clock.now()).toBeCloseTo(1060, 6);
	});

	it("starts over for a new context, whose time begins again at zero", () => {
		let output = fakeOutput({ currentTime: 40 });
		const clock = createAudioClock(() => output);
		expect(clock.now()).toBe(40_000);
		output = fakeOutput({ currentTime: 0.5 });
		expect(clock.now()).toBe(500);
	});

	describe("ticking", () => {
		it("ticks on animation frames while a listener is attached, and stops with the last", () => {
			const scheduler = fakeScheduler();
			const clock = createAudioClock(() => fakeOutput(), scheduler.options);
			expect(scheduler.pending).toBe(0);
			let ticks = 0;
			const stop = clock.onTick(() => ticks++);
			scheduler.frame();
			scheduler.frame();
			expect(ticks).toBe(2);
			stop();
			expect(scheduler.pending).toBe(0);
			scheduler.frame();
			expect(ticks).toBe(2);
		});

		it("keeps ticking in a hidden tab, where frames never come", () => {
			const scheduler = fakeScheduler();
			const clock = createAudioClock(() => fakeOutput(), scheduler.options);
			let ticks = 0;
			clock.onTick(() => ticks++);
			scheduler.timer();
			scheduler.timer();
			expect(ticks).toBe(2);
		});

		it("ticks once per round, whichever of frame and timer comes first", () => {
			const scheduler = fakeScheduler();
			const clock = createAudioClock(() => fakeOutput(), scheduler.options);
			let ticks = 0;
			clock.onTick(() => ticks++);
			scheduler.frame();
			expect(ticks).toBe(1);
			// The round's timer was cancelled by the frame; the next round has one of each.
			expect(scheduler.pending).toBe(2);
		});
	});
});

describe("an Engine on the audio Clock", () => {
	const setup = () => {
		const timeline = buildTimeline(paragraphs("one two three four five six"), {
			wpm: 600,
		});
		const output = fakeOutput();
		const scheduler = fakeScheduler();
		const clock = createAudioClock(() => output, scheduler.options);
		const engine = createEngine({ clock, timeline });
		const shown: string[] = [];
		engine.on("frameShown", ({ frame }) => shown.push(frame.text));
		const at = (seconds: number) => {
			output.currentTime = seconds;
			scheduler.frame();
		};
		return { timeline, output, engine, shown, at, scheduler };
	};

	it("follows the context's time", () => {
		const { engine, shown, at } = setup();
		engine.play();
		expect(shown).toEqual(["one"]);
		// 600 WPM is a word every 100 ms.
		at(0.25);
		expect(engine.frame?.text).toBe("three");
		at(0.45);
		expect(engine.frame?.text).toBe("five");
	});

	it("holds still while the context is suspended and carries on when it resumes", () => {
		const { engine, at } = setup();
		engine.play();
		at(0.25);
		expect(engine.frame?.text).toBe("three");
		// A suspended context's time stands still, however long the page waits.
		at(0.25);
		at(0.25);
		expect(engine.frame?.text).toBe("three");
		at(0.35);
		expect(engine.frame?.text).toBe("four");
	});

	it("pauses where it is and plays on from there at a later context time", () => {
		const { engine, at } = setup();
		engine.play();
		at(0.15);
		engine.pause();
		expect(engine.frame?.text).toBe("two");
		// The context kept running while the reader was paused.
		at(5);
		expect(engine.frame?.text).toBe("two");
		engine.play();
		at(5.1);
		expect(engine.frame?.text).toBe("three");
	});

	it("measures from the seek when it seeks while playing", () => {
		const { engine, timeline, at } = setup();
		engine.play();
		at(0.15);
		const fifth = timeline.frames[4];
		if (!fifth) throw new Error("no fifth frame");
		engine.seek(fifth.position);
		expect(engine.frame?.text).toBe("five");
		at(0.2);
		expect(engine.frame?.text).toBe("five");
		at(0.25);
		expect(engine.frame?.text).toBe("six");
	});

	it("stops ticking when the Engine pauses", () => {
		const { engine, scheduler } = setup();
		engine.play();
		expect(scheduler.pending).toBeGreaterThan(0);
		engine.pause();
		expect(scheduler.pending).toBe(0);
	});
});
