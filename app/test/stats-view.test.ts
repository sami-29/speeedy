import { describe, expect, it } from "vitest";
import { ZONE_BANDS } from "../src/lib/reader/zones.ts";
import {
	buildStatsView,
	CHART_POINTS,
	speedBandFor,
} from "../src/lib/stats/view.ts";

let n = 0;
const stored = (
	date: string,
	seconds: number,
	wpm = 250,
	wordsRead = Math.round((seconds / 60) * wpm),
) => ({
	id: `s${++n}`,
	date,
	startedAt: Date.parse(`${date}T12:00:00Z`) + n,
	activeMs: seconds * 1000,
	wordsRead,
	wpm,
	documentId: null,
});

describe("Speed Zone bands", () => {
	it("splits speed into study, read and skim at 200 and 350", () => {
		expect(ZONE_BANDS.map((band) => band.id)).toEqual([
			"study",
			"read",
			"skim",
		]);
		expect(speedBandFor(120)).toBe("study");
		expect(speedBandFor(199)).toBe("study");
		expect(speedBandFor(200)).toBe("read");
		expect(speedBandFor(349)).toBe("read");
		expect(speedBandFor(350)).toBe("skim");
		expect(speedBandFor(900)).toBe("skim");
	});
});

describe("the stats view", () => {
	const today = "2026-11-03";

	it("is empty and calm for a reader with no Sessions", () => {
		const view = buildStatsView({ sessions: [], goalChanges: [], today });
		expect(view.today).toMatchObject({
			minutes: 0,
			goalMinutes: 10,
			goalMet: false,
		});
		expect(view.streak).toEqual({ current: 0, best: 0, readToday: false });
		expect(view.totals).toEqual({
			sessions: 0,
			wordsRead: 0,
			activeMs: 0,
			averageWpm: 0,
		});
		expect(view.chart).toEqual([]);
		expect(view.recent).toEqual([]);
		expect(view.week).toHaveLength(7);
	});

	it("shows today's minutes against the goal and the Streak", () => {
		const sessions = [
			stored("2026-11-01", 120),
			stored("2026-11-02", 120),
			stored("2026-11-03", 200),
			stored("2026-11-03", 160),
		];
		const view = buildStatsView({ sessions, goalChanges: [], today });
		expect(view.today).toMatchObject({ minutes: 6, goalMinutes: 10 });
		expect(view.streak).toEqual({ current: 3, best: 3, readToday: true });
	});

	it("totals words, active time and the average speed over timed Sessions", () => {
		const sessions = [
			stored("2026-11-02", 60, 200, 200),
			stored("2026-11-03", 60, 300, 300),
			stored("2026-11-03", 1, 0, 0),
		];
		const view = buildStatsView({ sessions, goalChanges: [], today });
		expect(view.totals).toEqual({
			sessions: 3,
			wordsRead: 500,
			activeMs: 121_000,
			averageWpm: 250,
		});
	});

	it("plots the latest Sessions that have a speed, oldest first, each in its Speed Zone", () => {
		const sessions = Array.from({ length: CHART_POINTS + 5 }, (_, i) =>
			stored("2026-11-03", 60, 100 + i * 20),
		);
		sessions.push(stored("2026-11-03", 5, 0, 0));
		const view = buildStatsView({ sessions, goalChanges: [], today });
		expect(view.chart).toHaveLength(CHART_POINTS);
		const speeds = view.chart.map((point) => point.wpm);
		expect(speeds).toEqual([...speeds].sort((a, b) => a - b));
		expect(speeds.at(-1)).toBe(100 + (CHART_POINTS + 4) * 20);
		expect(view.chart[0]).toMatchObject({ wpm: 200, band: "read" });
		expect(view.chart.at(-1)?.band).toBe("skim");
	});

	it("lists the last seven days with the goal each day had", () => {
		const sessions = [stored("2026-11-02", 700), stored("2026-11-03", 700)];
		const goalChanges = [
			{ id: "g", minutes: 12, effectiveDate: "2026-11-03", changedAt: 9 },
		];
		const view = buildStatsView({ sessions, goalChanges, today });
		expect(view.week.map((day) => day.date)).toEqual([
			"2026-10-28",
			"2026-10-29",
			"2026-10-30",
			"2026-10-31",
			"2026-11-01",
			"2026-11-02",
			"2026-11-03",
		]);
		const yesterday = view.week[5];
		const now = view.week[6];
		expect(yesterday).toMatchObject({ goalMinutes: 10, goalMet: true });
		expect(now).toMatchObject({ goalMinutes: 12, goalMet: false });
	});

	it("lists recent Sessions newest first", () => {
		const sessions = Array.from({ length: 14 }, (_, i) =>
			stored("2026-11-03", 60 + i),
		);
		const view = buildStatsView({ sessions, goalChanges: [], today });
		expect(view.recent).toHaveLength(10);
		expect(view.recent[0]?.id).toBe(sessions[13]?.id);
	});
});
