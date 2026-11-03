import type { DocumentSource } from "#lib/library/store.ts";

/**
 * What one route leaves for /reader: pasted or shared text, or a file, and where it came
 * from. A Share Link sets `source: "share"` (the reader marks it and waits for Play); the
 * front door's paste or drop sets `source: "own"`.
 */
export type Handoff = { source: DocumentSource } & (
	| { text: string }
	| { file: File }
);

// Held in memory only, for one client-side navigation into /reader. It is never written to
// history state or the URL, so the text cannot leave the device; /reader keeps it in the
// on-device Library like any other text, marked with its source.
let pending: Handoff | undefined;

/** Leaves text or a file for /reader to open next. Navigate to /reader right after. */
export function handOff(handoff: Handoff): void {
	pending = handoff;
}

/** Takes the waiting hand-off, if any. A second call returns nothing. */
export function takeHandoff(): Handoff | undefined {
	const handoff = pending;
	pending = undefined;
	return handoff;
}
