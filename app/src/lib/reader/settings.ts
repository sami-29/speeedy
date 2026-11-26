import type { EngineSettings } from "@speeedy/engine";
import { clampWpm } from "./wpm.ts";

/** What the reader controls. The engine's settings are derived from these. */
export type ReaderSettings = {
	/** Reading speed, in words per minute. */
	wpm: number;
	/** Words per flash, 1 to 5. */
	chunkSize: number;
	/** Quicken short and common words, slow long ones. */
	smartSpeed: boolean;
	/** Stretch the flash on punctuation. Off holds every pause at none. */
	punctuationPauses: boolean;
	/** How strongly a sentence end holds its word: 1 is the usual pause, 10 ten times it. */
	sentencePause: number;
	/** How much longer the first word of a paragraph stays up: 1 is no longer. */
	paragraphPause: number;
	/** Pause on commas and semicolons like on a sentence end. */
	commaPause: boolean;
	/** A short extra pause on the word that closes a bracket or quotation. */
	asidePause: boolean;
	/** Start each stretch of reading at the set speed and build up to the target speed. */
	speedRamp: boolean;
	/** The speed the ramp builds to, in words per minute. */
	rampTarget: number;
	/** The words the ramp takes to reach the target, counted from Play. */
	rampLength: number;
	/** Words the rewind-by-words key and button go back. */
	rewindStep: number;
	/** Count 3, 2, 1 before RSVP starts. */
	countdown: boolean;
	/** What a paused RSVP shows: the word, its sentence, or the whole text. */
	pauseView: PauseView;
	/** The progress bar under the reading surface. */
	showProgress: boolean;
	/** Take inline citations such as "[4]" or "(Smith, 2020)" out of the next text opened. */
	removeCitations: boolean;
};

export const PAUSE_VIEWS = ["focus", "context", "fulltext"] as const;
export type PauseView = (typeof PAUSE_VIEWS)[number];

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
	wpm: 250,
	chunkSize: 1,
	smartSpeed: false,
	punctuationPauses: true,
	sentencePause: 0,
	paragraphPause: 0,
	commaPause: true,
	asidePause: false,
	speedRamp: false,
	rampTarget: 0,
	rampLength: 0,
	rewindStep: 0,
	countdown: true,
	pauseView: "focus",
	showProgress: true,
	removeCitations: false,
};

/**
 * Settings a page can ask the reader to open with. The focus preset is the ADHD page's: a
 * steady 220 WPM. The one study behind it ran at about 200 WPM; 220 is Speeedy's own default
 * in the 200 to 250 range, not a result of that study.
 */
export const READER_PRESETS = {
	focus: { wpm: 220 },
} as const satisfies Record<string, Partial<ReaderSettings>>;

export type ReaderPreset = keyof typeof READER_PRESETS;

/** The settings with a preset laid over them. No preset leaves them as they are. */
export function withPreset(
	settings: ReaderSettings,
	preset: ReaderPreset | undefined,
): ReaderSettings {
	return preset ? { ...settings, ...READER_PRESETS[preset] } : settings;
}

export const MIN_CHUNK_SIZE = 1;
export const MAX_CHUNK_SIZE = 5;

/** The ramp takes this many words to reach full speed. */
const RAMP_SPAN_WORDS = 30;
/** And starts at this fraction of full speed. */
const RAMP_START = 0.5;

/**
 * The engine settings for the reader settings in `change`, and only those: a change of
 * speed does not resend the pauses. An empty change gives an empty patch.
 */
export function enginePatch(
	change: Partial<ReaderSettings>,
	_settings: ReaderSettings = DEFAULT_READER_SETTINGS,
): Partial<EngineSettings> {
	const patch: Partial<EngineSettings> = {};
	if (change.wpm !== undefined) patch.wpm = clampWpm(change.wpm);
	if (change.chunkSize !== undefined) {
		patch.chunkSize = Math.min(
			Math.max(Math.round(change.chunkSize), MIN_CHUNK_SIZE),
			MAX_CHUNK_SIZE,
		);
	}
	if (change.smartSpeed !== undefined) patch.smartSpeed = change.smartSpeed;
	if (change.punctuationPauses !== undefined) {
		if (change.punctuationPauses) {
			patch.sentencePauseMultiplier = 2;
			patch.paragraphPauseMultiplier = 1.8;
			patch.contextPauseOnClose = true;
		} else {
			patch.sentencePauseMultiplier = 0;
			patch.paragraphPauseMultiplier = 1;
			patch.contextPauseOnClose = false;
		}
	}
	if (change.speedRamp !== undefined) {
		patch.rampSpanWords = change.speedRamp ? RAMP_SPAN_WORDS : 0;
		if (change.speedRamp) patch.rampStart = RAMP_START;
	}
	return patch;
}

/** The engine settings for a full set of reader settings. */
export const engineSettings = (
	settings: ReaderSettings,
): Partial<EngineSettings> => enginePatch(settings, settings);
