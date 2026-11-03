import { createRegistry } from "@speeedy/contracts";
import type { Engine } from "@speeedy/engine";
import type { Component } from "svelte";

/** What every Reading Mode view receives from the reader shell. */
export type ModeProps = {
	/** The Engine the shell controls. The view shows its Frames and starts playing it. */
	engine: Engine;
	/** Start playing at once. False shows the first word and waits for Play (shared text). */
	autoplay?: boolean;
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
	pacingRules: ["base-wpm", "smart-speed", "punctuation-pauses", "ramp"],
	clock: "timer",
	settingsUsed: [
		"wpm",
		"chunkSize",
		"smartSpeed",
		"punctuationPauses",
		"speedRamp",
	],
});
