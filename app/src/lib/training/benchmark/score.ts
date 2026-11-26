import { READING_SPEED } from "../../learn/articles.ts";

/** How many words a text has: runs between spaces that hold at least one letter or digit. */
export function countWords(text: string): number {
	return text.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece))
		.length;
}

/** The shortest read the timer will believe, in milliseconds: faster reads count as this long. */
export const MIN_READING_MS = 6000;

/** Words per minute for a passage of `words` words read in `elapsedMs`. */
export function wordsPerMinute(words: number, elapsedMs: number): number {
	const minutes = Math.max(elapsedMs, MIN_READING_MS) / 60_000;
	return Math.round(words / minutes);
}

/** The share of questions answered right, as a whole percentage. */
export function comprehensionScore(correct: number, total: number): number {
	return total > 0 ? Math.round((correct / total) * 100) : 0;
}

export type RangeStanding = "below" | "within" | "above";

/** Where a speed sits against the range most adults read non-fiction in. */
export function rangeStanding(wpm: number): RangeStanding {
	if (wpm < READING_SPEED.rangeLow) return "below";
	if (wpm > READING_SPEED.rangeHigh) return "above";
	return "within";
}
