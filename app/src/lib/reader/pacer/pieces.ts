import { type Block, blockText, type Span } from "@speeedy/contracts";

/**
 * A stretch of a block's text that Pacer draws as one node. Pieces tile the text: each
 * starts where the last one ended, so joining them gives the text back exactly. Offsets
 * count UTF-16 code units, the same unit as a Position's.
 *
 * Inside the window being read, every word and every run of whitespace is a piece of its
 * own, which the highlight can mark one by one. Outside it the text is cut only where an
 * inline span starts or ends, so a very long block stays a handful of nodes.
 */
export type Piece = {
	start: number;
	end: number;
	text: string;
	kind: "word" | "space" | "flat";
	emphasis: boolean;
	strong: boolean;
	/** The address of a link over this piece, or null. Only http, https and mailto get here. */
	href: string | null;
};

/** The part of a block's text that is split into words, as `[from, to)` offsets. */
export type Window = { from: number; to: number };

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * The address to link to, or null. The Document model leaves the check to whoever renders,
 * so only an absolute http, https or mailto address passes: never `javascript:`, `data:`
 * or `file:`, and nothing relative, which has no page to be relative to.
 */
export function safeHref(href: string): string | null {
	try {
		const url = new URL(href.trim());
		return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

const isSpace = (char: string | undefined): boolean =>
	char !== undefined && /\s/u.test(char);

function spansOf(block: Block): readonly Span[] {
	return block.kind === "image-placeholder" ? [] : block.spans;
}

/**
 * The block's text as pieces. Without a window every word is a piece; with one, only the
 * text inside it is split (see `Piece`).
 */
export function pieces(block: Block, window?: Window): Piece[] {
	const text = blockText(block);
	const length = text.length;
	if (length === 0) return [];
	const spans = [...spansOf(block)].sort((a, b) => a.start - b.start);
	const inner = window
		? {
				from: Math.min(Math.max(window.from, 0), length),
				to: Math.min(Math.max(window.to, 0), length),
			}
		: { from: 0, to: length };

	const cuts = new Set<number>([0, length, inner.from, inner.to]);
	for (const span of spans) {
		cuts.add(Math.min(Math.max(span.start, 0), length));
		cuts.add(Math.min(Math.max(span.end, 0), length));
	}
	for (let i = inner.from + 1; i < inner.to; i++) {
		if (isSpace(text[i]) !== isSpace(text[i - 1])) cuts.add(i);
	}
	const points = [...cuts].sort((a, b) => a - b);

	const result: Piece[] = [];
	let next = 0;
	let active: Span[] = [];
	for (let i = 0; i + 1 < points.length; i++) {
		const start = points[i] as number;
		const end = points[i + 1] as number;
		if (start === end) continue;
		while (next < spans.length && (spans[next] as Span).start <= start) {
			active.push(spans[next] as Span);
			next++;
		}
		active = active.filter((span) => span.end > start);
		let emphasis = false;
		let strong = false;
		let href: string | null = null;
		for (const span of active) {
			if (span.kind === "emphasis") emphasis = true;
			else if (span.kind === "strong") strong = true;
			else href = safeHref(span.href) ?? href;
		}
		const slice = text.slice(start, end);
		const inside = start >= inner.from && end <= inner.to;
		result.push({
			start,
			end,
			text: slice,
			kind: !inside ? "flat" : isSpace(slice[0]) ? "space" : "word",
			emphasis,
			strong,
			href,
		});
	}
	return result;
}

const NO_WORDS: Window = { from: 0, to: 0 };

/** The block's text cut only at span edges: nothing in it is split into words. */
export const flatPieces = (block: Block): Piece[] => pieces(block, NO_WORDS);

/** How far either side of the reader's place the text is split into words. */
export const WINDOW_RADIUS = 2500;

/**
 * A window of about `radius` characters either side of `around`, widened to start and end
 * between words, so no word is cut in half.
 */
export function expandWindow(
	text: string,
	around: number,
	radius: number = WINDOW_RADIUS,
): Window {
	const length = text.length;
	const centre = Math.min(Math.max(around, 0), length);
	let from = Math.max(centre - radius, 0);
	while (from > 0 && !isSpace(text[from - 1])) from--;
	let to = Math.min(centre + radius, length);
	while (to < length && !isSpace(text[to])) to++;
	return { from, to };
}

/**
 * The pieces a range touches, as `[lo, hi)` indexes into a list ordered by position. Every
 * piece before `lo` has been read. A range with no width touches nothing.
 */
export function overlapping(
	list: readonly Piece[],
	from: number,
	to: number,
): { lo: number; hi: number } {
	let low = 0;
	let high = list.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((list[middle] as Piece).end > from) high = middle;
		else low = middle + 1;
	}
	const lo = low;
	if (to <= from) return { lo, hi: lo };
	low = lo;
	high = list.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((list[middle] as Piece).start >= to) high = middle;
		else low = middle + 1;
	}
	return { lo, hi: low };
}

/**
 * The marker in front of each list item: a bullet, or its number among the items of its
 * level. Blocks that are not list items get null. A list starts its count again after any
 * other block and after a bullet at the same level.
 */
export function listMarkers(blocks: readonly Block[]): (string | null)[] {
	const counters: number[] = [];
	return blocks.map((block) => {
		if (block.kind !== "list-item") {
			counters.length = 0;
			return null;
		}
		const depth = block.depth;
		counters.length = depth + 1;
		for (let i = 0; i <= depth; i++) counters[i] ??= 0;
		if (!block.ordered) {
			counters[depth] = 0;
			return "•";
		}
		counters[depth] = (counters[depth] as number) + 1;
		return `${counters[depth]}.`;
	});
}

/**
 * Which blocks begin a list: the first item after any other block, and the first item at
 * the top level where a bullet list turns into a numbered one or back.
 */
export function listStarts(blocks: readonly Block[]): boolean[] {
	let previous: Block | undefined;
	let topOrdered: boolean | undefined;
	return blocks.map((block) => {
		const before = previous;
		previous = block;
		if (block.kind !== "list-item") {
			topOrdered = undefined;
			return false;
		}
		let starts = before?.kind !== "list-item";
		if (block.depth === 0) {
			if (topOrdered !== undefined && topOrdered !== block.ordered) {
				starts = true;
			}
			topOrdered = block.ordered;
		}
		return starts;
	});
}
