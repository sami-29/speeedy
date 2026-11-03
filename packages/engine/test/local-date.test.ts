import { describe, expect, it } from "vitest";
import { localDate, shiftDate } from "../src/index";

const at = (iso: string) => Date.parse(iso);

describe("localDate", () => {
	it("names the calendar day in the reader's zone, not in UTC", () => {
		// 02:30 UTC on the 4th is still the evening of the 3rd in New York.
		const instant = at("2026-11-04T02:30:00Z");
		expect(localDate(instant, "America/New_York")).toBe("2026-11-03");
		expect(localDate(instant, "UTC")).toBe("2026-11-04");
		expect(localDate(instant, "Pacific/Auckland")).toBe("2026-11-04");
	});

	it("turns over at local midnight, to the second", () => {
		// New York is UTC-5 on 2026-11-03 (standard time since the 1st).
		expect(localDate(at("2026-11-04T04:59:59Z"), "America/New_York")).toBe(
			"2026-11-03",
		);
		expect(localDate(at("2026-11-04T05:00:00Z"), "America/New_York")).toBe(
			"2026-11-04",
		);
	});

	it("follows a daylight saving change without skipping or repeating a day", () => {
		// Spring forward, 2026-03-08: the day is 23 hours long in New York.
		const spring = [
			"2026-03-08T04:59:59Z", // 23:59:59 on the 7th (EST)
			"2026-03-08T05:00:00Z", // 00:00 on the 8th
			"2026-03-09T03:59:59Z", // 23:59:59 on the 8th (EDT)
			"2026-03-09T04:00:00Z", // 00:00 on the 9th
		].map((iso) => localDate(at(iso), "America/New_York"));
		expect(spring).toEqual([
			"2026-03-07",
			"2026-03-08",
			"2026-03-08",
			"2026-03-09",
		]);
		// Fall back, 2026-11-01: the day is 25 hours long.
		const fall = [
			"2026-11-01T03:59:59Z", // 23:59:59 on the 31st (EDT)
			"2026-11-01T04:00:00Z", // 00:00 on the 1st
			"2026-11-02T04:59:59Z", // 23:59:59 on the 1st (EST)
			"2026-11-02T05:00:00Z", // 00:00 on the 2nd
		].map((iso) => localDate(at(iso), "America/New_York"));
		expect(fall).toEqual([
			"2026-10-31",
			"2026-11-01",
			"2026-11-01",
			"2026-11-02",
		]);
	});
});

describe("shiftDate", () => {
	it("moves by calendar days across month, year and leap-day ends", () => {
		expect(shiftDate("2026-11-03", -1)).toBe("2026-11-02");
		expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
		expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
		expect(shiftDate("2028-03-01", -1)).toBe("2028-02-29");
		expect(shiftDate("2027-03-01", -1)).toBe("2027-02-28");
		expect(shiftDate("2026-11-03", 0)).toBe("2026-11-03");
	});

	it("steps by whole calendar days, never by 24 hours", () => {
		// 24 hours before 00:30 EDT on 2026-03-09 is the 7th; a calendar step lands on the 8th.
		expect(shiftDate("2026-03-09", -1)).toBe("2026-03-08");
		expect(shiftDate("2026-11-02", -1)).toBe("2026-11-01");
		expect(shiftDate("2026-03-08", 1)).toBe("2026-03-09");
	});
});
