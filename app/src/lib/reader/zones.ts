import { WPM_MAX, WPM_MIN } from "./wpm.ts";

export type SpeedZoneId = "study" | "read" | "skim";

/** A named WPM range that says what comprehension to expect at that pace. */
export type SpeedZone = {
	id: SpeedZoneId;
	/** Lowest speed in the zone. */
	min: number;
	/** Highest speed in the zone. */
	max: number;
	/** The speed picking the zone sets. */
	target: number;
};

/**
 * The three Speed Zones. Read is the 200 to 350 range where most readers keep
 * comprehension (Rayner et al. 2016); above it the reader is skimming, so the copy
 * says so.
 */
export const SPEED_ZONES: readonly SpeedZone[] = [
	{ id: "study", min: WPM_MIN, max: 199, target: 180 },
	{ id: "read", min: 200, max: 349, target: 250 },
	{ id: "skim", min: 350, max: WPM_MAX, target: 400 },
];

/** The zone a speed falls in. */
export function zoneFor(wpm: number): SpeedZone {
	return (
		SPEED_ZONES.find((zone) => wpm >= zone.min && wpm <= zone.max) ??
		(wpm < WPM_MIN
			? (SPEED_ZONES[0] as SpeedZone)
			: (SPEED_ZONES[SPEED_ZONES.length - 1] as SpeedZone))
	);
}

/** A Speed Zone as a band of a speed chart. */
export type ZoneBand = {
	id: SpeedZoneId;
	min: number;
	/** The first speed above the band; the last band has none. */
	upTo: number | null;
};

/**
 * The Speed Zones as bands for a chart. Charts are drawn from 0, so the first band starts
 * there; each band ends where the next begins and the last has no end. The stats page and
 * the reader's progress chart both draw these, so they never disagree with the reader.
 */
export const ZONE_BANDS: readonly ZoneBand[] = SPEED_ZONES.map((zone, i) => ({
	id: zone.id,
	min: i === 0 ? 0 : zone.min,
	upTo: i === SPEED_ZONES.length - 1 ? null : zone.max + 1,
}));

/** The top of a speed chart: room above the fastest speed, never below 500 WPM. */
export const chartTop = (fastest: number): number =>
	Math.max(500, Math.ceil(fastest / 100) * 100 + 50);

/** A band as shares of the chart's height, measured from the bottom. */
export const bandBox = (
	band: Pick<ZoneBand, "min" | "upTo">,
	top: number,
): { bottom: number; height: number } => ({
	bottom: (band.min / top) * 100,
	height: (((band.upTo ?? top) - band.min) / top) * 100,
});
