// `daily_goal_met` carries a goal bucket and a Streak bucket, never an exact number.
// Run with: pnpm --filter @speeedy/contracts test:unit
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	CANARY,
	checkEvent,
	clientEvents,
	EVENTS,
	goalMinutesBucket,
	registryProblems,
	streakDaysBucket,
} from "../src/index.ts";

const client = clientEvents(EVENTS);

describe("daily_goal_met", () => {
	it("is a client event in a sound registry", () => {
		assert.ok("daily_goal_met" in client);
		assert.deepEqual(registryProblems(EVENTS), []);
	});

	it("takes the two buckets", () => {
		const result = checkEvent(client, "daily_goal_met", {
			goal_minutes: goalMinutesBucket(10),
			streak_days: streakDaysBucket(4),
		});
		assert.equal(result.ok, true);
	});

	it("refuses an exact goal, an exact Streak and anything else", () => {
		const base = { goal_minutes: "6-10", streak_days: "4-7" };
		assert.equal(checkEvent(client, "daily_goal_met", base).ok, true);
		assert.equal(
			checkEvent(client, "daily_goal_met", { ...base, goal_minutes: 10 }).ok,
			false,
		);
		assert.equal(
			checkEvent(client, "daily_goal_met", { ...base, goal_minutes: "10" }).ok,
			false,
		);
		assert.equal(
			checkEvent(client, "daily_goal_met", { ...base, streak_days: "5" }).ok,
			false,
		);
		for (const extra of ["document_text", "title", "date", "minutes"]) {
			assert.equal(
				checkEvent(client, "daily_goal_met", { ...base, [extra]: CANARY }).ok,
				false,
				extra,
			);
		}
		assert.equal(
			checkEvent(client, "daily_goal_met", { goal_minutes: "6-10" }).ok,
			false,
		);
	});
});

describe("goalMinutesBucket", () => {
	it("puts the default goal of 10 minutes in 6-10", () => {
		assert.equal(goalMinutesBucket(10), "6-10");
	});

	it("covers the whole range of goals at its edges", () => {
		const edges: [number, string][] = [
			[1, "1-5"],
			[5, "1-5"],
			[6, "6-10"],
			[11, "11-20"],
			[20, "11-20"],
			[21, "21-30"],
			[30, "21-30"],
			[31, "31-60"],
			[60, "31-60"],
			[61, "61-plus"],
			[1440, "61-plus"],
		];
		for (const [minutes, bucket] of edges) {
			assert.equal(goalMinutesBucket(minutes), bucket, String(minutes));
		}
	});
});

describe("streakDaysBucket", () => {
	it("buckets a Streak by length", () => {
		const edges: [number, string][] = [
			[1, "1"],
			[2, "2-3"],
			[3, "2-3"],
			[4, "4-7"],
			[7, "4-7"],
			[8, "8-14"],
			[14, "8-14"],
			[15, "15-30"],
			[30, "15-30"],
			[31, "31-plus"],
			[400, "31-plus"],
		];
		for (const [days, bucket] of edges) {
			assert.equal(streakDaysBucket(days), bucket, String(days));
		}
	});
});
