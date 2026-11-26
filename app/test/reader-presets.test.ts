import { SYNCED_SETTINGS } from "@speeedy/sync";
import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIO_PREFS } from "../src/lib/audio/prefs.ts";
import {
	deletePreset,
	loadPresets,
	PRESETS_KEY,
	type Preset,
	type PresetSnapshot,
	renamePreset,
	savePreset,
	savePresets,
} from "../src/lib/reader/presets.ts";
import { DEFAULT_READER_SETTINGS } from "../src/lib/reader/settings.ts";
import { memoryStorage as memory } from "./fake-audio.ts";

const fast: PresetSnapshot = {
	settings: { ...DEFAULT_READER_SETTINGS, wpm: 500, chunkSize: 2 },
	sound: { ...DEFAULT_AUDIO_PREFS, ambient: "brown" as const, tickPitch: 1.5 },
	mode: "pacer",
};

const slow: PresetSnapshot = {
	settings: {
		...DEFAULT_READER_SETTINGS,
		wpm: 180,
		pauseView: "context" as const,
	},
	sound: DEFAULT_AUDIO_PREFS,
	mode: "rsvp",
};

function saved(list: Preset[], name: string, snapshot = fast): Preset[] {
	const result = savePreset(list, name, snapshot);
	if (!result.ok) throw new Error(result.reason);
	return result.presets;
}

describe("named presets", () => {
	it("save a full set of settings under a name", () => {
		const list = saved([], "  Skim news  ");
		expect(list).toEqual([{ name: "Skim news", ...fast }]);
	});

	it("save over a preset with the same name, whatever its case", () => {
		const list = saved(saved([], "Study"), "study", slow);
		expect(list).toEqual([{ name: "study", ...slow }]);
	});

	it("refuse a blank name", () => {
		expect(savePreset([], "   ", fast)).toEqual({ ok: false, reason: "blank" });
	});

	it("rename, but never onto another preset's name", () => {
		const list = saved(saved([], "Study", slow), "Skim");
		const renamed = renamePreset(list, "Study", "Deep work");
		expect(renamed.ok && renamed.presets.map((preset) => preset.name)).toEqual([
			"Deep work",
			"Skim",
		]);
		expect(renamePreset(list, "Study", "SKIM")).toEqual({
			ok: false,
			reason: "taken",
		});
		expect(renamePreset(list, "Study", " ")).toEqual({
			ok: false,
			reason: "blank",
		});
		expect(renamePreset(list, "Gone", "New")).toEqual({
			ok: false,
			reason: "missing",
		});
	});

	it("keep their settings when renamed to a new case of the same name", () => {
		const renamed = renamePreset(saved([], "study", slow), "study", "Study");
		expect(renamed).toEqual({
			ok: true,
			presets: [{ name: "Study", ...slow }],
		});
	});

	it("delete by name", () => {
		const list = saved(saved([], "Study", slow), "Skim");
		expect(deletePreset(list, "study").map((preset) => preset.name)).toEqual([
			"Skim",
		]);
	});

	it("come back from this device as they were saved", () => {
		const storage = memory();
		const list = saved(saved([], "Study", slow), "Skim");
		savePresets(storage, list);
		expect(loadPresets(storage)).toEqual(list);
	});

	it("drop a damaged preset and repair the settings of a sound one", () => {
		const storage = memory();
		storage.data.set(
			PRESETS_KEY,
			JSON.stringify([
				{ name: "", settings: {}, sound: {}, mode: "rsvp" },
				"nonsense",
				{ name: "Odd", settings: { wpm: 99999 }, sound: { ambient: "blue" } },
			]),
		);
		expect(loadPresets(storage)).toEqual([
			{
				name: "Odd",
				settings: { ...DEFAULT_READER_SETTINGS, wpm: 1600 },
				sound: DEFAULT_AUDIO_PREFS,
				mode: "rsvp",
			},
		]);
		for (const raw of ["{", "{}", "null"]) {
			storage.data.set(PRESETS_KEY, raw);
			expect(loadPresets(storage)).toEqual([]);
		}
	});

	it("stay on this device and are never synced", () => {
		expect(SYNCED_SETTINGS).not.toContain(PRESETS_KEY);
	});
});
