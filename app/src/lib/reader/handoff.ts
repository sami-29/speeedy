import type { DocumentSource } from "#lib/library/store.ts";

export type Handoff = { text: string; source: DocumentSource };

// Held in memory only, for one client-side navigation into /reader. It is never written to
// history state or the URL, so the text cannot leave the device; /reader keeps it in the
// on-device Library like any other text, marked with its source.
let pending: Handoff | undefined;

/** Leaves text for /reader to open next. Navigate to /reader right after. */
export function handOff(handoff: Handoff): void {
	pending = handoff;
}

/** Takes the waiting text, if any. A second call returns nothing. */
export function takeHandoff(): Handoff | undefined {
	const handoff = pending;
	pending = undefined;
	return handoff;
}
