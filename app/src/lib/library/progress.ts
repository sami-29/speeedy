import { blockText, type Document, type Position } from "@speeedy/contracts";

/**
 * Turns a Position into the share of the text before it, 0 to 1. The running totals are
 * built once, so each lookup after that is constant time.
 */
export function progressTracker(
	document: Document,
): (position: Position) => number {
	const blocks = document.blocks;
	const lengths = blocks.map((block) => blockText(block).length);
	const before = new Float64Array(blocks.length + 1);
	for (let i = 0; i < blocks.length; i++) {
		before[i + 1] = (before[i] ?? 0) + (lengths[i] ?? 0);
	}
	const total = before[blocks.length] ?? 0;
	return (position) => {
		if (total === 0) return 0;
		if (position.block >= blocks.length) return 1;
		if (position.block < 0) return 0;
		const length = lengths[position.block] ?? 0;
		const offset = Math.min(Math.max(position.offset, 0), length);
		return ((before[position.block] ?? 0) + offset) / total;
	};
}
