import { comparePositions, type Position } from "@speeedy/contracts";
import type { Clock } from "./clock";
import { type BackUnit, backTarget, startIndexes } from "./navigation";
import type { Frame, Timeline } from "./types";

export type EngineEvents = {
	play: { position: Position };
	pause: { position: Position };
	frameShown: { frame: Frame; index: number; position: Position };
	seek: { position: Position };
	end: { position: Position };
};

export type EngineEventName = keyof EngineEvents;

export type Engine = {
	readonly timeline: Timeline;
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
	 * Rewind to the start of the current sentence, paragraph or chapter, or to the start of
	 * the previous one when the Cursor is already on a start. Emits `seek`.
	 */
	back(unit?: BackUnit): void;
	on<E extends EngineEventName>(
		event: E,
		listener: (payload: EngineEvents[E]) => void,
	): () => void;
};

export type EngineOptions = {
	clock: Clock;
	timeline: Timeline;
	/** Where chapters start (see `findChapters`). Without them, back one chapter goes to the start. */
	chapters?: readonly Position[];
};

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
export function createEngine({
	clock,
	timeline,
	chapters = [],
}: EngineOptions): Engine {
	const { frames } = timeline;
	const listeners: {
		[E in EngineEventName]: Set<(payload: EngineEvents[E]) => void>;
	} = {
		play: new Set(),
		pause: new Set(),
		frameShown: new Set(),
		seek: new Set(),
		end: new Set(),
	};

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

	const startsCache = new Map<BackUnit, number[]>();
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
		timeline,
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
		on(event, listener) {
			const set = listeners[event] as Set<typeof listener>;
			set.add(listener);
			return () => {
				set.delete(listener);
			};
		},
	};
}
