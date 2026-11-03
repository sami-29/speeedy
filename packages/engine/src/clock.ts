/**
 * What drives playback. `now()` is a monotonic time in milliseconds and `onTick` calls a
 * listener whenever the clock has moved and the Engine should look at it again. The timer
 * Clock ticks per animation frame; later Clocks follow audio output or speech events.
 */
export interface Clock {
	now(): number;
	/** Start ticking `listener`. Returns a function that stops it. */
	onTick(listener: () => void): () => void;
}

export type TimerClockOptions = {
	now?: () => number;
	requestFrame?: (callback: () => void) => number;
	cancelFrame?: (handle: number) => void;
};

type BrowserGlobals = {
	performance: { now(): number };
	requestAnimationFrame(callback: (time: number) => void): number;
	cancelAnimationFrame(handle: number): void;
};

/**
 * The timer Clock: `performance.now()`, checked once per animation frame while at least
 * one listener is attached. Options stand in for the browser in tests.
 */
export function createTimerClock(options: TimerClockOptions = {}): Clock {
	const browser = globalThis as unknown as BrowserGlobals;
	const now = options.now ?? (() => browser.performance.now());
	const requestFrame =
		options.requestFrame ??
		((callback: () => void) => browser.requestAnimationFrame(() => callback()));
	const cancelFrame =
		options.cancelFrame ??
		((handle: number) => browser.cancelAnimationFrame(handle));

	const listeners = new Set<() => void>();
	let handle: number | undefined;

	const schedule = () => {
		handle = requestFrame(() => {
			handle = undefined;
			for (const listener of [...listeners]) listener();
			if (listeners.size > 0 && handle === undefined) schedule();
		});
	};

	return {
		now,
		onTick(listener) {
			listeners.add(listener);
			if (handle === undefined) schedule();
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0 && handle !== undefined) {
					cancelFrame(handle);
					handle = undefined;
				}
			};
		},
	};
}

export interface ManualClock extends Clock {
	/** Move time forward, then tick every listener once. */
	advance(ms: number): void;
	/** How many listeners are attached. */
	readonly listeners: number;
}

/** A Clock that only moves when told to. For tests and anything that needs to replay time. */
export function createManualClock(): ManualClock {
	let time = 0;
	const listeners = new Set<() => void>();
	return {
		now: () => time,
		onTick(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		advance(ms) {
			time += ms;
			for (const listener of [...listeners]) listener();
		},
		get listeners() {
			return listeners.size;
		},
	};
}
