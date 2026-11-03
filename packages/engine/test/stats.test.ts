import { describe, expect, it } from "vitest";
import {
	averageWpm,
	formatDuration,
	formatNumber,
	recentWpms,
} from "../src/index";

// Ported from the 1.x stats-service tests: the cases that do not depend on a date.

describe("averageWpm", () => {
	it("returns 0 when no sessions", () => {
		expect(averageWpm([])).toBe(0);
	});

	it("returns 0 when all sessions have wpm of 0", () => {
		expect(averageWpm([{ wpm: 0 }])).toBe(0);
	});

	it("calculates average wpm correctly", () => {
		expect(averageWpm([{ wpm: 200 }, { wpm: 400 }])).toBe(300);
	});

	it("ignores sessions with wpm of 0 in average", () => {
		expect(averageWpm([{ wpm: 300 }, { wpm: 0 }])).toBe(300);
	});
});

describe("recentWpms", () => {
	it("returns empty array when no sessions", () => {
		expect(recentWpms([])).toEqual([]);
	});

	it("returns last N wpm values", () => {
		const sessions = Array.from({ length: 25 }, (_, i) => ({ wpm: i + 1 }));
		const result = recentWpms(sessions, 20);
		expect(result).toHaveLength(20);
		expect(result[result.length - 1]).toBe(25);
	});

	it("filters out sessions with wpm of 0", () => {
		expect(recentWpms([{ wpm: 0 }, { wpm: 350 }])).toEqual([350]);
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
	});

	it("formats millions with M suffix", () => {
		expect(formatNumber(1000000)).toBe("1.0M");
		expect(formatNumber(2500000)).toBe("2.5M");
	});
});
