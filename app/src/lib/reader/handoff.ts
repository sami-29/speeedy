/** Where a document came from. Session analytics carry it as an enum (own, demo, share). */
export type ReadingSource = "own" | "demo" | "share";

export type Handoff = { text: string; source: ReadingSource };

// Held in memory only, for one client-side navigation into /reader. It is never written to
// storage, history state or the URL, so the text cannot outlive the page or leave the device.
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
