import {
	comparePositions,
	type Document,
	type Position,
} from "@speeedy/contracts";
import type { Frame } from "./types";

/** How far back a rewind goes. */
export type BackUnit = "sentence" | "paragraph" | "chapter";

/** Headings at these levels or shallower start a chapter. */
const CHAPTER_HEADING_MAX_LEVEL = 2;

/** A sentence-ending mark, possibly followed by closing quotes or brackets: `.` `?"` `!)`. */
const SENTENCE_END = /[.!?…。！？؟][)\]}"'”’»›]*$/u;

/**
 * Where chapters start: the beginning of every heading of level 1 or 2. A Document with
 * no such heading has no chapters.
 */
export function findChapters(document: Document): Position[] {
	const chapters: Position[] = [];
	document.blocks.forEach((block, index) => {
		if (block.kind === "heading" && block.level <= CHAPTER_HEADING_MAX_LEVEL) {
			chapters.push({ block: index, offset: 0 });
		}
	});
	return chapters;
}

/**
 * Indexes of the Frames a rewind of `unit` can land on, ascending. Sentences end at
 * sentence punctuation (so an abbreviation such as `Dr.` counts as a sentence end) and at
 * every block break; paragraphs are blocks; chapters come from `chapters`.
 */
export function startIndexes(
	frames: readonly Frame[],
	unit: BackUnit,
	chapters: readonly Position[],
): number[] {
	const starts: number[] = [];
	if (unit === "chapter") {
		for (const chapter of chapters) {
			const index = frames.findIndex(
				(frame) => comparePositions(frame.position, chapter) >= 0,
			);
			if (index >= 0 && starts[starts.length - 1] !== index) starts.push(index);
		}
		return starts;
	}
	frames.forEach((frame, index) => {
		const previous = frames[index - 1];
		const newBlock =
			!previous || previous.position.block !== frame.position.block;
		if (newBlock || (unit === "sentence" && SENTENCE_END.test(previous.text))) {
			starts.push(index);
		}
	});
	return starts;
}

/** The Frames of one sentence: the first and last, as indexes. */
export type SentenceBounds = { from: number; to: number };

const endsSentence = (frame: Frame): boolean => SENTENCE_END.test(frame.text);

/**
 * The sentence the Frame at `index` is in, by the same rule as `startIndexes`: a sentence
 * runs from a block start or the Frame after a sentence end, to the next sentence end or the
 * end of the block. An index outside the Timeline counts as its nearest Frame. It walks only
 * the sentence, so it is quick on any Timeline.
 */
export function sentenceBounds(
	frames: readonly Frame[],
	index: number,
): SentenceBounds {
	if (frames.length === 0) return { from: 0, to: 0 };
	const at = Math.min(Math.max(index, 0), frames.length - 1);
	let from = at;
	while (from > 0) {
		const previous = frames[from - 1] as Frame;
		const current = frames[from] as Frame;
		if (
			previous.position.block !== current.position.block ||
			endsSentence(previous)
		) {
			break;
		}
		from--;
	}
	let to = at;
	while (to < frames.length - 1) {
		const current = frames[to] as Frame;
		const next = frames[to + 1] as Frame;
		if (
			current.position.block !== next.position.block ||
			endsSentence(current)
		) {
			break;
		}
		to++;
	}
	return { from, to };
}

/**
 * The Frame to land on when going back from `index`: the start of the unit the Cursor is
 * inside, or, if it already sits on a start, the start before it. Never before Frame 0.
 */
export function backTarget(starts: readonly number[], index: number): number {
	let before = 0;
	for (const start of starts) {
		if (start >= index) break;
		before = start;
	}
	return before;
}
