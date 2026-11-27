import type { EventProps } from "@speeedy/contracts";
import { goalMinutesBucket, streakDaysBucket } from "@speeedy/contracts";
import {
	type Clock,
	createSessionTracker,
	daySummary,
	type Engine,
	localDate,
	type PageTargets,
	type SessionRecord,
	streaks,
} from "@speeedy/engine";
import type { DocumentSource, LibraryStore } from "#lib/library/store.ts";
import { trackEvent } from "#lib/telemetry.ts";
import type { VisitContext } from "#lib/visit.ts";
import { sessionStartProps } from "./session-start.ts";

export type SessionRecording = {
	/** Save the Session so far and start a fresh one. */
	flush(): void;
	/** Save what is pending and stop listening. Call when the reader goes away. */
	end(): void;
	/** Resolves when every save so far has finished. Never rejects. */
	idle(): Promise<void>;
};

type Track = <N extends "daily_goal_met" | "session_started">(
	event: N,
	props: EventProps<N>,
) => void;

export type RecordSessionsOptions = {
	engine: Engine;
	/** The Clock the Engine runs on. The tracker measures active time with it. */
	clock: Clock;
	store: Pick<LibraryStore, "addSession" | "sessions" | "dailyGoalChanges">;
	/** The Library document being read, or null for text that is not kept. */
	documentId?: string | null;
	/** Sends `daily_goal_met` and `session_started`. Defaults to the typed analytics send. */
	track?: Track;
	now?: () => number;
	timeZone?: string;
	page?: PageTargets;
	/**
	 * Sends `session_started` as each Session starts, with where the document came from and
	 * the Visit's surface and `ref`. Without it no start event is sent.
	 */
	start?: { source: DocumentSource; visit: () => VisitContext };
};

/**
 * Stores each Session the Engine's tracker finishes, and sends `daily_goal_met` once, when a
 * Session takes the day to its goal. This is the one place the reader meets stats: start it
 * beside the Engine, call `end()` when the Engine goes away. A failed save is dropped, so
 * reading never stops for it.
 */
export function recordSessions({
	engine,
	clock,
	store,
	documentId = null,
	track = trackEvent,
	now,
	timeZone,
	page,
	start,
}: RecordSessionsOptions): SessionRecording {
	let queue: Promise<void> = Promise.resolve();

	// Reads the Sessions stored so far, so it runs on the same queue as the saves: the Session
	// that is starting is never one of them. A Library that will not answer sends nothing.
	const announce = async (startedAt: number) => {
		if (!start) return;
		const sessions = await store.sessions();
		track(
			"session_started",
			sessionStartProps({
				sessions,
				today: localDate(startedAt, timeZone),
				source: start.source,
				visit: start.visit(),
			}),
		);
	};

	const save = async (record: SessionRecord) => {
		const stored = await store.addSession({ ...record, documentId });
		const [sessions, goalChanges] = await Promise.all([
			store.sessions(),
			store.dailyGoalChanges(),
		]);
		const day = daySummary(sessions, goalChanges, stored.date);
		const before = day.activeMs - stored.activeMs;
		if (day.goalMet && before < day.goalMinutes * 60_000) {
			track("daily_goal_met", {
				goal_minutes: goalMinutesBucket(day.goalMinutes),
				streak_days: streakDaysBucket(streaks(sessions, stored.date).current),
			});
		}
	};

	const tracker = createSessionTracker({
		engine,
		clock,
		save: (record) => {
			queue = queue.then(() => save(record)).catch(() => undefined);
		},
		onStart: (startedAt) => {
			queue = queue.then(() => announce(startedAt)).catch(() => undefined);
		},
		...(now ? { now } : {}),
		...(timeZone ? { timeZone } : {}),
		...(page ? { page } : {}),
	});

	return {
		flush: tracker.flush,
		end() {
			tracker.flush();
			tracker.dispose();
		},
		idle: () => queue,
	};
}
