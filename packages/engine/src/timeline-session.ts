import type { Position } from "@speeedy/contracts";
import { type BuildRequest, handleBuildRequest } from "./build-request";
import { createManualClock } from "./clock";
import { createEngine, type Engine } from "./engine";
import type { EngineSettings, Frame } from "./types";

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
			/** Only the settings that changed. */
			patch: Partial<EngineSettings>;
	  }
	| {
			kind: "anchor";
			id: number;
			/** Where the reader pressed play, or seeked while playing. */
			position: Position;
	  };

/**
 * The worker's answer. A new Timeline comes as `chunk`s with the same `id`, `fromIndex` and
 * `totalMs`: the Frames from `fromIndex` on, a few hundred at a time. Small chunks keep
 * the main thread's share of a 100 000-word rebuild to a few milliseconds per message.
 */
export type TimelineReply =
	| {
			kind: "chunk";
			id: number;
			/** Index of the first Frame of the rebuilt tail. The Frames before it are unchanged. */
			fromIndex: number;
			totalMs: number;
			/** The settings the Timeline is built with, defaults filled in. */
			settings: EngineSettings;
			part: number;
			parts: number;
			frames: Frame[];
	  }
	| { kind: "unchanged"; id: number }
	| { kind: "failed"; id: number; error: string };

export type TimelineSession = {
	/** The replies to send back for one request, in order. Never throws. */
	handle(request: TimelineRequest): TimelineReply[];
};

export type TimelineSessionOptions = {
	/** Frames per `chunk`. Defaults to 500. */
	chunkFrames?: number;
};

const DEFAULT_CHUNK_FRAMES = 500;

type Built = {
	/** An Engine that never plays. It holds the session's Timeline and rebuilds it. */
	shadow: Engine;
};

/**
 * The Timeline worker's whole job, without the worker: build a Timeline, then rebuild it
 * for new settings or a new anchor. It runs the same `Engine.updateSettings` the main thread
 * would, on a shadow Engine, so a rebuild here gives exactly the Frames a rebuild there
 * would. Pure and DOM-free, so it is tested without a worker.
 */
export function createTimelineSession(
	options: TimelineSessionOptions = {},
): TimelineSession {
	const chunkFrames = Math.max(
		Math.floor(options.chunkFrames ?? DEFAULT_CHUNK_FRAMES),
		1,
	);
	let built: Built | undefined;

	const chunks = (
		id: number,
		shadow: Engine,
		fromIndex: number,
	): TimelineReply[] => {
		const { frames, totalMs } = shadow.timeline;
		const tail = frames.slice(fromIndex);
		const parts = Math.max(Math.ceil(tail.length / chunkFrames), 1);
		return Array.from({ length: parts }, (_, part) => ({
			kind: "chunk",
			id,
			fromIndex,
			totalMs,
			settings: shadow.settings,
			part,
			parts,
			frames: tail.slice(part * chunkFrames, (part + 1) * chunkFrames),
		}));
	};

	const build = (
		request: BuildRequest & { kind: "build" },
	): TimelineReply[] => {
		built = undefined;
		const language = request.options?.language;
		const response = handleBuildRequest({
			id: request.id,
			document: request.document,
			...(request.settings ? { settings: request.settings } : {}),
			...(language !== undefined ? { options: { language } } : {}),
		});
		if (!response.ok) {
			return [{ kind: "failed", id: request.id, error: response.error }];
		}
		const shadow = createEngine({
			clock: createManualClock(),
			document: request.document,
			timeline: response.timeline,
			...(request.settings ? { settings: request.settings } : {}),
			...(language !== undefined ? { language } : {}),
		});
		built = { shadow };
		return chunks(request.id, shadow, 0);
	};

	return {
		handle(request) {
			try {
				if (request.kind === "build") return build(request);
				if (!built) {
					return [
						{ kind: "failed", id: request.id, error: "no timeline to change" },
					];
				}
				const { shadow } = built;
				const before = shadow.timeline;
				shadow.seek(request.position);
				const fromIndex = shadow.index;
				if (request.kind === "settings") {
					shadow.updateSettings(request.patch);
				} else {
					// Pressing play is what moves the anchor, so the shadow does the same.
					shadow.play();
					shadow.pause();
					if (shadow.timeline === before) {
						return [{ kind: "unchanged", id: request.id }];
					}
				}
				return chunks(request.id, shadow, fromIndex);
			} catch {
				return [
					{
						kind: "failed",
						id: request.id,
						error:
							request.kind === "build"
								? "timeline could not be built"
								: "timeline could not be changed",
					},
				];
			}
		},
	};
}
