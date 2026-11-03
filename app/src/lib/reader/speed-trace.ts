/** How many stretches the progress chart splits a text into. */
export const TRACE_BUCKETS = 48;

/** The stretch, of `buckets` equal ones, that holds a share of the text (0 to 1). */
export function bucketFor(share: number, buckets: number): number {
	if (Number.isNaN(share)) return 0;
	return Math.min(Math.max(Math.floor(share * buckets), 0), buckets - 1);
}

/** The speed each stretch of the open text was last read at, for the progress chart. */
export type SpeedTrace = {
	/** Note a share of the text read at `wpm`. True when that changed the trace. */
	record(share: number, wpm: number): boolean;
	/** The speed of each stretch, or null where nothing has been read. A copy. */
	values(): (number | null)[];
	reset(): void;
};

/**
 * Remembers, for a text split into equal stretches, the speed each stretch was last read
 * at. Reading a stretch again replaces its speed. Nothing here is stored: the trace lasts
 * as long as the reader has the text open.
 */
export function createSpeedTrace(buckets: number = TRACE_BUCKETS): SpeedTrace {
	const speeds: (number | null)[] = new Array(buckets).fill(null);
	return {
		record(share, wpm) {
			const at = bucketFor(share, buckets);
			if (speeds[at] === wpm) return false;
			speeds[at] = wpm;
			return true;
		},
		values: () => [...speeds],
		reset() {
			speeds.fill(null);
		},
	};
}
