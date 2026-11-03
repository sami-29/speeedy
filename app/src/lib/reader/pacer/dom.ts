import type { Block, Document } from "@speeedy/contracts";
import { blockText } from "@speeedy/contracts";
import type { PacerRange } from "./follow.ts";
import {
	expandWindow,
	flatPieces,
	listMarkers,
	listStarts,
	overlapping,
	type Piece,
	pieces,
	type Window,
} from "./pieces.ts";

/** Words the reader has passed, the words in the current Frame, and the words still to come. */
type State = "read" | "now" | "ahead";

/** Where in the pane the current line sits, as fractions of its height. */
const KEEP_FROM = 0.15;
const KEEP_TO = 0.7;
const PLACE_AT = 0.3;
/** The window is renewed when the Frame comes this close to its edge (and it is not the text's edge). */
const WINDOW_MARGIN = 600;

export type PacerLabels = {
	/** The word that marks an image's place. */
	image: string;
};

export type PacerDom = {
	/** Highlight the text of the current Frame and keep it in view. */
	show(range: PacerRange): void;
	/** Scroll the current line into view again, after the pane's size changed. */
	reveal(): void;
	dispose(): void;
};

type Active = {
	index: number;
	/** The elements of the words and spaces inside the window, in order. */
	inner: Piece[];
	elements: HTMLElement[];
	window: Window;
	/** The pieces currently marked as read, and as now, as `[lo, hi)`. */
	lo: number;
	hi: number;
};

function headingTag(level: number): string {
	// The reader's own title is the page's h1, so a document's first level is an h2.
	return `h${Math.min(level + 1, 6)}`;
}

function createBlock(
	block: Block,
	index: number,
	marker: string | null,
	labels: PacerLabels,
): { element: HTMLElement; text: HTMLElement } {
	const make = (tag: string) => {
		const element = document.createElement(tag);
		element.dataset.kind = block.kind;
		element.dataset.block = String(index);
		return element;
	};
	switch (block.kind) {
		case "heading": {
			const element = make(headingTag(block.level));
			element.dataset.level = String(block.level);
			return { element, text: element };
		}
		case "paragraph":
		case "table-text":
		case "caption": {
			const element = make("p");
			return { element, text: element };
		}
		case "list-item": {
			const element = make("div");
			element.setAttribute("role", "listitem");
			element.dataset.depth = String(block.depth);
			element.dataset.marker = marker ?? "•";
			element.style.setProperty("--depth", String(block.depth));
			return { element, text: element };
		}
		case "quote": {
			const element = make("blockquote");
			return { element, text: element };
		}
		case "code": {
			const element = make("pre");
			return { element, text: element };
		}
		case "image-placeholder": {
			const element = make("figure");
			const tag = document.createElement("span");
			tag.className = "tag";
			tag.textContent = labels.image;
			const text = document.createElement("p");
			text.className = "alt";
			element.append(tag, text);
			return { element, text };
		}
	}
}

/** Fill `target` with one node per piece. Words and spaces carry their state; links wrap runs. */
function fill(
	target: HTMLElement,
	list: readonly Piece[],
	window: Window | null,
): HTMLElement[] {
	const fragment = document.createDocumentFragment();
	const elements: HTMLElement[] = [];
	let link: HTMLAnchorElement | null = null;
	for (const piece of list) {
		let parent: Node = fragment;
		if (piece.href) {
			if (!link || link.href !== piece.href) {
				link = document.createElement("a");
				link.href = piece.href;
				link.rel = "noopener noreferrer";
				link.target = "_blank";
				fragment.append(link);
			}
			parent = link;
		} else {
			link = null;
		}
		const styled = piece.emphasis || piece.strong;
		if (
			piece.kind === "flat" &&
			!styled &&
			!(window && piece.end <= window.from)
		) {
			parent.appendChild(document.createTextNode(piece.text));
			continue;
		}
		const span = document.createElement("span");
		span.textContent = piece.text;
		if (piece.emphasis) span.dataset.em = "";
		if (piece.strong) span.dataset.strong = "";
		if (piece.kind === "flat") {
			// Text before the window, in the block being read, has been read.
			if (window && piece.end <= window.from) span.dataset.state = "read";
		} else {
			elements.push(span);
		}
		parent.appendChild(span);
	}
	target.replaceChildren(fragment);
	return elements;
}

