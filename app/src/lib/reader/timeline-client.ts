import type { Position } from "@speeedy/contracts";
import {
	type BuildRequest,
	createChangeAssembler,
	type EngineSettings,
	type Timeline,
	type TimelineChange,
	type TimelineReply,
	type TimelineRequest,
} from "@speeedy/engine";

export type { TimelineChange };

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

export type BuildResult =
	| { ok: true; timeline: Timeline; settings: EngineSettings }
	| { ok: false; error: string };

export type ChangeResult = { ok: true } | { ok: false; error: string };

export type TimelineClient = {
	/** Build the first Timeline for a Document. */
	build(request: Omit<BuildRequest, "id">): Promise<BuildResult>;
	/**
	 * Rebuild from the Cursor for new settings, or re-anchor the ramp and sprints. Each
	 * phase of the answer is passed to `onChange` the moment its last chunk is in; the
	 * promise settles when the request is finished.
	 */
	change(
		request:
			| { kind: "settings"; position: Position; patch: Partial<EngineSettings> }
			| { kind: "anchor"; position: Position },
		onChange: (change: TimelineChange) => void,
	): Promise<ChangeResult>;
	/** Stop listening to the worker. Requests still waiting fail. */
	dispose(): void;
};

type Waiting = {
	assembler: ReturnType<typeof createChangeAssembler>;
	onChange: (change: TimelineChange) => void;
	finish: (result: ChangeResult) => void;
};

const WORKER_FAILED = "Speeedy could not prepare that text for reading.";

/**
 * Talks to the Timeline worker: one request in, the worker's chunks joined into whole
 * changes out. Requests are matched to replies by id, so any number can be in flight.
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
			entry.finish({ ok: false, error: reply.error });
		} else if (reply.kind === "unchanged") {
			waiting.delete(reply.id);
			entry.finish({ ok: true });
		} else {
			const change = entry.assembler.add(reply);
			if (!change) return;
			entry.onChange(change);
			if (change.last) {
				waiting.delete(reply.id);
				entry.finish({ ok: true });
			}
		}
	};

	const failAll = () => {
		for (const [id, entry] of [...waiting]) {
			waiting.delete(id);
			entry.finish({ ok: false, error: WORKER_FAILED });
		}
	};

	worker.addEventListener("message", onMessage);
	worker.addEventListener("error", failAll);

	const send = (
		request: TimelineRequest,
		onChange: (change: TimelineChange) => void,
	): Promise<ChangeResult> =>
		new Promise((finish) => {
			waiting.set(request.id, {
				assembler: createChangeAssembler(),
				onChange,
				finish,
			});
			worker.postMessage(request);
		});

	return {
		async build(request) {
			let built: TimelineChange | undefined;
			const result = await send(
				{ ...request, kind: "build", id: nextId++ },
				(change) => {
					built = change;
				},
			);
			if (!result.ok) return result;
			if (!built) return { ok: false, error: WORKER_FAILED };
			const { frames, endMs, settings } = built as TimelineChange;
			return { ok: true, timeline: { frames, totalMs: endMs }, settings };
		},
		change(request, onChange) {
			return send({ ...request, id: nextId++ }, onChange);
		},
		dispose() {
			worker.removeEventListener("message", onMessage);
			worker.removeEventListener("error", failAll);
			failAll();
		},
	};
}
