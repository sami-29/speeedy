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
};

export const AUDIO_PREFS_KEY = "speeedy.audio";

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
	volumes: { voice: 1, ambient: 0.3, cue: 0.5 },
	ambient: "none",
	tick: false,
};

/** A volume in range, to a twentieth. Not a number is no change (`fallback`). */
export function clampVolume(volume: number, fallback = 1): number {
	if (!Number.isFinite(volume)) return fallback;
	return Math.min(Math.max(Math.round(volume * 20) / 20, 0), 1);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const BUSES: readonly BusName[] = ["voice", "ambient", "cue"];

/** The saved preferences, or the defaults for anything missing, damaged or out of reach. */
export function loadAudioPrefs(
	storage: Pick<Storage, "getItem"> | undefined,
): AudioPrefs {
	try {
		const raw = storage?.getItem(AUDIO_PREFS_KEY);
		if (!raw) return DEFAULT_AUDIO_PREFS;
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return DEFAULT_AUDIO_PREFS;
		const saved = isRecord(parsed.volumes) ? parsed.volumes : {};
		const volumes = { ...DEFAULT_AUDIO_PREFS.volumes };
		for (const bus of BUSES) {
			const value = saved[bus];
			if (typeof value === "number") {
				volumes[bus] = clampVolume(value, volumes[bus]);
			}
		}
		const ambient = AMBIENT_KINDS.find((kind) => kind === parsed.ambient);
		return {
			volumes,
			ambient: ambient ?? "none",
			tick: parsed.tick === true,
		};
	} catch {
		return DEFAULT_AUDIO_PREFS;
	}
}

/** Keep the preferences. A blocked or full store is not an error: sound works without it. */
export function saveAudioPrefs(
	storage: Pick<Storage, "setItem"> | undefined,
	prefs: AudioPrefs,
): void {
	try {
		storage?.setItem(
			AUDIO_PREFS_KEY,
			JSON.stringify({
				volumes: prefs.volumes,
				ambient: prefs.ambient,
				tick: prefs.tick,
			}),
		);
	} catch {
		// Private window or storage blocked: the choice lasts for this visit only.
	}
}
