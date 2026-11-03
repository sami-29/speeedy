import type { Position } from "@speeedy/contracts";
import type {
	BuildRequest,
	EngineSettings,
	Frame,
	Timeline,
	TimelineReply,
	TimelineRequest,
} from "@speeedy/engine";

/** The slice of a Worker the client uses. Tests pass an in-process stand-in. */
export type WorkerLike = {
	postMessage(message: TimelineRequest): void;
	addEventListener(
		type: "message" | "error",
		listener: (event: { data?: unknown }) => void,
	): void;
	removeEventListener(
		type: "message" | "error",
		listener: (event: { data?: unknown }) => void,
	): void;
};

/** The Frames from `fromIndex` on, as the worker rebuilt them. */
export type TimelineChange = {
	fromIndex: number;
	totalMs: number;
	settings: EngineSettings;
	frames: Frame[];
};

export type BuildResult =
	| { ok: true; timeline: Timeline; settings: EngineSettings }
	| { ok: false; error: string };

export type ChangeResult =
	| { ok: true; change?: TimelineChange }
	| { ok: false; error: string };

export type TimelineClient = {
	/** Build the first Timeline for a Document. */
	build(request: Omit<BuildRequest, "id">): Promise<BuildResult>;
	/** Rebuild from the Cursor for new settings, or re-anchor the ramp and sprints. */
	change(
		request:
			| {
					kind: "settings";
					position: Position;
					patch: Partial<EngineSettings>;
			  }
			| { kind: "anchor"; position: Position },
	): Promise<ChangeResult>;
	/** Stop listening to the worker. Requests still waiting fail. */
	dispose(): void;
};

type Outcome =
	| { kind: "failed"; error: string }
	| { kind: "unchanged" }
	| { kind: "change"; change: TimelineChange };

type Waiting = {
	resolve: (outcome: Outcome) => void;
	parts: (Frame[] | undefined)[];
	received: number;
};

const WORKER_FAILED = "Speeedy could not prepare that text for reading.";

/** The Timeline with `change` laid over the end of `frames`. */
export function joinChange(
	frames: readonly Frame[],
	change: TimelineChange,
): Timeline {
	return {
		frames: frames.slice(0, change.fromIndex).concat(change.frames),
		totalMs: change.totalMs,
	};
}

/**
 * Talks to the Timeline worker: one request in, the worker's chunks joined into one
 * answer out. Requests are matched to replies by id, so any number can be in flight.
 */
export function createTimelineClient(worker: WorkerLike): TimelineClient {
	let nextId = 1;
	const waiting = new Map<number, Waiting>();

	const onMessage = (event: { data?: unknown }) => {
		const reply = event.data as TimelineReply | undefined;
		if (!reply || typeof reply.id !== "number") return;
		const entry = waiting.get(reply.id);
		if (!entry) return;
		if (reply.kind === "failed") {
			waiting.delete(reply.id);
			entry.resolve({ kind: "failed", error: reply.error });
		} else if (reply.kind === "unchanged") {
			waiting.delete(reply.id);
			entry.resolve({ kind: "unchanged" });
		} else {
			entry.parts[reply.part] = reply.frames;
			entry.received++;
			if (entry.received === reply.parts) {
				waiting.delete(reply.id);
				entry.resolve({
					kind: "change",
					change: {
						fromIndex: reply.fromIndex,
						totalMs: reply.totalMs,
						settings: reply.settings,
						frames: (entry.parts as Frame[][]).flat(),
					},
				});
			}
		}
	};

	const failAll = () => {
		for (const [id, entry] of [...waiting]) {
			waiting.delete(id);
			entry.resolve({ kind: "failed", error: WORKER_FAILED });
		}
	};

	worker.addEventListener("message", onMessage);
	worker.addEventListener("error", failAll);

	const send = (request: TimelineRequest): Promise<Outcome> =>
		new Promise((resolve) => {
			waiting.set(request.id, { resolve, parts: [], received: 0 });
			worker.postMessage(request);
		});

	return {
		async build(request) {
			const outcome = await send({
				...request,
				kind: "build",
				id: nextId++,
			});
			if (outcome.kind === "failed") return { ok: false, error: outcome.error };
			if (outcome.kind === "unchanged") {
				return { ok: false, error: WORKER_FAILED };
			}
			const { change } = outcome;
			return {
				ok: true,
				timeline: { frames: change.frames, totalMs: change.totalMs },
				settings: change.settings,
			};
		},
		async change(request) {
			const outcome = await send({ ...request, id: nextId++ });
			if (outcome.kind === "failed") return { ok: false, error: outcome.error };
			if (outcome.kind === "unchanged") return { ok: true };
			return { ok: true, change: outcome.change };
		},
		dispose() {
			worker.removeEventListener("message", onMessage);
			worker.removeEventListener("error", failAll);
			failAll();
		},
	};
}
