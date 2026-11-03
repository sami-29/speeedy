import {
	averageWpm,
	type DaySummary,
	dailySummaries,
	daySummary,
	type GoalChange,
	type Streaks,
	shiftDate,
	streaks,
} from "@speeedy/engine";
import type { StoredSession } from "#lib/library/store.ts";
import { type SpeedZoneId, zoneFor } from "#lib/reader/zones.ts";

export const speedBandFor = (wpm: number): SpeedZoneId => zoneFor(wpm).id;

/** How many Sessions the speed chart plots. */
export const CHART_POINTS = 20;
/** How many Sessions the list under the chart shows. */
export const RECENT_SESSIONS = 10;
/** How many days the day list shows. */
export const WEEK_DAYS = 7;

export type ChartPoint = {
	id: string;
	date: string;
	wpm: number;
	band: SpeedZoneId;
};

export type StatsView = {
	today: DaySummary;
	streak: Streaks;
	totals: {
		sessions: number;
		wordsRead: number;
		activeMs: number;
		averageWpm: number;
	};
	/** The latest timed Sessions, oldest first. */
	chart: ChartPoint[];
	/** The last seven days ending today, oldest first. */
	week: DaySummary[];
	/** The latest Sessions, newest first. */
	recent: StoredSession[];
};

/**
 * Everything the stats page and the Library line show, computed from the stored Sessions
 * and Daily Goal changes. Nothing here is stored: a Streak is worked out afresh each time.
 */
export function buildStatsView({
	sessions,
	goalChanges,
	today,
}: {
	sessions: readonly StoredSession[];
	goalChanges: readonly GoalChange[];
	today: string;
}): StatsView {
	const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
	return {
		today: daySummary(ordered, goalChanges, today),
		streak: streaks(ordered, today),
		totals: {
			sessions: ordered.length,
			wordsRead: ordered.reduce((sum, each) => sum + each.wordsRead, 0),
			activeMs: ordered.reduce((sum, each) => sum + each.activeMs, 0),
			averageWpm: averageWpm(ordered),
		},
		chart: ordered
			.filter((each) => each.wpm > 0)
			.slice(-CHART_POINTS)
			.map((each) => ({
				id: each.id,
				date: each.date,
				wpm: each.wpm,
				band: speedBandFor(each.wpm),
			})),
		week: dailySummaries(
			ordered,
			goalChanges,
			shiftDate(today, -(WEEK_DAYS - 1)),
			today,
		),
		recent: ordered.slice(-RECENT_SESSIONS).reverse(),
	};
}
