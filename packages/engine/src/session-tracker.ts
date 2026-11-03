import type { Clock } from "./clock";
import type { Engine } from "./engine";
import { localDate } from "./local-date";

/** What one stretch of reading leaves behind. */
export type SessionRecord = {
	/** The local calendar date the Session started on, `YYYY-MM-DD`. */
	date: string;
	/** When the Session started, in epoch milliseconds. */
	startedAt: number;
	/** Time spent playing. Paused and hidden time is left out. */
	activeMs: number;
	/** Frames actually shown. Words skipped by a seek are left out. */
	wordsRead: number;
	/** Words per minute over the active time, rounded. 0 when there was none. */
	wpm: number;
};

/** The two browser objects the tracker listens on. Tests pass fakes. */
export type PageTargets = {
	/** Receives `pagehide`. */
	window: EventTarget;
	/** Receives `visibilitychange`; `visibilityState` is read on each event. */
	document: EventTarget & { readonly visibilityState: string };
};

export type SessionTrackerOptions = {
	engine: Engine;
	/** The Clock the Engine runs on: active time is measured with it. */
	clock: Clock;
	/** Called with each finished Session. */
	save: (record: SessionRecord) => void;
	/** Wall-clock time in epoch milliseconds. Defaults to `Date.now`. */
	now?: () => number;
	/** IANA time zone for Session dates. Defaults to the reader's own. */
	timeZone?: string;
	/** Defaults to the browser's `window` and `document`, when there are any. */
	page?: PageTargets;
};

export type SessionTracker = {
	/** Save the Session so far and start a fresh one. Saves nothing if nothing was read. */
	flush(): void;
	/** Stop listening to the Engine and the page. Does not save. */
	dispose(): void;
};

function browserPage(): PageTargets | undefined {
	const globals = globalThis as { window?: EventTarget; document?: unknown };
	if (!globals.window || !globals.document) return undefined;
	return {
		window: globals.window,
		document: globals.document as PageTargets["document"],
	};
}

/**
 * Counts a reader's Sessions from an Engine's Reading Events. Only time spent playing
 * counts, and only Frames that were shown: a seek moves the Cursor without counting the
 * words it jumps over. A Session belongs to the local date it started on. It is saved on
 * `flush()`, on `pagehide` and when the page becomes hidden.
 */
export function createSessionTracker({
	engine,
	clock,
	save,
	now = Date.now,
	timeZone,
	page = browserPage(),
}: SessionTrackerOptions): SessionTracker {
	let startedAt: number | undefined;
	let activeMs = 0;
	let wordsRead = 0;
	let segmentStart: number | undefined;
	let lastShown: number | undefined;
	let hidden = page?.document.visibilityState === "hidden";

	const openSegment = () => {
		if (hidden || segmentStart !== undefined) return;
		segmentStart = clock.now();
		startedAt ??= now();
	};

	const closeSegment = () => {
		if (segmentStart === undefined) return;
		activeMs += clock.now() - segmentStart;
		segmentStart = undefined;
	};

	const flush = () => {
		closeSegment();
		if (startedAt !== undefined && (activeMs > 0 || wordsRead > 0)) {
			save({
				date: localDate(startedAt, timeZone),
				startedAt,
				activeMs,
				wordsRead,
				wpm: activeMs > 0 ? Math.round((wordsRead / activeMs) * 60_000) : 0,
			});
		}
		startedAt = undefined;
		activeMs = 0;
		wordsRead = 0;
		if (engine.playing) openSegment();
	};

	const onVisibilityChange = () => {
		if (page?.document.visibilityState === "hidden") {
			hidden = true;
			flush();
		} else {
			hidden = false;
			if (engine.playing) openSegment();
		}
	};

	const unsubscribe = [
		engine.on("play", openSegment),
		engine.on("pause", closeSegment),
		engine.on("end", closeSegment),
		engine.on("seek", () => {
			lastShown = undefined;
		}),
		engine.on("frameShown", ({ index }) => {
			if (hidden || index === lastShown) return;
			lastShown = index;
			wordsRead += 1;
		}),
	];
	page?.window.addEventListener("pagehide", flush);
	page?.document.addEventListener("visibilitychange", onVisibilityChange);

	return {
		flush,
		dispose() {
			for (const stop of unsubscribe) stop();
			page?.window.removeEventListener("pagehide", flush);
			page?.document.removeEventListener(
				"visibilitychange",
				onVisibilityChange,
			);
		},
	};
}
