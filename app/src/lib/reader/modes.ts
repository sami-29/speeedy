import {
	type ClockKind,
	createRegistry,
	type Document,
} from "@speeedy/contracts";
import type { Clock, Engine } from "@speeedy/engine";
import type { Component } from "svelte";

/** What every Reading Mode view receives from the reader shell. */
export type ModeProps = {
	/** The Engine the shell controls. The view shows its Frames and starts playing it. */
	engine: Engine;
	/** The text being read, for the modes that show it (Pacer). */
	doc: Document;
	/** Start playing at once. False shows the first word and waits for Play (shared text). */
	autoplay?: boolean;
	/**
	 * The Clock this mode declared. The Engine runs on it while the mode is open; a mode on
	 * the timer Clock has no use for it, but Listen pushes the speech Clock with what it hears.
	 */
	clock: Clock;
	/** BCP 47 tag of the text, `und` when it is not known. */
	language?: string;
};

/** A mode's view is loaded on demand, so the registry carries no component code. */
export type ModeView = () => Promise<{ default: Component<ModeProps> }>;

/** The Reading Modes the reader shell can open. */
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

readerModes.register({
	kind: "mode",
	id: "pacer",
	analyticsValue: "pacer",
	view: () => import("./PacerView.svelte"),
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

readerModes.register({
	kind: "mode",
	id: "listen",
	analyticsValue: "listen",
	view: () => import("./ListenView.svelte"),
	// The voice sets the pace, not the reader's speed, so no pacing rule shapes its time.
	pacingRules: [],
	clock: "web-speech",
	settingsUsed: ["voice", "voiceRate"],
});

/**
 * A visual mode pauses when its tab is hidden, so the reader does not lose text they never
 * saw. A mode on the audio or speech Clock (Listen) keeps playing.
 */
export const pausesWhenHidden = (mode: { clock: ClockKind }): boolean =>
	mode.clock === "timer";
