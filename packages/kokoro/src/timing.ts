import type { PhonemeToken } from "./g2p";

export type Span = { start: number; end: number };

/**
 * Kokoro's `KPipeline.join_timestamps`, ported: token start and end times in seconds from the
 * model's per-phoneme durations (frames of 600 samples at 24 kHz, counted in half-frames so a
 * space can be split between its neighbours). `durations` includes the two pads.
 *
 * A token past the end of the durations gets a zero-length span at the last end time, so the
 * result always has one span per token.
 */
export function joinTimestamps(
	tokens: readonly PhonemeToken[],
	durations: ArrayLike<number>,
): Span[] {
	const d = (k: number) => durations[k] ?? 0;
	const spans: Span[] = [];
	let left = 2 * Math.max(0, d(0) - 3);
	let right = left;
	let last = left / 80;
	let i = 1;
	let done = durations.length < 3;
	for (const token of tokens) {
		const j = i + token.phonemes.length;
		if (done || i >= durations.length - 1 || j >= durations.length) {
			done = true;
			spans.push({ start: last, end: last });
			continue;
		}
		const start = left / 80;
		const space = token.whitespace ? d(j) : 0;
		let sum = 0;
		for (let k = i; k < j; k++) sum += d(k);
		left = right + 2 * sum + space;
		last = left / 80;
		spans.push({ start, end: last });
		right = left + space;
		i = j + (token.whitespace ? 1 : 0);
	}
	return spans;
}
