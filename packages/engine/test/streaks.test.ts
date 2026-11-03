import { describe, expect, it } from "vitest";
import {
	DEFAULT_DAILY_GOAL_MINUTES,
	dailyGoalFor,
	dailySummaries,
	daySummary,
	localDate,
	READING_DAY_MS,
	readingDays,
	streaks,
} from "../src/index";

/** A Session on a local date, `seconds` of active reading long. */
const session = (date: string, seconds: number, wordsRead = 0, wpm = 0) => ({
	date,
	activeMs: seconds * 1000,
	wordsRead,
	wpm,
});

/** `count` consecutive days ending on `last`, each with one Session of `seconds`. */
const run = (last: string, count: number, seconds = 120) => {
	const [y, m, d] = last.split("-").map(Number) as [number, number, number];
	return Array.from({ length: count }, (_, i) => {
		const day = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10);
		return session(day, seconds);
	});
};

const change = (minutes: number, effectiveDate: string, changedAt: number) => ({
	id: `${effectiveDate}-${changedAt}`,
	minutes,
	effectiveDate,
	changedAt,
});

describe("Reading Days", () => {
	it("needs 60 seconds of active reading, no less", () => {
		expect(READING_DAY_MS).toBe(60_000);
		expect(readingDays([session("2026-11-03", 59.999)])).toEqual([]);
		expect(readingDays([session("2026-11-03", 60)])).toEqual(["2026-11-03"]);
	});

	it("adds up the Sessions of one day, so two short reads make a day", () => {
		const sessions = [
			session("2026-11-03", 40),
			session("2026-11-03", 30),
			session("2026-11-04", 40),
		];
		expect(readingDays(sessions)).toEqual(["2026-11-03"]);
	});

	it("lists each day once, oldest first, whatever order the Sessions come in", () => {
		const sessions = [
			session("2026-11-05", 90),
			session("2026-11-03", 90),
			session("2026-11-05", 90),
		];
		expect(readingDays(sessions)).toEqual(["2026-11-03", "2026-11-05"]);
	});
});

