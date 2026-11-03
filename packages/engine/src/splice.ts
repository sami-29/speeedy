import type { EngineSettings, Frame, Timeline } from "./types";

/**
 * One finished piece of a rebuild, as the Timeline worker sends it: Frames to lay over a
 * Timeline from `fromIndex` on.
 */
export type TimelineChange = {
	/** The request this answers. */
	id: number;
	/**
	 * `window` replaces `replaceCount` Frames from `fromIndex` and keeps the Frames after
	 * them. `tail` replaces every Frame from `fromIndex` on.
	 */
	phase: "window" | "tail";
	fromIndex: number;
	replaceCount?: number;
	/** The request has no more phases after this one. */
	last: boolean;
	/** Where the last of `frames` ends, in the worker's time. */
	endMs: number;
	/** The settings the Frames were built with. `wpm` is the speed their times are in. */
	settings: EngineSettings;
	frames: Frame[];
};

/**
 * Lay a change over a Timeline and return the result; `timeline` is left as it was. The
 * Frames before `fromIndex` are kept. `wpm` is the speed the Timeline's times are in
 * (`Engine.timelineWpm`): the change's Frames are put in it, and moved to start where the
 * kept Frames end, so a change built from slightly different earlier Frames (or at an
 * earlier speed) joins without a gap or an overlap. Frames in `change` are rewritten in
 * place: they are the change's own, fresh from the worker.
 *
 * A `window` change keeps the Frames it does not replace as they are, the same objects and
 * the same times, and only moves `totalMs` by the difference. That makes it cheap on a
 * long Document, and it leaves the times a little out of step where the window meets them
 * (by the difference, a few seconds at most). The `tail` change that follows replaces
 * them, so the Cursor, which stays inside the window, never plays across that seam.
 */
export function spliceTimeline(
	timeline: Timeline,
	change: TimelineChange,
	wpm: number,
): Timeline {
	const { fromIndex, frames: added } = change;
	const prefix = timeline.frames.slice(0, fromIndex);
	const before = prefix[prefix.length - 1];
	const start = before ? before.startMs + before.durationMs : 0;
	const addedStart = added[0]?.startMs ?? change.endMs;
	const scale = change.settings.wpm / wpm;

	let end = change.endMs;
	if (scale !== 1 || addedStart !== start) {
		for (const frame of added) {
			frame.startMs = start + (frame.startMs - addedStart) * scale;
			frame.durationMs *= scale;
		}
		end = start + (change.endMs - addedStart) * scale;
	}

	if (change.replaceCount === undefined) {
		return { frames: prefix.concat(added), totalMs: end };
	}
	const rest = timeline.frames.slice(fromIndex + change.replaceCount);
	const first = rest[0];
	if (!first) return { frames: prefix.concat(added), totalMs: end };
	return {
		frames: prefix.concat(added, rest),
		totalMs: timeline.totalMs + (end - first.startMs),
	};
}
