import { comparePositions, type Position } from "@speeedy/contracts";
import { type BuildRequest, handleBuildRequest } from "./build-request";
import { createManualClock } from "./clock";
import { createEngine, type Engine } from "./engine";
import type { TimelineChange } from "./splice";
import { rebuildTimeline, rebuildWindow, resolveSettings } from "./timeline";
import type { EngineSettings, Frame, TokenizedBlock } from "./types";

/**
 * What the app posts to the Timeline worker. The worker keeps one session: the Document
 * and the Timeline it built, so later requests only say what changed.
 */
export type TimelineRequest =
	| ({ kind: "build" } & BuildRequest)
	| {
			kind: "settings";
			id: number;
			/** Where the Cursor is: the Frames before it are kept. */
			position: Position;
			/** Only the settings that changed, and the speed the reader has: the rebuild is built at it. */
			patch: Partial<EngineSettings>;
	  }
	| {
			kind: "anchor";
			id: number;
			/** Where the reader pressed play, or seeked while playing. */
			position: Position;
	  };

/**
 * The worker's answer. A rebuild comes as `chunk`s: a `window` first (the Frames from the
 * Cursor to the end of a sentence about `windowWords` words on, built quickly), then the
 * `tail` (everything after it). A Document that ends inside the window gets the window
 * alone, with `last` set. Each phase is sent in chunks of a few hundred Frames, so the
 * main thread's share of a 100 000-word rebuild comes in small pieces.
 */
export type TimelineReply =
	| {
			kind: "chunk";
			id: number;
			phase: "window" | "tail";
			fromIndex: number;
			/** For a `window`: how many of the Timeline's Frames it replaces. */
			replaceCount?: number;
			last: boolean;
			/** Where the last Frame of the phase ends, in the worker's time. */
			endMs: number;
			/** The settings the Frames are built with, defaults filled in. */
			settings: EngineSettings;
			part: number;
			parts: number;
			frames: Frame[];
	  }
	| { kind: "unchanged"; id: number }
	| { kind: "failed"; id: number; error: string };

type Chunk = Extract<TimelineReply, { kind: "chunk" }>;

export type TimelineSession = {
	/**
	 * Answer one request. With `emit`, each reply is passed to it as soon as it exists (the
	 * window leaves before the tail is built) and the return value is empty. Without it,
	 * every reply is returned. Never throws.
	 */
	handle(
		request: TimelineRequest,
		emit?: (reply: TimelineReply) => void,
	): TimelineReply[];
};

export type TimelineSessionOptions = {
	/** Frames per `chunk`. Defaults to 500. */
	chunkFrames?: number;
	/** Words a window covers before it stops at a sentence end. Defaults to 2000. */
	windowWords?: number;
};

const DEFAULT_CHUNK_FRAMES = 500;
const DEFAULT_WINDOW_WORDS = 2000;