describe("Streaks", () => {
	it("is zero for a reader with no Sessions", () => {
		expect(streaks([], "2026-11-03")).toEqual({
			current: 0,
			best: 0,
			readToday: false,
		});
	});

	it("counts consecutive Reading Days up to today", () => {
		expect(streaks(run("2026-11-03", 4), "2026-11-03")).toEqual({
			current: 4,
			best: 4,
			readToday: true,
		});
	});

	it("keeps yesterday's Streak alive until today ends", () => {
		const result = streaks(run("2026-11-02", 3), "2026-11-03");
		expect(result).toEqual({ current: 3, best: 3, readToday: false });
	});

	it("resets to zero after a missed day, and keeps the best", () => {
		const sessions = [...run("2026-10-20", 5), ...run("2026-11-01", 2)];
		// The 2nd was missed, so on the 3rd the last run ended two days ago.
		expect(streaks(sessions, "2026-11-03")).toEqual({
			current: 0,
			best: 5,
			readToday: false,
		});
	});

	it("starts over at 1 when a reader returns after a gap, and the best stays", () => {
		const sessions = [...run("2026-10-20", 5), ...run("2026-11-03", 1)];
		expect(streaks(sessions, "2026-11-03")).toEqual({
			current: 1,
			best: 5,
			readToday: true,
		});
	});

	it("lets the best grow past an older best", () => {
		const sessions = [...run("2026-10-10", 2), ...run("2026-11-03", 6)];
		expect(streaks(sessions, "2026-11-03")).toMatchObject({
			current: 6,
			best: 6,
		});
	});

	it("does not count a day under 60 seconds, so it breaks the run", () => {
		const sessions = [
			...run("2026-11-03", 1),
			session("2026-11-02", 59),
			...run("2026-11-01", 2),
		];
		expect(streaks(sessions, "2026-11-03")).toMatchObject({
			current: 1,
			best: 2,
		});
	});

	it("has no freezes: a gap is a gap", () => {
		const sessions = [...run("2026-11-03", 1), ...run("2026-11-01", 3)];
		expect(streaks(sessions, "2026-11-03")).toMatchObject({
			current: 1,
			best: 3,
		});
	});

	describe("across a local midnight", () => {
		it("puts a read that began before midnight on the day it began", () => {
			// 23:59:50 in New York on the 2nd. The tracker stamps the Session with that date even
			// though most of the minute falls after midnight.
			const startedAt = Date.parse("2026-11-03T04:59:50Z");
			const stamped = localDate(startedAt, "America/New_York");
			expect(stamped).toBe("2026-11-02");
			const sessions = [session(stamped, 120)];
			expect(readingDays(sessions)).toEqual(["2026-11-02"]);
			// At 00:00:10 on the 3rd the Streak is 1 and still alive.
			const now = Date.parse("2026-11-03T05:00:10Z");
			expect(streaks(sessions, localDate(now, "America/New_York"))).toEqual({
				current: 1,
				best: 1,
				readToday: false,
			});
		});
	});

	describe("across a daylight saving change", () => {
		it("sees the 7th, 8th and 9th of March 2026 as three consecutive days in New York", () => {
			const readAt = [
				"2026-03-07T23:00:00Z", // 18:00 EST on the 7th
				"2026-03-08T22:00:00Z", // 18:00 EDT on the 8th, in the 23-hour day
				"2026-03-09T22:00:00Z", // 18:00 EDT on the 9th
			];
			const sessions = readAt.map((iso) =>
				session(localDate(Date.parse(iso), "America/New_York"), 120),
			);
			const today = localDate(
				Date.parse(readAt[2] as string),
				"America/New_York",
			);
			expect(streaks(sessions, today)).toEqual({
				current: 3,
				best: 3,
				readToday: true,
			});
		});

		it("sees the 31st, 1st and 2nd of November as three days across the 25-hour day", () => {
			const readAt = [
				"2026-10-31T22:00:00Z", // 18:00 EDT
				"2026-11-01T23:00:00Z", // 18:00 EST on the 25-hour day
				"2026-11-02T23:00:00Z", // 18:00 EST
			];
			const sessions = readAt.map((iso) =>
				session(localDate(Date.parse(iso), "America/New_York"), 120),
			);
			const today = localDate(
				Date.parse(readAt[2] as string),
				"America/New_York",
			);
			expect(streaks(sessions, today)).toMatchObject({ current: 3, best: 3 });
		});

		it("does not read the morning after a 23-hour day as a missed day", () => {
			// At 00:30 EDT on the 9th, 24 hours earlier is the 7th; the 8th was read too.
			const sessions = [session("2026-03-07", 120), session("2026-03-08", 120)];
			const today = localDate(
				Date.parse("2026-03-09T04:30:00Z"),
				"America/New_York",
			);
			expect(today).toBe("2026-03-09");
			expect(streaks(sessions, today)).toMatchObject({ current: 2 });
		});
	});

	describe("across a time zone change", () => {
		it("keeps the date each Session was stamped with, and does not recompute it", () => {
			// Three days of reading in Auckland, then a flight east to west: at the instant of
			// the last read it is still the 3rd in Los Angeles.
			const sessions = [
				session("2026-11-02", 120),
				session("2026-11-03", 120),
				session("2026-11-04", 120),
			];
			const instant = Date.parse("2026-11-03T19:00:00Z"); // 08:00 on the 4th in Auckland
			expect(localDate(instant, "Pacific/Auckland")).toBe("2026-11-04");
			const today = localDate(instant, "America/Los_Angeles");
			expect(today).toBe("2026-11-03");
			expect(streaks(sessions, today)).toEqual({
				current: 3,
				best: 3,
				readToday: true,
			});
		});

		it("counts a date that two zones both stamped as one Reading Day", () => {
			const sessions = [
				session("2026-11-03", 40), // read in Auckland
				session("2026-11-03", 40), // read in Los Angeles, same calendar date
			];
			expect(readingDays(sessions)).toEqual(["2026-11-03"]);
			expect(streaks(sessions, "2026-11-03")).toMatchObject({ current: 1 });
		});
	});
});

