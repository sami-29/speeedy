import {
	type ClockKind,
	createRegistry,
	type Document,
} from "@speeedy/contracts";
import type { Clock, Engine } from "@speeedy/engine";
import type { Component } from "svelte";
import type { PauseView } from "./settings.ts";

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
	/** What a mode that shows one word at a time shows while paused (RSVP). */
	pauseView?: PauseView;
	/** The number on show while the start countdown runs, or null (RSVP). */
	count?: number | null;
};

/**
 * A Reading Mode's id in the registry. Modes register at runtime, so the registry types it as
 * a string; this names what the string is.
 */
export type ModeId = string;

/** The Reading Mode the reader opens in, and the fallback for a preset with no mode. */
export const DEFAULT_MODE_ID: ModeId = "rsvp";

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
		"sentencePause",
		"paragraphPause",
		"commaPause",
		"asidePause",
		"speedRamp",
		"rampTarget",
		"rampLength",
		"rewindStep",
		"countdown",
		"pauseView",
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
		"sentencePause",
		"paragraphPause",
		"commaPause",
		"asidePause",
		"speedRamp",
		"rampTarget",
		"rampLength",
		"rewindStep",
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
