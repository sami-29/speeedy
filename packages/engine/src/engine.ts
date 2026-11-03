import {
	comparePositions,
	type Document,
	type Position,
} from "@speeedy/contracts";
import type { Clock } from "./clock";
import { type BackUnit, backTarget, startIndexes } from "./navigation";
import { buildTimeline, rebuildTimeline, resolveSettings } from "./timeline";
import type { EngineSettings, Frame, Timeline } from "./types";

export type EngineEvents = {
	play: { position: Position };
	pause: { position: Position };
	frameShown: { frame: Frame; index: number; position: Position };
	seek: { position: Position };
	end: { position: Position };
};

export type EngineEventName = keyof EngineEvents;

export type Engine = {
	/** The current Timeline. A settings change replaces it from the Cursor onward. */
	readonly timeline: Timeline;
	/** The settings the Timeline is built with, defaults filled in. */
	readonly settings: EngineSettings;
	readonly playing: boolean;
	/** Index of the current Frame in the Timeline. */
	readonly index: number;
	/** The current Frame, or undefined when the Timeline has none. */
	readonly frame: Frame | undefined;
	/** Where the current Frame starts. */
	readonly position: Position | undefined;
	play(): void;
	pause(): void;
	/** Move to the Frame at (or just before) a Position. Out-of-range Positions clamp. */
	seek(position: Position): void;
	/**
	 * Change settings and rebuild the Timeline from the Cursor onward. The Cursor stays on
	 * its Position, a playing Engine keeps playing, and the Frames already read are kept.
	 * Reports `frameShown` if the current Frame changed (a new chunk size, say). Needs an
	 * Engine made from a Document.
	 */
	updateSettings(patch: Partial<EngineSettings>): void;
	/**
	 * Rewind to the start of the current sentence, paragraph or chapter, or to the start of
	 * the previous one when the Cursor is already on a start. Emits `seek`.
	 */
	back(unit?: BackUnit): void;
	on<E extends EngineEventName>(
		event: E,
		listener: (payload: EngineEvents[E]) => void,
	): () => void;
};

/**
 * Either a ready `timeline`, or the `document` to build one from. Only an Engine that has
 * its `document` can rebuild when settings change.
 */
export type EngineOptions = {
	clock: Clock;
	/** BCP 47 language tag of the Document. */
	language?: string;
	settings?: Partial<EngineSettings>;
	/** Where chapters start (see `findChapters`). Without them, back one chapter goes to the start. */
	chapters?: readonly Position[];
} & (
	| { timeline: Timeline; document?: Document }
	| { document: Document; timeline?: Timeline }
);

/** Last Frame that starts at or before `time`. */
function frameAtTime(frames: readonly Frame[], time: number): number {
	let low = 0;
	let high = frames.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if ((frames[middle] as Frame).startMs <= time) low = middle;
		else high = middle - 1;
	}
	return low;
}

/** Last Frame that starts at or before `position`, or the first Frame. */
function frameAtPosition(frames: readonly Frame[], position: Position): number {
	let low = 0;
	let high = frames.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (comparePositions((frames[middle] as Frame).position, position) <= 0) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return low;
}

/**
 * Plays a Timeline on a Clock. The Cursor is the current Frame: playing moves it forward
 * as the Clock advances, seeking moves it to a Position, and Reading Events report both.
 */
