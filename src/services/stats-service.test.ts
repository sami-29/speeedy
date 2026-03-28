import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingSession, UserProfile } from "../models/types.js";
import { DEFAULT_SETTINGS } from "./defaults.js";
import {
	formatDuration,
	formatNumber,
	getAverageWpm,
	getDailyWordsRead,
	getRecentWpms,
	getTodayWords,
	recordSession,
} from "./stats-service.js";

// Mock saveProfile so tests don't hit IndexedDB
vi.mock("./storage-service.js", () => ({
	saveProfile: vi.fn(),
}));

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
	return {
		id: "test-id",
		displayName: "Tester",
		avatarEmoji: "📚",
		avatarImage: null,
		createdAt: "2024-01-01T00:00:00.000Z",
		goals: { type: "words", target: 10000 },
		totalWordsRead: 0,
		totalTimeMs: 0,
		currentStreak: 0,
		bestStreak: 0,
		lastReadDate: null,
		sessions: [],
		settings: { ...DEFAULT_SETTINGS },
		baselineWpm: null,
		baselineComprehension: null,
		onboardingSeen: false,
		...overrides,
	};
}

function makeSession(
	overrides: Partial<Omit<ReadingSession, "id">> = {},
): Omit<ReadingSession, "id"> {
	return {
		date: new Date().toISOString(),
		sourceTitle: "Test Book",
		wordCount: 1000,
		wordsRead: 500,
		wpm: 300,
		durationMs: 100000,
		completionPercent: 50,
		...overrides,
	};
}

describe("recordSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("adds a new session to the profile", () => {
		const profile = makeProfile();
		const session = makeSession();
		const updated = recordSession(profile, session);
		expect(updated.sessions).toHaveLength(1);
		expect(updated.sessions[0].wordsRead).toBe(500);
	});

	it("assigns a unique id to the session", () => {
		const profile = makeProfile();
		const updated = recordSession(profile, makeSession());
		expect(updated.sessions[0].id).toBeTruthy();
		expect(typeof updated.sessions[0].id).toBe("string");
	});

	it("accumulates totalWordsRead", () => {
		const profile = makeProfile({ totalWordsRead: 1000 });
		const updated = recordSession(profile, makeSession({ wordsRead: 500 }));
		expect(updated.totalWordsRead).toBe(1500);
	});

	it("accumulates totalTimeMs", () => {
		const profile = makeProfile({ totalTimeMs: 60000 });
		const updated = recordSession(profile, makeSession({ durationMs: 30000 }));
		expect(updated.totalTimeMs).toBe(90000);
	});

	it("sets lastReadDate to today", () => {
		const today = new Date().toISOString().split("T")[0];
		const profile = makeProfile();
		const updated = recordSession(profile, makeSession());
		expect(updated.lastReadDate).toBe(today);
	});

	it("starts streak at 1 when no previous read date", () => {
		const profile = makeProfile({ lastReadDate: null, currentStreak: 0 });
		const updated = recordSession(profile, makeSession());
		expect(updated.currentStreak).toBe(1);
	});

	it("maintains streak when reading on same day", () => {
		const today = new Date().toISOString().split("T")[0];
		const profile = makeProfile({
			lastReadDate: today,
			currentStreak: 5,
		});
		const updated = recordSession(profile, makeSession());
		expect(updated.currentStreak).toBe(5);
	});

	it("increments streak when reading on consecutive day", () => {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		const yesterdayStr = yesterday.toISOString().split("T")[0];
		const profile = makeProfile({
			lastReadDate: yesterdayStr,
			currentStreak: 3,
		});
		const updated = recordSession(profile, makeSession());
		expect(updated.currentStreak).toBe(4);
	});

	it("resets streak to 1 when gap is more than 1 day", () => {
		const threeDaysAgo = new Date();
		threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
		const profile = makeProfile({
			lastReadDate: threeDaysAgo.toISOString().split("T")[0],
			currentStreak: 10,
		});
		const updated = recordSession(profile, makeSession());
		expect(updated.currentStreak).toBe(1);
	});

	it("updates bestStreak when current streak exceeds it", () => {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		const profile = makeProfile({
			lastReadDate: yesterday.toISOString().split("T")[0],
			currentStreak: 9,
			bestStreak: 9,
		});
		const updated = recordSession(profile, makeSession());
		expect(updated.bestStreak).toBe(10);
	});

	it("does not lower bestStreak when current streak is lower", () => {
		const profile = makeProfile({
			lastReadDate: null,
			currentStreak: 0,
			bestStreak: 50,
		});
		const updated = recordSession(profile, makeSession());
		expect(updated.bestStreak).toBe(50);
	});

	it("caps sessions at 500 entries", () => {
		const sessions: ReadingSession[] = Array.from({ length: 500 }, (_, i) => ({
			id: `session-${i}`,
			date: new Date().toISOString(),
			sourceTitle: "Book",
			wordCount: 100,
			wordsRead: 100,
			wpm: 300,
			durationMs: 20000,
			completionPercent: 100,
		}));
		const profile = makeProfile({ sessions });
		const updated = recordSession(profile, makeSession());
		expect(updated.sessions).toHaveLength(500);
	});
});

