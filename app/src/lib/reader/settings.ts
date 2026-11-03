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
	/** Stretch the flash on sentence ends and at paragraph starts. */
	punctuationPauses: boolean;
	/** Start each stretch of reading slowly and build up to full speed. */
	speedRamp: boolean;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
	wpm: 250,
	chunkSize: 1,
	smartSpeed: false,
	punctuationPauses: true,
	speedRamp: false,
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
): Partial<EngineSettings> => enginePatch(settings);
