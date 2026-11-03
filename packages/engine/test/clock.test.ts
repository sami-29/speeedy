import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	createTimerClock,
} from "../src/index";
import { paragraphs } from "./helpers";

/** A stand-in for requestAnimationFrame and performance.now(). */
function fakeBrowser() {
	let time = 1000;
	let nextId = 1;
	const pending = new Map<number, () => void>();
	return {
		now: () => time,
		requestFrame: (callback: () => void) => {
			const id = nextId++;
			pending.set(id, callback);
			return id;
		},
		cancelFrame: (id: number) => {
			pending.delete(id);
		},
		/** Move time forward and run the frame callbacks that were waiting. */
		frame(ms: number) {
			time += ms;
			const callbacks = [...pending.values()];
			pending.clear();
			for (const callback of callbacks) callback();
		},
		get waiting() {
			return pending.size;
		},
	};
}

describe("timer Clock", () => {
	it("reads time from performance.now() style now()", () => {
		const browser = fakeBrowser();
		const clock = createTimerClock(browser);
		expect(clock.now()).toBe(1000);
		browser.frame(16);
		expect(clock.now()).toBe(1016);
	});

	it("ticks once per animation frame while someone listens", () => {
		const browser = fakeBrowser();
		const clock = createTimerClock(browser);
		let ticks = 0;
		const stop = clock.onTick(() => ticks++);
		expect(ticks).toBe(0);
		browser.frame(16);
		browser.frame(16);
		expect(ticks).toBe(2);
		stop();
		browser.frame(16);
		expect(ticks).toBe(2);
		expect(browser.waiting).toBe(0);
	});

	it("does not request frames with no listener", () => {
		const browser = fakeBrowser();
		createTimerClock(browser);
		expect(browser.waiting).toBe(0);
	});

	it("drives an Engine at the browser's pace", () => {
		const browser = fakeBrowser();
		const engine = createEngine({
			clock: createTimerClock(browser),
			timeline: buildTimeline(paragraphs("one two three"), { wpm: 300 }),
		});
		engine.play();
		browser.frame(16);
		expect(engine.frame?.text).toBe("one");
		browser.frame(200);
		expect(engine.frame?.text).toBe("two");
		browser.frame(400);
		expect(engine.playing).toBe(false);
	});
});

describe("manual Clock", () => {
	it("moves time only when advanced", () => {
		const clock = createManualClock();
		expect(clock.now()).toBe(0);
		clock.advance(250);
		expect(clock.now()).toBe(250);
	});
});
