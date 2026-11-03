import "fake-indexeddb/auto";
import type { Document } from "@speeedy/contracts";
import {
	buildTimeline,
	createEngine,
	createManualClock,
} from "@speeedy/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLibraryStore,
	LIBRARY_DB_NAME,
	type LibraryStore,
} from "../src/lib/library/store.ts";
import { recordSessions } from "../src/lib/stats/record.ts";

const START = Date.UTC(2026, 10, 3, 17, 0, 0); // 12:00 in New York on 2026-11-03
const ZONE = "America/New_York";
const WORDS = Array.from({ length: 2_000 }, (_, i) => `word${i}`).join(" ");
const DOCUMENT: Document = {
	version: 1,
	blocks: [{ kind: "paragraph", text: WORDS, spans: [] }],
};

let counter = 0;
let store: LibraryStore;
let tracked: [string, Record<string, unknown>][];

beforeEach(() => {
	store = createLibraryStore({
		name: `${LIBRARY_DB_NAME}-record-${++counter}`,
	});
	tracked = [];
});

afterEach(() => store.close());

/** An Engine on a manual clock at 300 wpm (200 ms a Frame), recording into `into`. */
function setup(into: Parameters<typeof recordSessions>[0]["store"] = store) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(DOCUMENT, {
			wpm: 300,
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
		}),
	});
	const recording = recordSessions({
		engine,
		clock,
		store: into,
		documentId: "doc-1",
		track: (event, props) => tracked.push([event, props]),
		now: () => START + clock.now(),
		timeZone: ZONE,
		page: {
			window: new EventTarget(),
			document: Object.assign(new EventTarget(), {
				visibilityState: "visible",
			}),
		},
	});
	const read = (seconds: number) => {
		engine.play();
		for (let left = seconds * 1000; left > 0; left -= 10) clock.advance(10);
		engine.pause();
	};
	return { engine, clock, recording, read };
}

describe("recording Sessions", () => {
	it("stores the Session the tracker finishes, on the day it began", async () => {
		const { recording, read } = setup();
		read(90);
		recording.end();
		await recording.idle();
		const all = await store.sessions();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({
			date: "2026-11-03",
			startedAt: START,
			documentId: "doc-1",
			// The Frame at 0 s and the Frame at 90 s are both shown: 451 Frames in 90 s.
			wordsRead: 451,
			wpm: 301,
		});
		expect(all[0]?.activeMs).toBeGreaterThanOrEqual(89_990);
		expect(all[0]?.activeMs).toBeLessThanOrEqual(90_010);
	});

	it("records nothing when nothing was read", async () => {
		const { recording } = setup();
		recording.end();
		await recording.idle();
		expect(await store.sessions()).toEqual([]);
		expect(tracked).toEqual([]);
	});

	it("stops recording after end()", async () => {
		const { recording, read } = setup();
		recording.end();
		read(70);
		recording.flush();
		await recording.idle();
		expect(await store.sessions()).toEqual([]);
	});

	it("carries on when the Library will not save, and sends no event", async () => {
		const broken = {
			addSession: () => Promise.reject(new Error("storage blocked")),
			sessions: () => Promise.reject(new Error("storage blocked")),
			dailyGoalChanges: () => Promise.reject(new Error("storage blocked")),
		};
		const { recording, read } = setup(broken);
		read(70);
		expect(() => recording.end()).not.toThrow();
		await expect(recording.idle()).resolves.toBeUndefined();
		expect(tracked).toEqual([]);
	});
});

describe("daily_goal_met", () => {
	const setGoal = (minutes: number) =>
		store.setDailyGoal({ minutes, effectiveDate: "2026-11-03" });

	it("is sent once, when a Session takes the day to the goal, with buckets only", async () => {
		await setGoal(2);
		const { recording, read } = setup();
		read(60);
		recording.flush();
		await recording.idle();
		expect(tracked).toEqual([]);
		read(70);
		recording.flush();
		await recording.idle();
		expect(tracked).toEqual([
			["daily_goal_met", { goal_minutes: "1-5", streak_days: "1" }],
		]);
	});

	it("is not sent again for more reading on a day that already met the goal", async () => {
		await setGoal(1);
		const { recording, read } = setup();
		read(70);
		recording.flush();
		await recording.idle();
		read(70);
		recording.flush();
		await recording.idle();
		expect(tracked).toHaveLength(1);
	});

	it("is not sent while the day is short of the goal", async () => {
		const { recording, read } = setup();
		read(300);
		recording.flush();
		await recording.idle();
		expect(tracked).toEqual([]);
	});

	it("carries the Streak bucket, counting the days before", async () => {
		for (const date of [
			"2026-10-30",
			"2026-10-31",
			"2026-11-01",
			"2026-11-02",
		]) {
			await store.addSession({
				date,
				startedAt: Date.parse(`${date}T15:00:00Z`),
				activeMs: 120_000,
				wordsRead: 500,
				wpm: 250,
				documentId: null,
			});
		}
		await setGoal(1);
		const { recording, read } = setup();
		read(70);
		recording.flush();
		await recording.idle();
		expect(tracked).toEqual([
			["daily_goal_met", { goal_minutes: "1-5", streak_days: "4-7" }],
		]);
	});

	it("uses the goal that applied on the Session's day", async () => {
		await store.setDailyGoal({ minutes: 1, effectiveDate: "2026-11-01" });
		await store.setDailyGoal({ minutes: 30, effectiveDate: "2026-11-04" });
		const { recording, read } = setup();
		read(70);
		recording.flush();
		await recording.idle();
		expect(tracked).toEqual([
			["daily_goal_met", { goal_minutes: "1-5", streak_days: "1" }],
		]);
	});
});