/** Index of the first Frame at or after `from` that starts at or after `position`. */
function firstStartingAtOrAfter(
	frames: readonly Frame[],
	from: number,
	position: Position,
): number {
	let low = from;
	let high = frames.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (comparePositions((frames[middle] as Frame).position, position) < 0) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

/**
 * Collects a request's chunks into whole changes. Feed it each `chunk` as it arrives; it
 * returns a change when a phase's last chunk is in, and undefined before that.
 */
export function createChangeAssembler(): {
	add(chunk: Chunk): TimelineChange | undefined;
} {
	const parts = new Map<
		string,
		{ frames: (Frame[] | undefined)[]; got: number }
	>();
	return {
		add(chunk) {
			const key = `${chunk.id}:${chunk.phase}`;
			let entry = parts.get(key);
			if (!entry) {
				entry = { frames: [], got: 0 };
				parts.set(key, entry);
			}
			entry.frames[chunk.part] = chunk.frames;
			entry.got++;
			if (entry.got < chunk.parts) return undefined;
			parts.delete(key);
			return {
				id: chunk.id,
				phase: chunk.phase,
				fromIndex: chunk.fromIndex,
				...(chunk.replaceCount !== undefined
					? { replaceCount: chunk.replaceCount }
					: {}),
				last: chunk.last,
				endMs: chunk.endMs,
				settings: chunk.settings,
				frames: (entry.frames as Frame[][]).flat(),
			};
		},
	};
}

/**
 * The Timeline worker's whole job, without the worker: build a Timeline, then rebuild it
 * for new settings or a new anchor. It runs the same `Engine.updateSettings` the main thread
 * would, on a shadow Engine, so a rebuild here gives exactly the Frames a rebuild there
 * would, and it sends the first Frames of every rebuild on before building the rest.
 * Pure and DOM-free, so it is tested without a worker.
 */
export function createTimelineSession(
	options: TimelineSessionOptions = {},
): TimelineSession {
	const chunkFrames = Math.max(
		Math.floor(options.chunkFrames ?? DEFAULT_CHUNK_FRAMES),
		1,
	);
	const windowWords = Math.max(
		Math.floor(options.windowWords ?? DEFAULT_WINDOW_WORDS),
		1,
	);
	let shadow: Engine | undefined;
	/** The request being answered: where its replies go and what has been sent so far. */
	let current:
		| {
				id: number;
				emit: (reply: TimelineReply) => void;
				/** Frames the window covered, when one was sent. */
				windowFrames?: number;
				/** The window already reached the end of the Timeline. */
				windowLast?: boolean;
		  }
		| undefined;

	const send = (
		id: number,
		emit: (reply: TimelineReply) => void,
		phase: "window" | "tail",
		frames: Frame[],
		details: {
			fromIndex: number;
			replaceCount?: number;
			last: boolean;
			endMs: number;
			settings: EngineSettings;
		},
	) => {
		const parts = Math.max(Math.ceil(frames.length / chunkFrames), 1);
		for (let part = 0; part < parts; part++) {
			emit({
				kind: "chunk",
				id,
				phase,
				fromIndex: details.fromIndex,
				...(details.replaceCount !== undefined
					? { replaceCount: details.replaceCount }
					: {}),
				last: details.last,
				endMs: details.endMs,
				settings: details.settings,
				part,
				parts,
				frames: frames.slice(part * chunkFrames, (part + 1) * chunkFrames),
			});
		}
	};

	const build = (
		request: BuildRequest & { kind: "build" },
		emit: (reply: TimelineReply) => void,
	) => {
		shadow = undefined;
		const language = request.options?.language;
		// Tokens do not depend on settings: keep them for every rebuild of this Document.
		const tokenCache = new Map<number, TokenizedBlock>();
		const response = handleBuildRequest({
			id: request.id,
			document: request.document,
			...(request.settings ? { settings: request.settings } : {}),
			options: { ...(language !== undefined ? { language } : {}), tokenCache },
		});
		if (!response.ok) {
			emit({ kind: "failed", id: request.id, error: response.error });
			return;
		}
		const document = request.document;
		shadow = createEngine({
			clock: createManualClock(),
			document,
			timeline: response.timeline,
			...(request.settings ? { settings: request.settings } : {}),
			...(language !== undefined ? { language } : {}),
			// Before the full rebuild, send a window of it: that is what the reader waits for.
			rebuilder(doc, timeline, index, wanted, requested) {
				const timelineOptions = { ...requested, tokenCache };
				const settings = resolveSettings(wanted);
				if (current) {
					const window = rebuildWindow(
						doc,
						timeline,
						index,
						settings,
						timelineOptions,
						windowWords,
					);
					const last = window.frames[window.frames.length - 1];
					if (!window.complete && last) {
						const next = firstStartingAtOrAfter(
							timeline.frames,
							index,
							last.end,
						);
						const covers = next >= timeline.frames.length;
						current.windowFrames = window.frames.length;
						current.windowLast = covers;
						send(current.id, current.emit, "window", window.frames, {
							fromIndex: index,
							replaceCount: next - index,
							last: covers,
							endMs: last.startMs + last.durationMs,
							settings,
						});
					}
				}
				return rebuildTimeline(doc, timeline, index, settings, timelineOptions);
			},
		});
		send(request.id, emit, "tail", response.timeline.frames, {
			fromIndex: 0,
			last: true,
			endMs: response.timeline.totalMs,
			settings: shadow.settings,
		});
	};

	const change = (
		request: Exclude<TimelineRequest, { kind: "build" }>,
		emit: (reply: TimelineReply) => void,
	) => {
		if (!shadow) {
			emit({ kind: "failed", id: request.id, error: "no timeline to change" });
			return;
		}
		const engine = shadow;
		const before = engine.timeline;
		engine.seek(request.position);
		const fromIndex = engine.index;
		current = { id: request.id, emit };
		try {
			if (request.kind === "settings") {
				engine.updateSettings(request.patch);
			} else {
				// Pressing play is what moves the anchor, so the shadow does the same.
				engine.play();
				engine.pause();
				if (engine.timeline === before) {
					emit({ kind: "unchanged", id: request.id });
					return;
				}
			}
			if (current.windowLast) return;
			const skipped = current.windowFrames ?? 0;
			const { frames, totalMs } = engine.timeline;
			send(request.id, emit, "tail", frames.slice(fromIndex + skipped), {
				fromIndex: fromIndex + skipped,
				last: true,
				endMs: totalMs,
				settings: engine.settings,
			});
		} finally {
			current = undefined;
		}
	};

	const run = (
		request: TimelineRequest,
		emit: (reply: TimelineReply) => void,
	) => {
		try {
			if (request.kind === "build") build(request, emit);
			else change(request, emit);
		} catch {
			emit({
				kind: "failed",
				id: request.id,
				error:
					request.kind === "build"
						? "timeline could not be built"
						: "timeline could not be changed",
			});
		}
	};

	return {
		handle(request, emit) {
			if (emit) {
				run(request, emit);
				return [];
			}
			const replies: TimelineReply[] = [];
			run(request, (reply) => replies.push(reply));
			return replies;
		},
	};
}
