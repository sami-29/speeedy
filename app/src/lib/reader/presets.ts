import { type AudioPrefs, audioPrefsFrom } from "../audio/prefs.ts";
import { isRecord, readJson, writeJson } from "../device-storage.ts";
import { DEFAULT_MODE_ID, type ModeId } from "./modes.ts";
import { readerSettingsFrom } from "./prefs.ts";
import type { ReaderSettings } from "./settings.ts";

/**
 * A reader's own named set of settings: the reader settings, the sound and the Reading Mode.
 * Kept on this device under `speeedy.presets` and never synced. Not to be confused with
 * `READER_PRESETS`, the fixed settings a page opens the reader with.
 */
export type Preset = {
	name: string;
	settings: ReaderSettings;
	sound: AudioPrefs;
	mode: ModeId;
};

export type PresetSnapshot = Omit<Preset, "name">;

export type PresetResult =
	| { ok: true; presets: Preset[] }
	| { ok: false; reason: "blank" | "taken" | "missing" };

export const PRESETS_KEY = "speeedy.presets";
/** A name longer than this is cut: it has to fit a button. */
export const MAX_PRESET_NAME = 40;

const cleanName = (name: string) => name.trim().slice(0, MAX_PRESET_NAME);
const sameName = (a: string, b: string) =>
	a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/** Save under `name`, over any preset with that name in another case. */
export function savePreset(
	presets: readonly Preset[],
	name: string,
	snapshot: PresetSnapshot,
): PresetResult {
	const clean = cleanName(name);
	if (!clean) return { ok: false, reason: "blank" };
	const preset = { name: clean, ...snapshot };
	const at = presets.findIndex((entry) => sameName(entry.name, clean));
	if (at === -1) return { ok: true, presets: [...presets, preset] };
	return { ok: true, presets: presets.with(at, preset) };
}

/** Give a preset a new name. Another preset's name, or a blank one, is refused. */
export function renamePreset(
	presets: readonly Preset[],
	from: string,
	to: string,
): PresetResult {
	const clean = cleanName(to);
	if (!clean) return { ok: false, reason: "blank" };
	const at = presets.findIndex((entry) => sameName(entry.name, from));
	const found = presets[at];
	if (!found) return { ok: false, reason: "missing" };
	if (
		presets.some((entry, index) => index !== at && sameName(entry.name, clean))
	) {
		return { ok: false, reason: "taken" };
	}
	return { ok: true, presets: presets.with(at, { ...found, name: clean }) };
}

export const deletePreset = (
	presets: readonly Preset[],
	name: string,
): Preset[] => presets.filter((entry) => !sameName(entry.name, name));

/** The saved presets. A damaged one is dropped; a sound one has its settings repaired. */
export function loadPresets(
	storage: Pick<Storage, "getItem"> | undefined,
): Preset[] {
	const saved = readJson(storage, PRESETS_KEY);
	if (!Array.isArray(saved)) return [];
	const presets: Preset[] = [];
	for (const entry of saved) {
		if (!isRecord(entry) || typeof entry.name !== "string") continue;
		const name = cleanName(entry.name);
		if (!name || presets.some((preset) => sameName(preset.name, name)))
			continue;
		presets.push({
			name,
			settings: readerSettingsFrom(entry.settings),
			sound: audioPrefsFrom(entry.sound),
			mode: typeof entry.mode === "string" ? entry.mode : DEFAULT_MODE_ID,
		});
	}
	return presets;
}

/** Keep the presets. A blocked or full store is not an error: they last for this visit. */
export function savePresets(
	storage: Pick<Storage, "setItem"> | undefined,
	presets: readonly Preset[],
): void {
	writeJson(storage, PRESETS_KEY, presets);
}