describe("Daily Goal", () => {
	it("is 10 minutes until the reader changes it", () => {
		expect(DEFAULT_DAILY_GOAL_MINUTES).toBe(10);
		expect(dailyGoalFor([], "2026-11-03")).toBe(10);
	});

	it("applies a change from its effective date on, and leaves earlier days alone", () => {
		const changes = [change(20, "2026-11-05", 1)];
		expect(dailyGoalFor(changes, "2026-11-04")).toBe(10);
		expect(dailyGoalFor(changes, "2026-11-05")).toBe(20);
		expect(dailyGoalFor(changes, "2026-12-31")).toBe(20);
	});

	it("uses the goal in force on each day when there are several changes, in any order", () => {
		const changes = [
			change(30, "2026-11-10", 3),
			change(5, "2026-11-01", 1),
			change(15, "2026-11-05", 2),
		];
		expect(dailyGoalFor(changes, "2026-10-31")).toBe(10);
		expect(dailyGoalFor(changes, "2026-11-04")).toBe(5);
		expect(dailyGoalFor(changes, "2026-11-05")).toBe(15);
		expect(dailyGoalFor(changes, "2026-11-10")).toBe(30);
	});

	it("takes the later change when a goal is changed twice for the same day", () => {
		const changes = [
			change(20, "2026-11-05", 100),
			change(25, "2026-11-05", 200),
		];
		expect(dailyGoalFor(changes, "2026-11-05")).toBe(25);
		expect(dailyGoalFor([...changes].reverse(), "2026-11-05")).toBe(25);
	});

	it("does not rewrite a past day when the goal is raised later", () => {
		const sessions = [session("2026-11-03", 600)]; // exactly 10 minutes
		expect(daySummary(sessions, [], "2026-11-03")).toMatchObject({
			goalMinutes: 10,
			goalMet: true,
		});
		const raised = [change(30, "2026-11-04", 5)];
		expect(daySummary(sessions, raised, "2026-11-03")).toMatchObject({
			goalMinutes: 10,
			goalMet: true,
		});
		expect(daySummary(sessions, raised, "2026-11-04")).toMatchObject({
			goalMinutes: 30,
			goalMet: false,
		});
	});
});

describe("day summaries", () => {
	it("reports a day's minutes, words, goal and whether it was met", () => {
		const sessions = [
			session("2026-11-03", 200, 700, 210),
			session("2026-11-03", 400, 1500, 225),
			session("2026-11-02", 30, 100, 200),
		];
		expect(daySummary(sessions, [], "2026-11-03")).toEqual({
			date: "2026-11-03",
			activeMs: 600_000,
			minutes: 10,
			wordsRead: 2200,
			goalMinutes: 10,
			goalMet: true,
			readingDay: true,
		});
		expect(daySummary(sessions, [], "2026-11-02")).toMatchObject({
			minutes: 0,
			goalMet: false,
			readingDay: false,
		});
	});

	it("rounds minutes down, so 9 minutes 59 seconds is not 10", () => {
		const result = daySummary([session("2026-11-03", 599)], [], "2026-11-03");
		expect(result).toMatchObject({ minutes: 9, goalMet: false });
	});

	it("has an empty summary for a day with no Sessions", () => {
		expect(daySummary([], [], "2026-11-03")).toMatchObject({
			activeMs: 0,
			minutes: 0,
			wordsRead: 0,
			goalMet: false,
			readingDay: false,
		});
	});

	it("lists every day in a range, oldest first, including days with no reading", () => {
		const rows = dailySummaries(
			[session("2026-12-31", 120)],
			[],
			"2026-12-30",
			"2027-01-02",
		);
		expect(rows.map((row) => row.date)).toEqual([
			"2026-12-30",
			"2026-12-31",
			"2027-01-01",
			"2027-01-02",
		]);
		expect(rows.map((row) => row.readingDay)).toEqual([
			false,
			true,
			false,
			false,
		]);
	});
});
