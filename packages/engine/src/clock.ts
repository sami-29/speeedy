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

export interface SpeechClock extends Clock {
	/** Move time forward by `ms`, then tick every listener once. */
	advance(ms: number): void;
	/** How many listeners are attached. */
	readonly listeners: number;
}

/**
 * The Web Speech Clock. A browser voice gives no running time, only events (a sentence
 * began, a word began, a sentence ended), so this Clock never moves by itself: whoever
 * hears the voice pushes it with `advance`, and it ticks the Engine, which shows whichever
 * Frame that time falls in. A voice that does know its time (an audio output) uses a Clock
 * that reads it instead; both plug into the reader through the same Clock switch.
 */
export function createSpeechClock(): SpeechClock {
	return createManualClock();
}

export interface ClockSwitch extends Clock {
	/**
	 * Point at another Clock. The listeners follow it, and `now()` reads it. The Clocks do
	 * not share a time, so switch while the Engine is paused: it measures from where it
	 * starts playing.
	 */
	use(clock: Clock): void;
}

/**
 * A Clock that stands in for whichever Clock the current Reading Mode runs on. The Engine
 * is made once with this, so a mode switch changes the Clock without a new Engine.
 */
export function createClockSwitch(initial: Clock): ClockSwitch {
	let current = initial;
	const entries = new Set<{ listener: () => void; stop: () => void }>();
	return {
		now: () => current.now(),
		onTick(listener) {
			const entry = { listener, stop: current.onTick(listener) };
			entries.add(entry);
			return () => {
				entry.stop();
				entries.delete(entry);
			};
		},
		use(next) {
			if (next === current) return;
			for (const entry of entries) {
				entry.stop();
				entry.stop = next.onTick(entry.listener);
			}
			current = next;
		},
	};
}
