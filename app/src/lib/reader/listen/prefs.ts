import { baseLanguage } from "@speeedy/contracts";

/**
 * What Listen remembers on this device: the voice speed, and one voice per language. Only
 * ids and a number, never text; it is never sent anywhere.
 */
export type ListenPrefs = {
	rate: number;
	/** The voice the reader chose, by `voiceURI`, for each primary language. */
	voices: Record<string, string>;
};

export const LISTEN_PREFS_KEY = "speeedy.listen";

export const DEFAULT_PREFS: ListenPrefs = { rate: 1, voices: {} };

/** Browser voices take speeds well beyond these; up to 1.5 times keeps them clear. */
export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;
export const RATE_STEP = 0.1;

/** A speed in range, to a tenth. Not a number is normal speed. */
export function clampRate(rate: number): number {
	if (!Number.isFinite(rate)) return 1;
	const tenths = Math.round(rate * 10) / 10;
	return Math.min(Math.max(tenths, RATE_MIN), RATE_MAX);
}

/** One step faster (`1`) or slower (`-1`). */
export const stepRate = (rate: number, direction: 1 | -1): number =>
	clampRate(rate + direction * RATE_STEP);

export const withRate = (prefs: ListenPrefs, rate: number): ListenPrefs => ({
	...prefs,
	rate: clampRate(rate),
});

const languageKey = (language: string | undefined): string =>
	baseLanguage(language) ?? "und";

/** The voice for a document's language, or no choice (the browser picks) when `uri` is undefined. */
export function withVoice(
	prefs: ListenPrefs,
	language: string | undefined,
	uri: string | undefined,
): ListenPrefs {
	const voices = { ...prefs.voices };
	if (uri === undefined) delete voices[languageKey(language)];
	else voices[languageKey(language)] = uri;
	return { ...prefs, voices };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The saved preferences, or the defaults for anything missing, damaged or out of reach. */
export function loadPrefs(
	storage: Pick<Storage, "getItem"> | undefined,
): ListenPrefs {
	try {
		const raw = storage?.getItem(LISTEN_PREFS_KEY);
		if (!raw) return DEFAULT_PREFS;
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return DEFAULT_PREFS;
		const voices: Record<string, string> = {};
		if (isRecord(parsed.voices)) {
			for (const [language, uri] of Object.entries(parsed.voices)) {
				if (typeof uri === "string") voices[language] = uri;
			}
		}
		return {
			rate: typeof parsed.rate === "number" ? clampRate(parsed.rate) : 1,
			voices,
		};
	} catch {
		return DEFAULT_PREFS;
	}
}

/** Keep the preferences. A blocked or full store is not an error: Listen works without it. */
export function savePrefs(
	storage: Pick<Storage, "setItem"> | undefined,
	prefs: ListenPrefs,
): void {
	try {
		storage?.setItem(
			LISTEN_PREFS_KEY,
			JSON.stringify({ rate: prefs.rate, voices: prefs.voices }),
		);
	} catch {
		// Private window or storage blocked: the choice lasts for this visit only.
	}
}
