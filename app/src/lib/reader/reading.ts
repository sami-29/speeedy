import {
	createEngine,
	createTimerClock,
	type Engine,
	type Timeline,
} from "@speeedy/engine";
import { createLiveTimeline, type LiveTimeline } from "./live-timeline.ts";
import { engineSettings, type ReaderSettings } from "./settings.ts";
import type { TimelineClient } from "./timeline-client.ts";

/** One text being read: its Engine, and the live link that keeps its Timeline in step. */
export type Reading = {
	engine: Engine;
	live: LiveTimeline;
	dispose(): void;
};

/**
 * `performance.measure` names for a change: the time from the reader's first change of a
 * burst until it first took effect (a new speed, or the first Frames of a rebuild), and
 * until the whole Timeline was rebuilt.
 */
export const REBUILD_MEASURE = "speeedy:rebuild";
export const REBUILD_FULL_MEASURE = "speeedy:rebuild-full";

type StartOptions = {
	timeline: Timeline;
	settings: ReaderSettings;
	client: Pick<TimelineClient, "change">;
	/** Called when the worker could not apply a change. */
	onError?: () => void;
};

/**
 * Starts reading a built Timeline. The Engine plays it on the animation-frame clock. The
 * Engine has no Document, so every rebuild goes to the Timeline worker through the live
 * Timeline, and the ramp and sprints re-anchor on play and on a seek while playing.
 */
export function startReading({
	timeline,
	settings,
	client,
	onError,
}: StartOptions): Reading {
	const engine = createEngine({
		clock: createTimerClock(),
		timeline,
		settings: engineSettings(settings),
	});
	let previous: "wpm" | "window" | "tail" | undefined;
	const measure = (name: string, latencyMs: number) => {
		try {
			performance.measure(name, {
				start: performance.now() - latencyMs,
				duration: latencyMs,
			});
		} catch {
			// A measure is a diagnostic; reading goes on without it.
		}
	};
	const live = createLiveTimeline({
		client,
		engine,
		onError: () => onError?.(),
		onApplied({ phase, latencyMs }) {
			if (phase !== "tail" || previous !== "window") {
				measure(REBUILD_MEASURE, latencyMs);
			}
			if (phase === "tail") measure(REBUILD_FULL_MEASURE, latencyMs);
			previous = phase;
		},
	});
	const stops = [
		engine.on("play", ({ position }) => live.anchor(position)),
		engine.on("seek", ({ position }) => {
			if (engine.playing) live.anchor(position);
		}),
	];
	return {
		engine,
		live,
		dispose() {
			for (const stop of stops) stop();
			engine.pause();
			live.dispose();
		},
	};
}
