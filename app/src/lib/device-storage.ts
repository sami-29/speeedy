/** localStorage, or nothing in a private window or where storage is blocked. */
export function deviceStorage(): Storage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}
