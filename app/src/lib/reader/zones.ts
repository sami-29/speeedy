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