describe("getAverageWpm", () => {
	it("returns 0 when no sessions", () => {
		expect(getAverageWpm(makeProfile())).toBe(0);
	});

	it("returns 0 when all sessions have wpm of 0", () => {
		const profile = makeProfile({
			sessions: [
				{
					id: "1",
					date: new Date().toISOString(),
					sourceTitle: "Book",
					wordCount: 100,
					wordsRead: 0,
					wpm: 0,
					durationMs: 0,
					completionPercent: 0,
				},
			],
		});
		expect(getAverageWpm(profile)).toBe(0);
	});

	it("calculates average wpm correctly", () => {
		const profile = makeProfile({
			sessions: [
				{
					id: "1",
					date: new Date().toISOString(),
					sourceTitle: "Book",
					wordCount: 100,
					wordsRead: 100,
					wpm: 200,
					durationMs: 30000,
					completionPercent: 100,
				},
				{
					id: "2",
					date: new Date().toISOString(),
					sourceTitle: "Book",
					wordCount: 100,
					wordsRead: 100,
					wpm: 400,
					durationMs: 15000,
					completionPercent: 100,
				},
			],
		});
		expect(getAverageWpm(profile)).toBe(300);
	});

	it("ignores sessions with wpm of 0 in average", () => {
		const profile = makeProfile({
			sessions: [
				{
					id: "1",
					date: new Date().toISOString(),
					sourceTitle: "Book",
					wordCount: 100,
					wordsRead: 100,
					wpm: 300,
					durationMs: 20000,
					completionPercent: 100,
				},
				{
					id: "2",
					date: new Date().toISOString(),
					sourceTitle: "Book",
					wordCount: 0,
					wordsRead: 0,
					wpm: 0,
					durationMs: 0,
					completionPercent: 0,
				},
			],
		});
		expect(getAverageWpm(profile)).toBe(300);
	});
});

describe("getDailyWordsRead", () => {
	it("returns array of length equal to days param", () => {
		const profile = makeProfile();
		const result = getDailyWordsRead(profile, 7);
		expect(result).toHaveLength(7);
	});

	it("returns 30 days by default", () => {
		const profile = makeProfile();
		const result = getDailyWordsRead(profile);
		expect(result).toHaveLength(30);
	});

	it("returns 0 words for days with no sessions", () => {
		const profile = makeProfile();
		const result = getDailyWordsRead(profile, 7);
		expect(result.every((d) => d.words === 0)).toBe(true);
	});

	it("aggregates words for today's sessions", () => {
		const today = new Date().toISOString();
		const profile = makeProfile({
			sessions: [
				{
					id: "1",
					date: today,
					sourceTitle: "Book",
					wordCount: 1000,
					wordsRead: 300,
					wpm: 300,
					durationMs: 60000,
					completionPercent: 30,
				},
				{
					id: "2",
					date: today,
					sourceTitle: "Book 2",
					wordCount: 500,
					wordsRead: 200,
					wpm: 300,
					durationMs: 40000,
					completionPercent: 40,
				},
			],
		});
		const result = getDailyWordsRead(profile, 7);
		const todayEntry = result[result.length - 1];
		expect(todayEntry.words).toBe(500);
	});

	it("excludes sessions older than the cutoff", () => {
		const oldDate = new Date();
		oldDate.setDate(oldDate.getDate() - 60);
		const profile = makeProfile({
			sessions: [
				{
					id: "1",
					date: oldDate.toISOString(),
					sourceTitle: "Old Book",
					wordCount: 1000,
					wordsRead: 1000,
					wpm: 300,
					durationMs: 200000,
					completionPercent: 100,
				},
			],
		});
		const result = getDailyWordsRead(profile, 30);
		expect(result.every((d) => d.words === 0)).toBe(true);
	});

	it("returns dates in ascending order", () => {
		const profile = makeProfile();
		const result = getDailyWordsRead(profile, 7);
		for (let i = 1; i < result.length; i++) {
			expect(result[i].date >= result[i - 1].date).toBe(true);
		}
	});
});

