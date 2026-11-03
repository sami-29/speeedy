import { createRegistry, type Position } from "@speeedy/contracts";
import type { Timeline } from "@speeedy/engine";
import type { Component } from "svelte";

/** What every Reading Mode view receives from the reader shell. */
export type ModeProps = {
	timeline: Timeline;
	wpm: number;
	/** Start playing at once. False shows the first word and waits for Play (shared text). */
	autoplay?: boolean;
	/** Where to start reading. Without it the mode starts at the first Frame. */
	startAt?: Position;
	/** Told where the reader is: on each Frame, and `final` on a pause or the end. */
	onposition?: (position: Position, final: boolean) => void;
};

/** A mode's view is loaded on demand, so the registry carries no component code. */
export type ModeView = () => Promise<{ default: Component<ModeProps> }>;

/** The Reading Modes the reader shell can open. Pacer and Listen register here later. */
export const readerModes = createRegistry<ModeView>();

readerModes.register({
	kind: "mode",
	id: "rsvp",
	analyticsValue: "rsvp",
	view: () => import("./RsvpView.svelte"),
	pacingRules: ["base-wpm", "punctuation-pauses"],
	clock: "timer",
	settingsUsed: ["wpm"],
});
