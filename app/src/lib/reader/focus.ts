/**
 * Whether Play also enters the focus state, remembered on this device. One flag, never text;
 * it is never sent anywhere.
 */
export const FOCUS_PREFS_KEY = "speeedy.focus";

/** The saved choice. Anything missing, damaged or out of reach reads as off. */
export function loadFocusOnPlay(
	storage: Pick<Storage, "getItem"> | undefined,
): boolean {
	try {
		const raw = storage?.getItem(FOCUS_PREFS_KEY);
		if (!raw) return false;
		const parsed: unknown = JSON.parse(raw);
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			(parsed as { onPlay?: unknown }).onPlay === true
		);
	} catch {
		return false;
	}
}

/** Keep the choice. A blocked or full store is not an error: it lasts for this visit only. */
export function saveFocusOnPlay(
	storage: Pick<Storage, "setItem"> | undefined,
	onPlay: boolean,
): void {
	try {
		storage?.setItem(FOCUS_PREFS_KEY, JSON.stringify({ onPlay }));
	} catch {
		// Private window or storage blocked.
	}
}