export function createEngine(options: EngineOptions): Engine {
	const { clock, document, language, chapters = [] } = options;
	let settings = resolveSettings(options.settings);
	const timelineOptions = () => ({
		anchor,
		...(language !== undefined ? { language } : {}),
	});
	let anchor: Position = { block: 0, offset: 0 };
	let timeline: Timeline =
		options.timeline ??
		buildTimeline(
			options.document as Document,
			settings,
			language !== undefined ? { language } : {},
		);
	let frames = timeline.frames;
	/** The anchor the Frames from the Cursor onward were built with. */
	let builtAnchor = anchor;
	const listeners: {
		[E in EngineEventName]: Set<(payload: EngineEvents[E]) => void>;
	} = {
		play: new Set(),
		pause: new Set(),
		frameShown: new Set(),
		seek: new Set(),
		end: new Set(),
	};

	/** Rewind targets per unit, computed on first use and dropped when the Timeline changes. */
	const startsCache = new Map<BackUnit, number[]>();
	let index = 0;
	let playing = false;
	let ended = false;
	let stopTicking: (() => void) | undefined;
	let clockOrigin = 0;
	let timeOrigin = 0;

	const emit = <E extends EngineEventName>(
		event: E,
		payload: EngineEvents[E],
	) => {
		for (const listener of [...listeners[event]]) listener(payload);
	};

	const currentFrame = () => frames[index];

	/** Pacing that counts from where the reader pressed play needs a rebuild when that moves. */
	const countsFromAnchor = () =>
		settings.rampSpanWords > 0 || settings.sprintEveryWords > 0;

	const rebuild = () => {
		if (!document) {
			throw new Error(
				"This Engine has no Document to rebuild its Timeline from.",
			);
		}
		timeline = rebuildTimeline(
			document,
			timeline,
			index,
			settings,
			timelineOptions(),
		);
		frames = timeline.frames;
		builtAnchor = anchor;
		startsCache.clear();
	};

	/** Start counting the ramp and sprints from the current Frame. */
	const reanchor = () => {
		const frame = currentFrame();
		if (!frame) return;
		anchor = frame.position;
		if (
			document &&
			countsFromAnchor() &&
			comparePositions(anchor, builtAnchor) !== 0
		) {
			rebuild();
		}
	};

	const show = () => {
		const frame = currentFrame();
		if (frame) {
			emit("frameShown", { frame, index, position: frame.position });
		}
	};

	/** Measure time from the start of the current Frame. */
	const restartTiming = () => {
		clockOrigin = clock.now();
		timeOrigin = currentFrame()?.startMs ?? 0;
	};

	const stopPlaying = () => {
		playing = false;
		stopTicking?.();
		stopTicking = undefined;
	};

	const startsFor = (unit: BackUnit) => {
		let starts = startsCache.get(unit);
		if (!starts) {
			starts = startIndexes(frames, unit, chapters);
			startsCache.set(unit, starts);
		}
		return starts;
	};

	const moveTo = (target: number) => {
		index = target;
		ended = false;
		const frame = currentFrame();
		if (frame) emit("seek", { position: frame.position });
		if (playing) {
			reanchor();
			restartTiming();
			show();
		}
	};

	const tick = () => {
		const time = timeOrigin + (clock.now() - clockOrigin);
		if (time >= timeline.totalMs) {
			index = frames.length - 1;
			stopPlaying();
			ended = true;
			const last = currentFrame();
			if (last) emit("end", { position: last.end });
			return;
		}
		const next = frameAtTime(frames, time);
		if (next !== index) {
			index = next;
			show();
		}
	};

	return {
		get timeline() {
			return timeline;
		},
		get settings() {
			return settings;
		},
		get playing() {
			return playing;
		},
		get index() {
			return index;
		},
		get frame() {
			return currentFrame();
		},
		get position() {
			return currentFrame()?.position;
		},
		play() {
			if (playing || frames.length === 0) return;
			if (ended) {
				index = 0;
				ended = false;
			}
			reanchor();
			playing = true;
			restartTiming();
			const frame = currentFrame();
			if (frame) emit("play", { position: frame.position });
			show();
			if (playing) stopTicking = clock.onTick(tick);
		},
		pause() {
			if (!playing) return;
			stopPlaying();
			const frame = currentFrame();
			if (frame) emit("pause", { position: frame.position });
		},
		seek(position) {
			if (frames.length === 0) return;
			moveTo(frameAtPosition(frames, position));
		},
		back(unit = "sentence") {
			if (frames.length === 0) return;
			moveTo(backTarget(startsFor(unit), index));
		},
		updateSettings(patch) {
			if (!document) {
				throw new Error(
					"This Engine has no Document to rebuild its Timeline from.",
				);
			}
			settings = resolveSettings({ ...settings, ...patch });
			const before = currentFrame();
			const time = timeOrigin + (clock.now() - clockOrigin);
			rebuild();
			if (playing) {
				clockOrigin = clock.now();
				timeOrigin = time;
			}
			const after = currentFrame();
			if (
				after &&
				(after.text !== before?.text ||
					comparePositions(after.end, before?.end ?? after.end) !== 0)
			) {
				show();
			}
		},
		on(event, listener) {
			const set = listeners[event] as Set<typeof listener>;
			set.add(listener);
			return () => {
				set.delete(listener);
			};
		},
	};
}
