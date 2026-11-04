import { SYNCED_SETTINGS } from "@speeedy/sync";
import { describe, expect, it } from "vitest";
import {
	AMBIENT_KINDS,
	AUDIO_PREFS_KEY,
	clampVolume,
	DEFAULT_AUDIO_PREFS,
	loadAudioPrefs,
	saveAudioPrefs,
} from "../src/lib/audio/prefs.ts";
import { memoryStorage } from "./fake-audio.ts";

describe("audio preferences", () => {
	it("start with no ambient noise, no tick, and a quiet noise bed", () => {
		expect(loadAudioPrefs(memoryStorage())).toEqual(DEFAULT_AUDIO_PREFS);
		expect(DEFAULT_AUDIO_PREFS.ambient).toBe("none");
		expect(DEFAULT_AUDIO_PREFS.tick).toBe(false);
		expect(DEFAULT_AUDIO_PREFS.volumes.voice).toBe(1);
		expect(DEFAULT_AUDIO_PREFS.volumes.ambient).toBeLessThan(0.5);
	});

	it("come back as they were saved", () => {
		const storage = memoryStorage();
		const prefs = {
			volumes: { voice: 0.7, ambient: 0.2, cue: 0.9 },
			ambient: "pink" as const,
			tick: true,
		};
		saveAudioPrefs(storage, prefs);
		expect(loadAudioPrefs(storage)).toEqual(prefs);
	});

	it("keep only ids, numbers and a switch: no text", () => {
		const storage = memoryStorage();
		saveAudioPrefs(storage, DEFAULT_AUDIO_PREFS);
		const saved = JSON.parse(storage.data.get(AUDIO_PREFS_KEY) ?? "{}");
		expect(Object.keys(saved).sort()).toEqual(["ambient", "tick", "volumes"]);
	});

	it("fall back to the defaults for anything missing, damaged or out of range", () => {
		expect(loadAudioPrefs(undefined)).toEqual(DEFAULT_AUDIO_PREFS);
		expect(
			loadAudioPrefs(memoryStorage({ [AUDIO_PREFS_KEY]: "{oops" })),
		).toEqual(DEFAULT_AUDIO_PREFS);
		expect(loadAudioPrefs(memoryStorage({ [AUDIO_PREFS_KEY]: "[]" }))).toEqual(
			DEFAULT_AUDIO_PREFS,
		);
		const odd = memoryStorage({
			[AUDIO_PREFS_KEY]: JSON.stringify({
				volumes: { voice: 4, ambient: "loud", cue: -1 },
				ambient: "rain",
				tick: "yes",
			}),
		});
		expect(loadAudioPrefs(odd)).toEqual({
			volumes: {
				voice: 1,
				ambient: DEFAULT_AUDIO_PREFS.volumes.ambient,
				cue: 0,
			},
			ambient: "none",
			tick: false,
		});
	});

	it("survive a store that throws", () => {
		const blocked = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		};
		expect(loadAudioPrefs(blocked)).toEqual(DEFAULT_AUDIO_PREFS);
		expect(() => saveAudioPrefs(blocked, DEFAULT_AUDIO_PREFS)).not.toThrow();
	});

	it("offer none, white, pink and brown", () => {
		expect([...AMBIENT_KINDS]).toEqual(["none", "white", "pink", "brown"]);
	});

	it("clamp a volume to a twentieth between 0 and 1", () => {
		expect(clampVolume(0.52)).toBe(0.5);
		expect(clampVolume(2)).toBe(1);
		expect(clampVolume(-1)).toBe(0);
	});

	it("never go to the server: none of them is a synced setting", () => {
		expect(SYNCED_SETTINGS).not.toContain(AUDIO_PREFS_KEY);
		for (const key of [
			"volumes",
			"ambient",
			"tick",
			"ambientVolume",
			"voiceVolume",
		]) {
			expect(SYNCED_SETTINGS).not.toContain(key);
		}
	});
});
