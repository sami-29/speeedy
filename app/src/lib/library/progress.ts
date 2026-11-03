import { blockText, type Document, type Position } from "@speeedy/contracts";

/** Each block's text length, and the running total of characters before each block. */
function measure(document: Document) {
	const blocks = document.blocks;
	const lengths = blocks.map((block) => blockText(block).length);
	const before = new Float64Array(blocks.length + 1);
	for (let i = 0; i < blocks.length; i++) {
		before[i + 1] = (before[i] ?? 0) + (lengths[i] ?? 0);
	}
	return { blocks, lengths, before, total: before[blocks.length] ?? 0 };
}

/**
 * Turns a Position into the share of the text before it, 0 to 1. The running totals are
 * built once, so each lookup after that is constant time.
 */
export function progressTracker(
	document: Document,
): (position: Position) => number {
	const { blocks, lengths, before, total } = measure(document);
	return (position) => {
		if (total === 0) return 0;
		if (position.block >= blocks.length) return 1;
		if (position.block < 0) return 0;
		const length = lengths[position.block] ?? 0;
		const offset = Math.min(Math.max(position.offset, 0), length);
		return ((before[position.block] ?? 0) + offset) / total;
	};
}

/**
 * The inverse of `progressTracker`: turns a share of the text, 0 to 1, into the Position
 * that holds it. The running totals are built once, and each lookup is a binary search.
 * A share past either end clamps to it; blocks with no text are never chosen.
 */
export function progressSeeker(
	document: Document,
): (share: number) => Position {
	const { lengths, before, total } = measure(document);
	const withText = lengths.flatMap((length, index) =>
		length > 0 ? [index] : [],
	);
	return (share) => {
		if (total === 0) return { block: 0, offset: 0 };
		const clamped = Number.isNaN(share) ? 0 : Math.min(Math.max(share, 0), 1);
		const target = clamped * total;
		// The last block with text that starts at or before the target.
		let low = 0;
		let high = withText.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if ((before[withText[middle] ?? 0] ?? 0) <= target) low = middle;
			else high = middle - 1;
		}
		const block = withText[low] ?? 0;
		const offset = Math.min(
			Math.max(Math.round(target - (before[block] ?? 0)), 0),
			lengths[block] ?? 0,
		);
		return { block, offset };
	};
}
