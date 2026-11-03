import { blockText, type Document } from "./document";

/**
 * A place in a Document: a block index plus a character offset into that block's text
 * (UTF-16 code units). Offset equal to the text length means the end of the block.
 * It survives changes to how the text is split into words.
 */
export type Position = {
	block: number;
	offset: number;
};

export function isPosition(value: unknown): value is Position {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	if (
		keys.length !== 2 ||
		!keys.includes("block") ||
		!keys.includes("offset")
	) {
		return false;
	}
	const { block, offset } = value as Record<string, unknown>;
	return (
		typeof block === "number" &&
		Number.isSafeInteger(block) &&
		block >= 0 &&
		typeof offset === "number" &&
		Number.isSafeInteger(offset) &&
		offset >= 0
	);
}

/** Negative when `a` is before `b`, positive when after, 0 when equal. */
export function comparePositions(a: Position, b: Position): number {
	return a.block !== b.block ? a.block - b.block : a.offset - b.offset;
}

const toIndex = (value: number): number =>
	Number.isNaN(value) ? 0 : Math.floor(value);

/**
 * Pull a Position into the Document: the block into range and the offset into that
 * block's text. A block past the end clamps to the end of the last block, a negative
 * one to the start of the first. An empty Document gives the origin.
 */
export function clampPosition(
	position: Position,
	document: Document,
): Position {
	const last = document.blocks.length - 1;
	if (last < 0) return { block: 0, offset: 0 };
	const rawBlock = toIndex(position.block);
	if (rawBlock < 0) return { block: 0, offset: 0 };
	const block = Math.min(rawBlock, last);
	const target = document.blocks[block];
	const length = target ? blockText(target).length : 0;
	const offset =
		rawBlock > last
			? length
			: Math.min(Math.max(toIndex(position.offset), 0), length);
	return { block, offset };
}
