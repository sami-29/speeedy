/** How many words a text has: runs between spaces that hold at least one letter or digit. */
export function countWords(_text: string): number {
	throw new Error("not implemented");
}

/** The shortest read the timer will believe, in milliseconds: faster reads count as this long. */
export const MIN_READING_MS = 6000;

/** Words per minute for a passage of `words` words read in `elapsedMs`. */
export function wordsPerMinute(_words: number, _elapsedMs: number): number {
	throw new Error("not implemented");
}

/** The share of questions answered right, as a whole percentage. */
export function comprehensionScore(_correct: number, _total: number): number {
	throw new Error("not implemented");
}

export type RangeStanding = "below" | "within" | "above";

/** Where a speed sits against the range most adults read non-fiction in. */
export function rangeStanding(_wpm: number): RangeStanding {
	throw new Error("not implemented");
}