describe("getRecentWpms", () => {
	it("returns empty array when no sessions", () => {
		expect(getRecentWpms(makeProfile())).toEqual([]);
	});

	it("returns last N wpm values", () => {
		const sessions: ReadingSession[] = Array.from({ length: 25 }, (_, i) => ({
			id: `s${i}`,
			date: new Date().toISOString(),
			sourceTitle: "Book",
			wordCount: 100,
			wordsRead: 100,
			wpm: i + 1,
			durationMs: 20000,
			completionPercent: 100,
		}));
		const profile = makeProfile({ sessions });
		const result = getRecentWpms(profile, 20);
		expect(result).toHaveLength(20);
		expect(result[result.length - 1]).toBe(25);
	});

	it("filters out sessions with wpm of 0", () => {
		const profile = makeProfile({
			sessions: [
				{
					id: "1",
					date: new Date().toISOString(),
					sourceTitle: "Book",
					wordCount: 100,
					wordsRead: 0,
					wpm: 0,
					durationMs: 0,
					completionPercent: 0,
				},
				{
					id: "2",
					date: new Date().toISOString(),
					sourceTitle: "Book",
					wordCount: 100,
					wordsRead: 100,
					wpm: 350,
					durationMs: 17000,
					completionPercent: 100,
				},
			],
		});
		const result = getRecentWpms(profile);
		expect(result).toEqual([350]);
	});
});

describe("getTodayWords", () => {
	it("returns 0 when no sessions", () => {
		expect(getTodayWords(makeProfile())).toBe(0);
	});

	it("sums words from today's sessions only", () => {
		const today = new Date().toISOString();
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);

		const profile = makeProfile({
			sessions: [
				{
					id: "1",
					date: today,
					sourceTitle: "Book",
					wordCount: 1000,
					wordsRead: 400,
					wpm: 300,
					durationMs: 80000,
					completionPercent: 40,
				},
				{
					id: "2",
					date: yesterday.toISOString(),
					sourceTitle: "Old Book",
					wordCount: 500,
					wordsRead: 500,
					wpm: 300,
					durationMs: 100000,
					completionPercent: 100,
				},
			],
		});
		expect(getTodayWords(profile)).toBe(400);
	});
});

describe("formatDuration", () => {
	it("formats seconds only", () => {
		expect(formatDuration(45000)).toBe("45s");
	});

	it("formats minutes and seconds", () => {
		expect(formatDuration(90000)).toBe("1m 30s");
	});

	it("formats hours and minutes", () => {
		expect(formatDuration(3660000)).toBe("1h 1m");
	});

	it("formats zero duration", () => {
		expect(formatDuration(0)).toBe("0s");
	});

	it("formats exactly 1 minute", () => {
		expect(formatDuration(60000)).toBe("1m 0s");
	});

	it("formats exactly 1 hour", () => {
		expect(formatDuration(3600000)).toBe("1h 0m");
	});

	it("formats large durations", () => {
		// 2h 30m 15s = 9015000ms
		expect(formatDuration(9015000)).toBe("2h 30m");
	});
});

describe("formatNumber", () => {
	it("formats numbers below 1000 as-is", () => {
		expect(formatNumber(999)).toBe("999");
		expect(formatNumber(0)).toBe("0");
		expect(formatNumber(1)).toBe("1");
	});

	it("formats thousands with K suffix", () => {
		expect(formatNumber(1000)).toBe("1.0K");
		expect(formatNumber(1500)).toBe("1.5K");
		expect(formatNumber(999999)).toBe("1000.0K");
	});

	it("formats millions with M suffix", () => {
		expect(formatNumber(1000000)).toBe("1.0M");
		expect(formatNumber(2500000)).toBe("2.5M");
	});

	it("handles boundary between K and M", () => {
		expect(formatNumber(999999)).toContain("K");
		expect(formatNumber(1000000)).toContain("M");
	});
});
