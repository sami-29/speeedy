import { isRecord, readJson, writeJson } from "../device-storage.ts";
import {
	clampRange,
	DEFAULT_READER_SETTINGS,
	MAX_CHUNK_SIZE,
	MIN_CHUNK_SIZE,
	PARAGRAPH_PAUSE_RANGE,
	PAUSE_VIEWS,
	RAMP_LENGTH_RANGE,
	RAMP_TARGET_RANGE,
	REWIND_STEP_RANGE,
	type ReaderSettings,
	SENTENCE_PAUSE_RANGE,
} from "./settings.ts";
import { clampWpm } from "./wpm.ts";

/**
 * The reader settings, remembered on this device. Numbers, switches and ids, never text;
 * not a synced setting, so they never leave the device.
 */
export const READER_PREFS_KEY = "speeedy.reader";

const SWITCHES = [
	"smartSpeed",
	"punctuationPauses",
	"commaPause",
	"asidePause",
	"speedRamp",
	"countdown",
	"showProgress",
	"removeCitations",
] as const;

/** The numbers a reader sets, each held to its range. */
const NUMBERS = [
	["sentencePause", SENTENCE_PAUSE_RANGE],
	["paragraphPause", PARAGRAPH_PAUSE_RANGE],
	["rampTarget", RAMP_TARGET_RANGE],
	["rampLength", RAMP_LENGTH_RANGE],
	["rewindStep", REWIND_STEP_RANGE],
] as const;

/** A full set of settings from anything: what is sound is kept, the rest is the default. */
export function readerSettingsFrom(value: unknown): ReaderSettings {
	if (!isRecord(value)) return { ...DEFAULT_READER_SETTINGS };
	const settings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };
	if (typeof value.wpm === "number" && Number.isFinite(value.wpm)) {
		settings.wpm = clampWpm(value.wpm);
	}
	if (typeof value.chunkSize === "number" && Number.isFinite(value.chunkSize)) {
		settings.chunkSize = Math.min(
			Math.max(Math.round(value.chunkSize), MIN_CHUNK_SIZE),
			MAX_CHUNK_SIZE,
		);
	}
	for (const key of SWITCHES) {
		if (typeof value[key] === "boolean") settings[key] = value[key];
	}
	for (const [key, range] of NUMBERS) {
		const stored = value[key];
		if (typeof stored === "number" && Number.isFinite(stored)) {
			settings[key] = clampRange(range, stored);
		}
	}
	const view = PAUSE_VIEWS.find((entry) => entry === value.pauseView);
	if (view) settings.pauseView = view;
	return settings;
}

/** The saved settings, or the defaults for anything missing, damaged or out of reach. */
export function loadReaderSettings(
	storage: Pick<Storage, "getItem"> | undefined,
): ReaderSettings {
	return readerSettingsFrom(readJson(storage, READER_PREFS_KEY));
}

/** Keep the settings. A blocked or full store is not an error: they last for this visit. */
export function saveReaderSettings(
	storage: Pick<Storage, "setItem"> | undefined,
	settings: ReaderSettings,
): void {
	writeJson(storage, READER_PREFS_KEY, settings);
}
