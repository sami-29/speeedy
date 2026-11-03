import { describe, expect, it } from "vitest";
import {
	bandBox,
	chartTop,
	SPEED_ZONES,
	ZONE_BANDS,
} from "../src/lib/reader/zones.ts";

describe("Speed Zone bands", () => {
	it("are the reader's Speed Zones, drawn from 0 with the last open-ended", () => {
		expect(ZONE_BANDS.map((band) => band.id)).toEqual(
			SPEED_ZONES.map((zone) => zone.id),
		);
		expect(ZONE_BANDS.map((band) => [band.min, band.upTo])).toEqual([
			[0, 200],
			[200, 350],
			[350, null],
		]);
	});
});

describe("the top of a speed chart", () => {
	it("is never below 500 WPM", () => {
		expect(chartTop(0)).toBe(500);
		expect(chartTop(250)).toBe(500);
		expect(chartTop(400)).toBe(500);
	});

	it("leaves room above the fastest speed", () => {
		expect(chartTop(450)).toBe(550);
		expect(chartTop(900)).toBe(950);
	});
});

describe("a band's box in the chart", () => {
	it("is measured from the bottom as a share of the top", () => {
		expect(bandBox({ min: 0, upTo: 200 }, 500)).toEqual({
			bottom: 0,
			height: 40,
		});
		expect(bandBox({ min: 200, upTo: 350 }, 500)).toEqual({
			bottom: 40,
			height: 30,
		});
	});

	it("runs to the top when the band has no end", () => {
		expect(bandBox({ min: 350, upTo: null }, 500)).toEqual({
			bottom: 70,
			height: 30,
		});
	});
});