/**
 * Draws a Document as running text inside `root` and marks the Frame being read. The
 * Engine drives it through `show`: it writes the state of the few nodes that changed and
 * nothing else, so playing never rebuilds the text.
 *
 * Only the block being read, and only the stretch of it around the reader, is split into
 * words; every other block is a few nodes. A block entirely before the current one is
 * marked as read as a whole.
 */
export function renderPacer(
	pane: HTMLElement,
	root: HTMLElement,
	doc: Document,
	labels: PacerLabels,
): PacerDom {
	const markers = listMarkers(doc.blocks);
	const starts = listStarts(doc.blocks);
	const elements: HTMLElement[] = [];
	const texts: HTMLElement[] = [];
	const fragment = document.createDocumentFragment();
	let list: HTMLElement | null = null;
	for (const [index, block] of doc.blocks.entries()) {
		const { element, text } = createBlock(
			block,
			index,
			markers[index] ?? null,
			labels,
		);
		fill(text, flatPieces(block), null);
		elements.push(element);
		texts.push(text);
		if (block.kind === "list-item") {
			if (starts[index] || !list) {
				list = document.createElement("div");
				list.setAttribute("role", "list");
				list.dataset.list = "";
				fragment.append(list);
			}
			list.append(element);
		} else {
			list = null;
			fragment.append(element);
		}
	}
	root.replaceChildren(fragment);

	let active: Active | undefined;
	let readUntil = 0;
	let reader: PacerRange | undefined;

	const setRead = (until: number) => {
		const to = Math.min(Math.max(until, 0), elements.length);
		for (let i = Math.min(readUntil, to); i < Math.max(readUntil, to); i++) {
			const element = elements[i];
			if (!element) continue;
			if (i < to) element.dataset.read = "";
			else delete element.dataset.read;
		}
		readUntil = to;
	};

	const deactivate = () => {
		if (!active) return;
		const block = doc.blocks[active.index];
		const text = texts[active.index];
		if (block && text) fill(text, flatPieces(block), null);
		active = undefined;
	};

	const activate = (index: number, around: number) => {
		const block = doc.blocks[index];
		const text = texts[index];
		if (!block || !text) return;
		const window = expandWindow(blockText(block), around);
		const cut = pieces(block, window);
		const inner = cut.filter((piece) => piece.kind !== "flat");
		const words = fill(text, cut, window);
		active = { index, inner, elements: words, window, lo: -1, hi: -1 };
	};

	const mark = (item: Active, lo: number, hi: number) => {
		const total = item.elements.length;
		const first = item.lo < 0 ? 0 : Math.min(item.lo, lo);
		const last = item.lo < 0 ? total : Math.max(item.hi, hi);
		for (let i = first; i < Math.min(last, total); i++) {
			const state: State = i < lo ? "read" : i < hi ? "now" : "ahead";
			const element = item.elements[i];
			if (element && element.dataset.state !== state)
				element.dataset.state = state;
		}
		item.lo = lo;
		item.hi = hi;
	};

	const reveal = () => {
		const height = pane.clientHeight;
		if (height === 0) return;
		const first =
			active && active.lo >= 0 ? active.elements[active.lo] : undefined;
		const target =
			(first && first.dataset.state === "now" ? first : undefined) ??
			(reader ? elements[reader.block] : undefined);
		if (!target) return;
		const box = pane.getBoundingClientRect();
		const rect = target.getBoundingClientRect();
		const top = rect.top - box.top;
		const bottom = rect.bottom - box.top;
		if (top < height * KEEP_FROM || bottom > height * KEEP_TO) {
			pane.scrollTop += top - height * PLACE_AT;
		}
	};

	const nearEdge = (item: Active, from: number, to: number) => {
		const length = blockText(doc.blocks[item.index] as Block).length;
		const { window } = item;
		return (
			(window.from > 0 && from < window.from + WINDOW_MARGIN) ||
			(window.to < length && to > window.to - WINDOW_MARGIN) ||
			from < window.from ||
			to > window.to
		);
	};

	return {
		show(range) {
			reader = range;
			if (doc.blocks.length === 0) return;
			const index = Math.min(Math.max(range.block, 0), doc.blocks.length - 1);
			if (
				active &&
				(active.index !== index || nearEdge(active, range.from, range.to))
			) {
				deactivate();
			}
			setRead(index);
			if (!active) activate(index, range.from);
			if (!active) return;
			const { lo, hi } = overlapping(active.inner, range.from, range.to);
			mark(active, lo, hi);
			reveal();
		},
		reveal,
		dispose() {
			active = undefined;
			root.replaceChildren();
		},
	};
}
