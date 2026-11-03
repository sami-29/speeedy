/**
 * Buckets for the `daily_goal_met` event. The event never carries the exact goal or the
 * exact Streak, only the bucket each falls in, so it cannot single out a reader.
 */

export const GOAL_MINUTES_BUCKETS = [
	"1-5",
	"6-10",
	"11-20",
	"21-30",
	"31-60",
	"61-plus",
] as const;

export const STREAK_DAYS_BUCKETS = [
	"1",
	"2-3",
	"4-7",
	"8-14",
	"15-30",
	"31-plus",
] as const;

export type GoalMinutesBucket = (typeof GOAL_MINUTES_BUCKETS)[number];
export type StreakDaysBucket = (typeof STREAK_DAYS_BUCKETS)[number];

/** The upper edge of each bucket but the last, in the order of the bucket list. */
const GOAL_EDGES = [5, 10, 20, 30, 60] as const;
const STREAK_EDGES = [1, 3, 7, 14, 30] as const;

function bucketIndex(value: number, edges: readonly number[]): number {
	const index = edges.findIndex((edge) => value <= edge);
	return index === -1 ? edges.length : index;
}

/** The bucket for a Daily Goal in minutes. */
export function goalMinutesBucket(minutes: number): GoalMinutesBucket {
	return GOAL_MINUTES_BUCKETS[
		bucketIndex(minutes, GOAL_EDGES)
	] as GoalMinutesBucket;
}

/** The bucket for a Streak in days. */
export function streakDaysBucket(days: number): StreakDaysBucket {
	return STREAK_DAYS_BUCKETS[
		bucketIndex(days, STREAK_EDGES)
	] as StreakDaysBucket;
}
