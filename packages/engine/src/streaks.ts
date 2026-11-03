import { shiftDate } from "./local-date";

/** What a Session contributes to a day. A `SessionRecord` fits. */
export type DatedSession = {
	/** The local date the Session started on, `YYYY-MM-DD`. */
	date: string;
	activeMs: number;
	wordsRead: number;
};

/** A change to the Daily Goal, kept with the date it applies from. */
export type GoalChange = {
	minutes: number;
	/** The local date the goal applies from, `YYYY-MM-DD`. */
	effectiveDate: string;
	/** When the change was made, to settle two changes for one date. */
	changedAt: number;
};

/** A day needs this much active reading to be a Reading Day. */
export const READING_DAY_MS = 60_000;

/** The Daily Goal until the reader changes it. */
export const DEFAULT_DAILY_GOAL_MINUTES = 10;

export type Streaks = {
	/** Consecutive Reading Days up to today, or up to yesterday while today is still open. */
	current: number;
	/** The longest run of Reading Days there has been. */
	best: number;
	/** Whether today is already a Reading Day. */
	readToday: boolean;
};

export type DaySummary = {
	date: string;
	activeMs: number;
	/** Whole minutes of active reading. */
	minutes: number;
	wordsRead: number;
	/** The goal that applied on this day. */
	goalMinutes: number;
	goalMet: boolean;
	readingDay: boolean;
};

function totalsByDate(sessions: readonly DatedSession[]) {
	const totals = new Map<string, { activeMs: number; wordsRead: number }>();
	for (const session of sessions) {
		const day = totals.get(session.date) ?? { activeMs: 0, wordsRead: 0 };
		day.activeMs += session.activeMs;
		day.wordsRead += session.wordsRead;
		totals.set(session.date, day);
	}
	return totals;
}

/**
 * The dates that count as Reading Days, oldest first: those whose Sessions add up to at
 * least 60 seconds of active reading. Nothing is stored; this is computed from the Sessions.
 */
export function readingDays(sessions: readonly DatedSession[]): string[] {
	return [...totalsByDate(sessions)]
		.filter(([, day]) => day.activeMs >= READING_DAY_MS)
		.map(([date]) => date)
		.sort();
}

/**
 * The reader's Streaks as of `today`. A miss resets the current Streak, the best is the
 * longest run ever, and nothing but reading extends either. A Streak whose last day is
 * yesterday is still alive: today has not been missed yet.
 */
export function streaks(
	sessions: readonly DatedSession[],
	today: string,
): Streaks {
	const days = readingDays(sessions);
	let best = 0;
	let run = 0;
	let previous: string | undefined;
	for (const day of days) {
		run =
			previous !== undefined && shiftDate(previous, 1) === day ? run + 1 : 1;
		best = Math.max(best, run);
		previous = day;
	}
	const latest = days.at(-1);
	const alive = latest !== undefined && latest >= shiftDate(today, -1);
	return {
		current: alive ? run : 0,
		best,
		readToday: latest !== undefined && latest >= today,
	};
}

/**
 * The Daily Goal in minutes on `date`: the latest change that took effect by then, or the
 * default before any did. Two changes for one date settle on the later one.
 */
export function dailyGoalFor(
	changes: readonly GoalChange[],
	date: string,
): number {
	let found: GoalChange | undefined;
	for (const change of changes) {
		if (change.effectiveDate > date) continue;
		if (
			!found ||
			change.effectiveDate > found.effectiveDate ||
			(change.effectiveDate === found.effectiveDate &&
				change.changedAt > found.changedAt)
		) {
			found = change;
		}
	}
	return found?.minutes ?? DEFAULT_DAILY_GOAL_MINUTES;
}

function summarise(
	date: string,
	day: { activeMs: number; wordsRead: number } | undefined,
	changes: readonly GoalChange[],
): DaySummary {
	const activeMs = day?.activeMs ?? 0;
	const goalMinutes = dailyGoalFor(changes, date);
	return {
		date,
		activeMs,
		minutes: Math.floor(activeMs / 60_000),
		wordsRead: day?.wordsRead ?? 0,
		goalMinutes,
		goalMet: activeMs >= goalMinutes * 60_000,
		readingDay: activeMs >= READING_DAY_MS,
	};
}

/** One day's totals against the goal that applied on it. */
export function daySummary(
	sessions: readonly DatedSession[],
	changes: readonly GoalChange[],
	date: string,
): DaySummary {
	return summarise(date, totalsByDate(sessions).get(date), changes);
}

/** Every day from `from` to `to` inclusive, oldest first, days without reading included. */
export function dailySummaries(
	sessions: readonly DatedSession[],
	changes: readonly GoalChange[],
	from: string,
	to: string,
): DaySummary[] {
	const totals = totalsByDate(sessions);
	const rows: DaySummary[] = [];
	for (let date = from; date <= to; date = shiftDate(date, 1)) {
		rows.push(summarise(date, totals.get(date), changes));
	}
	return rows;
}
