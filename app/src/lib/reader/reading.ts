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

/** `performance.measure` name for a rebuild, from the first change to the Timeline swap. */
export const REBUILD_MEASURE = "speeedy:rebuild";

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
	const live = createLiveTimeline({
		client,
		engine,
		onError: () => onError?.(),
		onApplied({ latencyMs }) {
			try {
				performance.measure(REBUILD_MEASURE, {
					start: performance.now() - latencyMs,
					duration: latencyMs,
				});
			} catch {
				// A measure is a diagnostic; reading goes on without it.
			}
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
