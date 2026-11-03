import type { EventProps } from "@speeedy/contracts";
import { goalMinutesBucket, streakDaysBucket } from "@speeedy/contracts";
import {
	type Clock,
	createSessionTracker,
	daySummary,
	type Engine,
	type PageTargets,
	type SessionRecord,
	streaks,
} from "@speeedy/engine";
import type { LibraryStore } from "#lib/library/store.ts";
import { trackEvent } from "#lib/telemetry.ts";

export type SessionRecording = {
	/** Save the Session so far and start a fresh one. */
	flush(): void;
	/** Save what is pending and stop listening. Call when the reader goes away. */
	end(): void;
	/** Resolves when every save so far has finished. Never rejects. */
	idle(): Promise<void>;
};

export type RecordSessionsOptions = {
	engine: Engine;
	/** The Clock the Engine runs on. The tracker measures active time with it. */
	clock: Clock;
	store: Pick<LibraryStore, "addSession" | "sessions" | "dailyGoalChanges">;
	/** The Library document being read, or null for text that is not kept. */
	documentId?: string | null;
	/** Sends `daily_goal_met`. Defaults to the typed analytics send. */
	track?: (
		event: "daily_goal_met",
		props: EventProps<"daily_goal_met">,
	) => void;
	now?: () => number;
	timeZone?: string;
	page?: PageTargets;
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
}: RecordSessionsOptions): SessionRecording {
	let queue: Promise<void> = Promise.resolve();

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
