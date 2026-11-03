import type { ReaderSource } from "./open.ts";

// Pasted text and chosen files go from a public page to /reader through this one slot in
// memory. Nothing is written to the URL, to storage or to the network, and a reload of
// /reader starts empty. The reader takes the source once, when it opens.
let pending: ReaderSource | undefined;

/** Leaves a source for the reader to pick up. A later call replaces an earlier one. */
export function handOff(source: ReaderSource): void {
	pending = source;
}

/** Returns the waiting source, if any, and clears the slot. */
export function takeHandOff(): ReaderSource | undefined {
	const source = pending;
	pending = undefined;
	return source;
}
