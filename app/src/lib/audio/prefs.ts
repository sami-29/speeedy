import { isRecord, readJson, writeJson } from "../device-storage.ts";
/** The three buses every sound goes through. */
export type BusName = "voice" | "ambient" | "cue";

export const AMBIENT_KINDS = ["none", "white", "pink", "brown"] as const;
export type AmbientKind = (typeof AMBIENT_KINDS)[number];

/**
 * What the reader chose for sound on this device: a volume for each bus, the ambient noise,
 * and whether to tick on each word. Ids, numbers and a switch, never text. Device-only: none
 * of it is a synced setting, so it never leaves the device.
 */
export type AudioPrefs = {
	/** Each from 0 (silent) to 1 (full). */
	volumes: Record<BusName, number>;
	ambient: AmbientKind;
	/** A short tick on each word shown, in the modes that make no sound of their own. */
	tick: boolean;
	/** The tick's pitch, as a multiple of its note: 0.1 to 3, to a tenth. */
	tickPitch: number;
};

export const AUDIO_PREFS_KEY = "speeedy.audio";

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
	volumes: { voice: 1, ambient: 0.3, cue: 0.5 },
	ambient: "none",
	tick: false,
	tickPitch: 1,
};

export const MIN_TICK_PITCH = 0.1;
export const MAX_TICK_PITCH = 3;

/** A pitch in range, to a tenth. Not a number is the tick's own note. */
export function clampPitch(pitch: number): number {
	if (!Number.isFinite(pitch)) return DEFAULT_AUDIO_PREFS.tickPitch;
	return Math.min(
		Math.max(Math.round(pitch * 10) / 10, MIN_TICK_PITCH),
		MAX_TICK_PITCH,
	);
}

/** A volume in range, to a twentieth. Not a number is no change (`fallback`). */
export function clampVolume(volume: number, fallback = 1): number {
	if (!Number.isFinite(volume)) return fallback;
	return Math.min(Math.max(Math.round(volume * 20) / 20, 0), 1);
}

const BUSES: readonly BusName[] = ["voice", "ambient", "cue"];

/** A full set of preferences from anything: what is sound is kept, the rest is the default. */
export function audioPrefsFrom(value: unknown): AudioPrefs {
	if (!isRecord(value)) {
		return {
			...DEFAULT_AUDIO_PREFS,
			volumes: { ...DEFAULT_AUDIO_PREFS.volumes },
		};
	}
	const saved = isRecord(value.volumes) ? value.volumes : {};
	const volumes = { ...DEFAULT_AUDIO_PREFS.volumes };
	for (const bus of BUSES) {
		const level = saved[bus];
		if (typeof level === "number") {
			volumes[bus] = clampVolume(level, volumes[bus]);
		}
	}
	const ambient = AMBIENT_KINDS.find((kind) => kind === value.ambient);
	return {
		volumes,
		ambient: ambient ?? "none",
		tick: value.tick === true,
		tickPitch:
			typeof value.tickPitch === "number"
				? clampPitch(value.tickPitch)
				: DEFAULT_AUDIO_PREFS.tickPitch,
	};
}

/** The saved preferences, or the defaults for anything missing, damaged or out of reach. */
export function loadAudioPrefs(
	storage: Pick<Storage, "getItem"> | undefined,
): AudioPrefs {
	return audioPrefsFrom(readJson(storage, AUDIO_PREFS_KEY));
}

/** Keep the preferences. A blocked or full store is not an error: sound works without it. */
export function saveAudioPrefs(
	storage: Pick<Storage, "setItem"> | undefined,
	prefs: AudioPrefs,
): void {
	writeJson(storage, AUDIO_PREFS_KEY, {
		volumes: prefs.volumes,
		ambient: prefs.ambient,
		tick: prefs.tick,
		tickPitch: prefs.tickPitch,
	});
}
