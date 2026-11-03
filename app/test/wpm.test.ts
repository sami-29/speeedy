import { describe, expect, it } from "vitest";
import {
	clampWpm,
	WPM_MAX,
	WPM_MIN,
	wpmForKey,
	wpmFromDrag,
} from "../src/lib/reader/wpm.ts";
import { SPEED_ZONES, zoneFor } from "../src/lib/reader/zones.ts";

describe("WPM range", () => {
	it("runs from 100 to 1600", () => {
		expect(WPM_MIN).toBe(100);
		expect(WPM_MAX).toBe(1600);
	});

	it("clamps and rounds to a whole number", () => {
		expect(clampWpm(5)).toBe(100);
		expect(clampWpm(99999)).toBe(1600);
		expect(clampWpm(250.4)).toBe(250);
		expect(clampWpm(Number.NaN)).toBe(250);
	});
});

describe("slider keys", () => {
	const key = (name: string, shiftKey = false) => ({ key: name, shiftKey });

	it("arrows step by 10 and by 50 with Shift", () => {
		expect(wpmForKey(key("ArrowRight"), 250)).toBe(260);
		expect(wpmForKey(key("ArrowUp"), 250)).toBe(260);
		expect(wpmForKey(key("ArrowLeft"), 250)).toBe(240);
		expect(wpmForKey(key("ArrowDown"), 250)).toBe(240);
		expect(wpmForKey(key("ArrowRight", true), 250)).toBe(300);
		expect(wpmForKey(key("ArrowLeft", true), 250)).toBe(200);
	});

	it("PageUp and PageDown step by 50", () => {
		expect(wpmForKey(key("PageUp"), 250)).toBe(300);
		expect(wpmForKey(key("PageDown"), 250)).toBe(200);
	});

	it("Home and End go to the ends", () => {
		expect(wpmForKey(key("Home"), 250)).toBe(100);
		expect(wpmForKey(key("End"), 250)).toBe(1600);
	});

	it("stops at the ends", () => {
		expect(wpmForKey(key("ArrowLeft"), 100)).toBe(100);
		expect(wpmForKey(key("ArrowRight"), 1600)).toBe(1600);
	});

	it("leaves other keys alone", () => {
		expect(wpmForKey(key("a"), 250)).toBeUndefined();
		expect(wpmForKey(key("Tab"), 250)).toBeUndefined();
	});
});

describe("dragging the numeral", () => {
	it("moves 10 WPM for every 8 pixels, from where the drag started", () => {
		expect(wpmFromDrag(250, 0)).toBe(250);
		expect(wpmFromDrag(250, 8)).toBe(260);
		expect(wpmFromDrag(250, 80)).toBe(350);
		expect(wpmFromDrag(250, -80)).toBe(150);
	});

	it("rounds to the nearest 10 and stays in range", () => {
		expect(wpmFromDrag(250, 11)).toBe(260);
		expect(wpmFromDrag(250, 13)).toBe(270);
		expect(wpmFromDrag(250, -100000)).toBe(100);
		expect(wpmFromDrag(250, 100000)).toBe(1600);
	});
});

describe("Speed Zones", () => {
	it("are study, read and skim, in that order", () => {
		expect(SPEED_ZONES.map((zone) => zone.id)).toEqual([
			"study",
			"read",
			"skim",
		]);
	});

	it("cover the whole range without a gap", () => {
		expect(SPEED_ZONES[0]?.min).toBe(WPM_MIN);
		expect(SPEED_ZONES[SPEED_ZONES.length - 1]?.max).toBe(WPM_MAX);
		for (let i = 1; i < SPEED_ZONES.length; i++) {
			expect(SPEED_ZONES[i]?.min).toBe((SPEED_ZONES[i - 1]?.max ?? 0) + 1);
		}
	});

	it("put the default 250 WPM in read, and call the high speeds skimming", () => {
		expect(zoneFor(250).id).toBe("read");
		expect(zoneFor(199).id).toBe("study");
		expect(zoneFor(200).id).toBe("read");
		expect(zoneFor(349).id).toBe("read");
		expect(zoneFor(350).id).toBe("skim");
		expect(zoneFor(1600).id).toBe("skim");
		expect(zoneFor(100).id).toBe("study");
	});

	it("give each zone a target inside its range", () => {
		for (const zone of SPEED_ZONES) {
			expect(zone.target).toBeGreaterThanOrEqual(zone.min);
			expect(zone.target).toBeLessThanOrEqual(zone.max);
			expect(zoneFor(zone.target).id).toBe(zone.id);
		}
	});
});
