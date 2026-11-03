import type { Position } from "@speeedy/contracts";
import {
	type Engine,
	type EngineSettings,
	spliceTimeline,
	type TimelineChange,
} from "@speeedy/engine";
import type { TimelineClient } from "./timeline-client.ts";

export type LiveTimelineOptions = {
	client: Pick<TimelineClient, "change">;
	engine: Pick<
		Engine,
		| "timeline"
		| "position"
		| "settings"
		| "timelineWpm"
		| "replaceTimeline"
		| "setWpm"
	>;
	/** How long the settings must sit still before they are sent. Defaults to 60 ms. */
	debounceMs?: number;
	/** Milliseconds on a monotonic clock. Defaults to `performance.now`. */
	now?: () => number;
	/** Called with the worker's message when a change fails. The Timeline is left as it was. */
	onError?: (message: string) => void;
	/**
	 * Called when a change has taken effect: a new speed (`wpm`, at once), the first Frames
	 * of a rebuild (`window`) or the rest of it (`tail`). `latencyMs` counts from the first
	 * change of a burst, so it includes the debounce.
	 */
	onApplied?: (info: {
		request: "settings" | "anchor";
		phase: "wpm" | "window" | "tail";
		latencyMs: number;
	}) => void;
};

export type LiveTimeline = {
	/** New settings. Several changes close together become one rebuild. */
	change(patch: Partial<EngineSettings>): void;
	/** The reader pressed play, or seeked while playing: the ramp and sprints start here. */
	anchor(position: Position): void;
	/** Resolves when nothing is waiting and nothing is in flight. */
	settled(): Promise<void>;
	dispose(): void;
};

const DEBOUNCE_MS = 60;
const DOCUMENT_START: Position = { block: 0, offset: 0 };

type Job =
	| {
			kind: "settings";
			patch: Partial<EngineSettings>;
			startedAt: number;
	  }
	| { kind: "anchor"; position: Position; startedAt: number };

const samePosition = (a: Position, b: Position): boolean =>
	a.block === b.block && a.offset === b.offset;

/**
 * Keeps an Engine's Timeline in step with the settings, without blocking the page.
 *
 * A change of speed is applied at once, to every Frame, and never reaches the worker: no
 * pacing rule reads the speed. Any other change waits out a short debounce, goes to the
 * Timeline worker as one rebuild from the Cursor, and comes back in two phases: a window
 * from the Cursor, then the rest. Each is laid over the Frames the Engine already has, at
 * the speed the reader has by then. While the worker works the Engine plays on with the
 * Timeline it has, so the Frame on screen never moves. One request is in flight at a time
 * and they are answered in order, so the worker's Timeline and the Engine's stay the same.
 */
export function createLiveTimeline(options: LiveTimelineOptions): LiveTimeline {
	const { client, engine } = options;
	const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
	const now = options.now ?? (() => performance.now());

	let pending: { patch: Partial<EngineSettings>; since: number } | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const queue: Job[] = [];
	let busy = false;
	let disposed = false;
	let lastAnchor: Position = DOCUMENT_START;
	let idleWaiters: (() => void)[] = [];

	const isIdle = () => !pending && queue.length === 0 && !busy;
	const wakeWaiters = () => {
		if (!isIdle()) return;
		const waiters = idleWaiters;
		idleWaiters = [];
		for (const resolve of waiters) resolve();
	};

	const apply = (job: Job, change: TimelineChange) => {
		if (disposed) return;
		if (change.fromIndex > engine.timeline.frames.length) {
			options.onError?.("The timeline is out of step with the worker.");
			return;
		}
		// The Frames are in the Timeline's own speed; the reader may have changed theirs
		// since the request left, and keeps the one they have.
		const units = engine.timelineWpm;
		engine.replaceTimeline(
			spliceTimeline(engine.timeline, change, units),
			{ ...change.settings, wpm: engine.settings.wpm },
			{ timelineWpm: units },
		);
		options.onApplied?.({
			request: job.kind,
			phase: change.phase,
			latencyMs: now() - job.startedAt,
		});
	};

	const pump = async () => {
		if (busy || disposed) return;
		const job = queue.shift();
		if (!job) {
			wakeWaiters();
			return;
		}
		busy = true;
		const onChange = (change: TimelineChange) => apply(job, change);
		const result =
			job.kind === "settings"
				? await client.change(
						{
							kind: "settings",
							position: engine.position ?? DOCUMENT_START,
							// The worker builds at the speed the reader has now.
							patch: { ...job.patch, wpm: engine.settings.wpm },
						},
						onChange,
					)
				: await client.change(
						{ kind: "anchor", position: job.position },
						onChange,
					);
		busy = false;
		if (disposed) return;
		if (!result.ok) options.onError?.(result.error);
		void pump();
	};

	const flush = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		if (!pending) return;
		const last = queue[queue.length - 1];
		if (last?.kind === "settings") {
			Object.assign(last.patch, pending.patch);
		} else {
			queue.push({
				kind: "settings",
				patch: pending.patch,
				startedAt: pending.since,
			});
		}
		pending = undefined;
		void pump();
	};

	return {
		change(patch) {
			if (disposed) return;
			const { wpm, ...rebuild } = patch;
			const started = now();
			if (wpm !== undefined && wpm !== engine.settings.wpm) {
				engine.setWpm(wpm);
				options.onApplied?.({
					request: "settings",
					phase: "wpm",
					latencyMs: now() - started,
				});
			}
			if (Object.values(rebuild).every((value) => value === undefined)) return;
			pending = {
				patch: { ...pending?.patch, ...rebuild },
				since: pending?.since ?? started,
			};
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(flush, debounceMs);
		},
		anchor(position) {
			if (disposed || samePosition(position, lastAnchor)) return;
			lastAnchor = position;
			// A change still waiting goes first: the worker applies them in the order sent.
			flush();
			const last = queue[queue.length - 1];
			if (last?.kind === "anchor") {
				last.position = position;
			} else {
				queue.push({ kind: "anchor", position, startedAt: now() });
			}
			void pump();
		},
		settled() {
			if (isIdle()) return Promise.resolve();
			return new Promise<void>((resolve) => idleWaiters.push(resolve));
		},
		dispose() {
			disposed = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			pending = undefined;
			queue.length = 0;
			const waiters = idleWaiters;
			idleWaiters = [];
			for (const resolve of waiters) resolve();
		},
	};
}
