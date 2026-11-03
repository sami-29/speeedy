import {
	blockText,
	comparePositions,
	type Document,
	type Position,
} from "@speeedy/contracts";
import { findChapters } from "@speeedy/engine";

/** A chapter of the open text: a heading, and where it starts. */
export type Chapter = {
	title: string;
	position: Position;
};

/**
 * The chapters of a Document, in reading order: the headings the Engine counts as chapters
 * (see `findChapters`), each with its title. A heading with no text is named by its number.
 */
export function chapterList(document: Document): Chapter[] {
	return findChapters(document).map((position, i) => {
		const block = document.blocks[position.block];
		const title = block ? blockText(block).replace(/\s+/g, " ").trim() : "";
		return { title: title === "" ? String(i + 1) : title, position };
	});
}

/** Index of the chapter that holds `position`, or -1 before the first chapter. */
export function chapterAt(
	chapters: readonly Chapter[],
	position: Position,
): number {
	let low = -1;
	let high = chapters.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (
			comparePositions((chapters[middle] as Chapter).position, position) <= 0
		) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return low;
}

/** One arrow key on the progress slider, as a share of the text. */
export const PROGRESS_STEP = 0.01;
/** Shift with an arrow, or a Page key. */
export const PROGRESS_BIG_STEP = 0.1;

const clampShare = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * The share of the text a key sets on the progress slider, or undefined for a key it does
 * not handle. These are the keys of the ARIA slider pattern: arrows, Page keys, Home, End.
 */
export function progressForKey(
	event: { key: string; shiftKey: boolean },
	current: number,
): number | undefined {
	const step = event.shiftKey ? PROGRESS_BIG_STEP : PROGRESS_STEP;
	switch (event.key) {
		case "ArrowRight":
		case "ArrowUp":
			return clampShare(current + step);
		case "ArrowLeft":
		case "ArrowDown":
			return clampShare(current - step);
		case "PageUp":
			return clampShare(current + PROGRESS_BIG_STEP);
		case "PageDown":
			return clampShare(current - PROGRESS_BIG_STEP);
		case "Home":
			return 0;
		case "End":
			return 1;
		default:
			return undefined;
	}
}

/** The share of the text under the pointer, for a bar that starts at `left` and is `width` wide. */
export function progressFromPointer(
	clientX: number,
	left: number,
	width: number,
): number {
	if (!(width > 0)) return 0;
	return clampShare((clientX - left) / width);
}
