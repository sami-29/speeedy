import type { Position } from "@speeedy/contracts";
import type { Engine, EngineSettings } from "@speeedy/engine";
import { joinChange, type TimelineClient } from "./timeline-client.ts";

export type LiveTimelineOptions = {
	client: Pick<TimelineClient, "change">;
	engine: Pick<Engine, "timeline" | "position" | "replaceTimeline">;
	/** How long the settings must sit still before they are sent. Defaults to 150 ms. */
	debounceMs?: number;
	/** Milliseconds on a monotonic clock. Defaults to `performance.now`. */
	now?: () => number;
	/** Called with the worker's message when a change fails. The Timeline is left as it was. */
	onError?: (message: string) => void;
	/** Called when a rebuilt Timeline has been installed. `latencyMs` counts from the first change. */
	onApplied?: (info: {
		request: "settings" | "anchor";
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

const DEBOUNCE_MS = 150;
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
 * Keeps an Engine's Timeline in step with the settings, without blocking the page. A
 * change waits out a short debounce, goes to the Timeline worker as one rebuild from the
 * Cursor, and comes back to be laid over the Frames the Engine already has. While the
 * worker works the Engine plays on with the Timeline it has, so the Frame on screen never
 * moves. One request is in flight at a time and they are answered in order, so the
 * worker's Timeline and the Engine's stay the same.
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

	const apply = (job: Job, change: Parameters<typeof joinChange>[1]) => {
		const frames = engine.timeline.frames;
		if (change.fromIndex > frames.length) {
			options.onError?.("The timeline is out of step with the worker.");
			return;
		}
		engine.replaceTimeline(joinChange(frames, change), change.settings);
		options.onApplied?.({
			request: job.kind,
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
		const result =
			job.kind === "settings"
				? await client.change({
						kind: "settings",
						position: engine.position ?? DOCUMENT_START,
						patch: job.patch,
					})
				: await client.change({ kind: "anchor", position: job.position });
		busy = false;
		if (disposed) return;
		if (!result.ok) options.onError?.(result.error);
		else if (result.change) apply(job, result.change);
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
			pending = {
				patch: { ...pending?.patch, ...patch },
				since: pending?.since ?? now(),
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
