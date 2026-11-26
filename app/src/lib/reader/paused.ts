import type { Document } from "@speeedy/contracts";

/** Where the paused word sits: its block and its character range there. */
export type PausedPlace = { block: number; from: number; to: number };

/** The sentence around the paused word, split so the word can be marked. */
export type PausedSentence = { before: string; now: string; after: string };

/** A sentence ends at . ! or ?, with any closing quote or bracket, before a space or the end. */
const SENTENCE_END = /[.!?]+["'’”)\]]*(?=\s|$)/g;

/**
 * The sentence a paused reader sees in the context view: from the end of the sentence
 * before the word to the end of the word's own. A block with no sentence breaks, such as a
 * heading, is one sentence. Null for a place outside the text or a block with no text.
 */
export function pausedSentence(
	doc: Document,
	place: PausedPlace,
): PausedSentence | null {
	const block = doc.blocks[place.block];
	if (!block || !("text" in block)) return null;
	const { text } = block;
	let start = 0;
	let end = text.length;
	for (const match of text.matchAll(SENTENCE_END)) {
		const stop = match.index + match[0].length;
		if (stop <= place.from) {
			start = stop;
		} else if (stop >= place.to) {
			end = stop;
			break;
		}
	}
	while (start < place.from && /\s/.test(text.charAt(start))) start++;
	return {
		before: text.slice(start, place.from),
		now: text.slice(place.from, place.to),
		after: text.slice(place.to, end),
	};
}
