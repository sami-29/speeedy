import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	COUNTDOWN_STEP_MS,
	COUNTDOWN_STEPS,
	createCountdown,
} from "../src/lib/reader/countdown.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
	const counts: (number | null)[] = [];
	let done = 0;
	const countdown = createCountdown({
		oncount: (count) => counts.push(count),
		ondone: () => {
			done += 1;
		},
	});
	return { countdown, counts, done: () => done };
}

describe("the start countdown", () => {
	it("counts 3, 2, 1 as in 1.x, 800 ms each", () => {
		expect(COUNTDOWN_STEPS).toBe(3);
		expect(COUNTDOWN_STEP_MS).toBe(800);
	});

	it("shows 3 at once, then 2 and 1, and plays when the last count runs out", () => {
		const { countdown, counts, done } = setup();
		countdown.start();
		expect(counts).toEqual([3]);
		expect(countdown.running).toBe(true);

		vi.advanceTimersByTime(799);
		expect(counts).toEqual([3]);
		vi.advanceTimersByTime(1);
		expect(counts).toEqual([3, 2]);
		vi.advanceTimersByTime(800);
		expect(counts).toEqual([3, 2, 1]);
		expect(done()).toBe(0);

		vi.advanceTimersByTime(800);
		expect(counts).toEqual([3, 2, 1, null]);
		expect(done()).toBe(1);
		expect(countdown.running).toBe(false);
	});

	it("stops without playing when cancelled, and clears the count", () => {
		const { countdown, counts, done } = setup();
		countdown.start();
		vi.advanceTimersByTime(900);
		countdown.cancel();
		expect(counts).toEqual([3, 2, null]);
		expect(countdown.running).toBe(false);
		vi.advanceTimersByTime(10_000);
		expect(done()).toBe(0);
		expect(counts).toEqual([3, 2, null]);
	});

	it("cancelling when it is not running does nothing", () => {
		const { countdown, counts } = setup();
		countdown.cancel();
		expect(counts).toEqual([]);
	});

	it("starts again from 3 after a cancel, and plays once", () => {
		const { countdown, counts, done } = setup();
		countdown.start();
		vi.advanceTimersByTime(900);
		countdown.cancel();
		countdown.start();
		expect(counts.at(-1)).toBe(3);
		vi.advanceTimersByTime(800 * 3);
		expect(done()).toBe(1);
	});

	it("restarts from 3 when started while running, without playing twice", () => {
		const { countdown, counts, done } = setup();
		countdown.start();
		vi.advanceTimersByTime(900);
		countdown.start();
		expect(counts.at(-1)).toBe(3);
		vi.advanceTimersByTime(800 * 3);
		expect(done()).toBe(1);
	});

	it("takes its own steps and step length", () => {
		const counts: (number | null)[] = [];
		const countdown = createCountdown({
			oncount: (count) => counts.push(count),
			ondone: () => {},
			steps: 2,
			stepMs: 100,
		});
		countdown.start();
		vi.advanceTimersByTime(200);
		expect(counts).toEqual([2, 1, null]);
	});
});
