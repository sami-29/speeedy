import { createRegistry } from "@speeedy/contracts";
import type { Timeline } from "@speeedy/engine";
import type { Component } from "svelte";

/** What every Reading Mode view receives from the reader shell. */
export type ModeProps = {
	timeline: Timeline;
	wpm: number;
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
