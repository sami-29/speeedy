/** localStorage, or nothing in a private window or where storage is blocked. */
export function deviceStorage(): Storage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** A plain object, as opposed to null, an array or a primitive. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON saved under `key`. Undefined when it is missing, damaged or out of reach. */
export function readJson(
	storage: Pick<Storage, "getItem"> | undefined,
	key: string,
): unknown {
	try {
		const raw = storage?.getItem(key);
		return raw ? JSON.parse(raw) : undefined;
	} catch {
		return undefined;
	}
}

/** Save `value` as JSON under `key`. A blocked or full store is not an error: it lasts for this visit. */
export function writeJson(
	storage: Pick<Storage, "setItem"> | undefined,
	key: string,
	value: unknown,
): void {
	try {
		storage?.setItem(key, JSON.stringify(value));
	} catch {
		// Private window or storage blocked.
	}
}
