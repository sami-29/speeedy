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

/** The two fields of an `AudioContext` the audio Clock reads. Both are in seconds. */
export type AudioTimeSource = {
	readonly currentTime: number;
	/** Absent in browsers that do not report it (Firefox, older Safari). */
	readonly outputLatency?: number | undefined;
};

export type AudioClockOptions = {
	requestFrame?: (callback: () => void) => number;
	cancelFrame?: (handle: number) => void;
	/** A timer that still runs in a hidden tab, where frames do not come. */
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
};

export interface AudioClock extends Clock {
	/**
	 * Whether the browser reports an output latency. Without it the Clock reads the context's
	 * time alone, which runs ahead of what the reader hears by the device's latency.
	 */
	readonly hasOutputLatency: boolean;
}

/** How often the audio Clock ticks in a tab that is not drawing frames. */
const HIDDEN_TICK_MS = 250;

/**
 * The audio Clock: `AudioContext.currentTime - outputLatency`, the moment of the sound the
 * reader is hearing now. `source` returns the context, or nothing before one exists (the
 * browser only lets a gesture start it), when the Clock reads zero. A context that is
 * suspended stops its time, so the Engine holds its Frame until the context runs again.
 *
 * It ticks on animation frames, and on a slower timer as well so that Listen goes on moving
 * the Cursor in a hidden tab, where frames never come; each round ticks once.
 */
export function createAudioClock(
	source: () => AudioTimeSource | undefined,
	options: AudioClockOptions = {},
): AudioClock {
	const browser = globalThis as unknown as BrowserGlobals;
	const requestFrame =
		options.requestFrame ??
		((callback: () => void) => browser.requestAnimationFrame(() => callback()));
	const cancelFrame =
		options.cancelFrame ??
		((handle: number) => browser.cancelAnimationFrame(handle));
	const setTimer =
		options.setTimer ??
		((callback: () => void, ms: number) => setTimeout(callback, ms));
	const clearTimer =
		options.clearTimer ??
		((handle: unknown) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>));

	// The latency can grow while the context runs; the Clock must not step back when it does.
	let last: { source: AudioTimeSource; ms: number } | undefined;

	const listeners = new Set<() => void>();
	let frame: number | undefined;
	let timer: unknown;
	let scheduled = false;

	const stopRound = () => {
		if (frame !== undefined) cancelFrame(frame);
		if (timer !== undefined) clearTimer(timer);
		frame = undefined;
		timer = undefined;
		scheduled = false;
	};
	const schedule = () => {
		scheduled = true;
		const run = () => {
			stopRound();
			for (const listener of [...listeners]) listener();
			if (listeners.size > 0 && !scheduled) schedule();
		};
		frame = requestFrame(run);
		timer = setTimer(run, HIDDEN_TICK_MS);
	};

	return {
		now() {
			const current = source();
			if (!current) return 0;
			const raw = (current.currentTime - (current.outputLatency ?? 0)) * 1000;
			const ms = last?.source === current ? Math.max(last.ms, raw) : raw;
			last = { source: current, ms };
			return ms;
		},
		get hasOutputLatency() {
			return typeof source()?.outputLatency === "number";
		},
		onTick(listener) {
			listeners.add(listener);
			if (!scheduled) schedule();
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) stopRound();
			};
		},
	};
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
