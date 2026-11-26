import type { EngineSettings } from "@speeedy/engine";
import { clampWpm, WPM_MAX, WPM_MIN } from "./wpm.ts";

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
	sentencePause: 2,
	paragraphPause: 1.8,
	commaPause: false,
	asidePause: true,
	speedRamp: false,
	rampTarget: 500,
	rampLength: 30,
	rewindStep: 5,
	countdown: false,
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

/** A number setting's range, its step in the panel and the decimals it keeps. */
export type NumberRange = {
	min: number;
	max: number;
	step: number;
	decimals: number;
};

/** 1.x's ranges: a sentence pause of 1x to 10x, a paragraph pause of 1x to 3x. */
export const SENTENCE_PAUSE_RANGE: NumberRange = {
	min: 1,
	max: 10,
	step: 0.5,
	decimals: 1,
};
export const PARAGRAPH_PAUSE_RANGE: NumberRange = {
	min: 1,
	max: 3,
	step: 0.1,
	decimals: 1,
};
/** The ramp builds to a speed in the reader's own range. */
export const RAMP_TARGET_RANGE: NumberRange = {
	min: WPM_MIN,
	max: WPM_MAX,
	step: 25,
	decimals: 0,
};
export const RAMP_LENGTH_RANGE: NumberRange = {
	min: 10,
	max: 200,
	step: 10,
	decimals: 0,
};
export const REWIND_STEP_RANGE: NumberRange = {
	min: 1,
	max: 50,
	step: 1,
	decimals: 0,
};

/** `value` rounded to the range's decimals and held between its ends. NaN is its minimum. */
export function clampRange(range: NumberRange, value: number): number {
	if (Number.isNaN(value)) return range.min;
	const scale = 10 ** range.decimals;
	const rounded = Math.round(value * scale) / scale;
	return Math.min(Math.max(rounded, range.min), range.max);
}

const PAUSE_KEYS = [
	"punctuationPauses",
	"sentencePause",
	"paragraphPause",
	"commaPause",
	"asidePause",
] as const satisfies readonly (keyof ReaderSettings)[];

/** The four pause rules for the pauses as the reader has them. The switch off means none. */
function pausePatch(settings: ReaderSettings): Partial<EngineSettings> {
	if (!settings.punctuationPauses) {
		return {
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
			commaAsPause: false,
			contextPauseOnClose: false,
		};
	}
	return {
		sentencePauseMultiplier: clampRange(
			SENTENCE_PAUSE_RANGE,
			settings.sentencePause,
		),
		paragraphPauseMultiplier: clampRange(
			PARAGRAPH_PAUSE_RANGE,
			settings.paragraphPause,
		),
		commaAsPause: settings.commaPause,
		contextPauseOnClose: settings.asidePause,
	};
}

/**
 * The ramp, from the set speed to the target. The Engine's ramp is in fractions of the speed
 * (no pacing rule reads the speed, so a change of speed stays instant), so the target is
 * sent as the target over the speed, and goes again when the speed changes.
 */
function rampPatch(settings: ReaderSettings): Partial<EngineSettings> {
	if (!settings.speedRamp) return { rampSpanWords: 0 };
	return {
		rampSpanWords: clampRange(RAMP_LENGTH_RANGE, settings.rampLength),
		rampStart: 1,
		rampEnd:
			clampRange(RAMP_TARGET_RANGE, settings.rampTarget) /
			clampWpm(settings.wpm),
	};
}

/**
 * The engine settings for the reader settings in `change`, and only those: a change of
 * speed does not resend the pauses. An empty change gives an empty patch. `settings` are
 * the reader's settings with `change` already in, for the engine settings that are worked
 * out from several of them: the four pauses, and the ramp from its target and the speed.
 */
export function enginePatch(
	change: Partial<ReaderSettings>,
	settings: ReaderSettings = DEFAULT_READER_SETTINGS,
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
	if (PAUSE_KEYS.some((key) => change[key] !== undefined)) {
		Object.assign(patch, pausePatch(settings));
	}
	const rampChanged =
		change.speedRamp !== undefined ||
		(settings.speedRamp &&
			(change.rampTarget !== undefined ||
				change.rampLength !== undefined ||
				change.wpm !== undefined));
	if (rampChanged) Object.assign(patch, rampPatch(settings));
	return patch;
}

/** The engine settings for a full set of reader settings. */
export const engineSettings = (
	settings: ReaderSettings,
): Partial<EngineSettings> => enginePatch(settings, settings);
