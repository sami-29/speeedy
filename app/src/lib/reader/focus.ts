import { isRecord, readJson, writeJson } from "../device-storage.ts";

/**
 * Whether Play also enters the focus state, remembered on this device. One flag, never text;
 * it is never sent anywhere.
 */
export const FOCUS_PREFS_KEY = "speeedy.focus";

/** The saved choice. Anything missing, damaged or out of reach reads as off. */
export function loadFocusOnPlay(
	storage: Pick<Storage, "getItem"> | undefined,
): boolean {
	const saved = readJson(storage, FOCUS_PREFS_KEY);
	return isRecord(saved) && saved.onPlay === true;
}

/** Keep the choice. A blocked or full store is not an error: it lasts for this visit only. */
export function saveFocusOnPlay(
	storage: Pick<Storage, "setItem"> | undefined,
	onPlay: boolean,
): void {
	writeJson(storage, FOCUS_PREFS_KEY, { onPlay });
}
