import type { ClockKind, Position } from "@speeedy/contracts";
import {
	type AudioTimeSource,
	type Clock,
	createAudioClock,
	createClockSwitch,
	createEngine,
	createSpeechClock,
	createTimerClock,
	type Engine,
	type Timeline,
} from "@speeedy/engine";
import { audio as audioSystem } from "#lib/audio/instance.ts";
import { library } from "#lib/library/instance.ts";
import { recordSessions } from "#lib/stats/record.ts";
import { createLiveTimeline, type LiveTimeline } from "./live-timeline.ts";
import { engineSettings, type ReaderSettings } from "./settings.ts";
import type { TimelineClient } from "./timeline-client.ts";

/** One text being read: its Engine, and the live link that keeps its Timeline in step. */
export type Reading = {
	engine: Engine;
	live: LiveTimeline;
	/**
	 * The Clocks a Reading Mode can run on, by the kind its descriptor declares: the timer,
	 * the speech Clock, and the audio Clock (the AudioSystem's context time less its output
	 * latency). The audio Clock reads zero until a gesture has unlocked the context, so a
	 * voice unlocks the AudioSystem before it plays on it.
	 */
	clocks: Partial<Record<ClockKind, Clock>>;
	/**
	 * Run the Engine on the Clock of `kind`. The Clocks keep their own time, so call this while
	 * the Engine is paused. Throws for a kind that has no Clock here.
	 */
	useClock(kind: ClockKind): Clock;
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
	/**
	 * The audio context the audio Clock reads, or nothing before there is one. Defaults to the
	 * page's AudioSystem.
	 */
	audio?: () => AudioTimeSource | undefined;
	/** Called when the worker could not apply a change. */
	onError?: () => void;
	/** The Library document being read, or null for text that is not kept. */
	documentId?: string | null;
	/** Where chapters start (see `findChapters`), for back one chapter. */
	chapters?: readonly Position[];
	/** Where to start reading. Without it reading starts at the first Frame. */
	startAt?: Position;
	/** Told where the reader is: on each Frame, and `final` on a pause, the end or a seek while paused. */
	onposition?: (position: Position, final: boolean) => void;
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
	audio = () => audioSystem().context,
	documentId = null,
	chapters,
	startAt,
	onposition,
}: StartOptions): Reading {
	const timer = createTimerClock();
	const clocks: Partial<Record<ClockKind, Clock>> = {
		timer,
		"web-speech": createSpeechClock(),
		audio: createAudioClock(audio),
	};
	// The Engine is made once, on a Clock that follows the mode: RSVP and Pacer run on the
	// timer, Listen on the speech Clock.
	const clock = createClockSwitch(timer);
	const engine = createEngine({
		clock,
		timeline,
		settings: engineSettings(settings),
		chapters,
	});
	// Every Reading Mode is read through this Engine, so every one records its Sessions.
	// Active time is real time whichever Clock paces the Cursor, so the timer measures it.
	const recording = recordSessions({
		engine,
		clock: timer,
		store: library(),
		documentId,
	});
	if (startAt) engine.seek(startAt);
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
		// A rewind, a seek or a chapter jump moves a paused reader too: keep that place.
		engine.on("seek", ({ position }) =>
			onposition?.(position, !engine.playing),
		),
		engine.on("frameShown", ({ frame }) => onposition?.(frame.position, false)),
		engine.on("pause", ({ position }) => onposition?.(position, true)),
		engine.on("end", ({ position }) => onposition?.(position, true)),
	];
	return {
		engine,
		live,
		clocks,
		useClock(kind) {
			const next = clocks[kind];
			if (!next) throw new Error(`There is no ${kind} Clock for this reading.`);
			clock.use(next);
			return next;
		},
		dispose() {
			// Pause first, so the Position of a pause reaches `onposition` before it is detached.
			engine.pause();
			for (const stop of stops) stop();
			recording.end();
			live.dispose();
		},
	};
}
