import { SYNCED_SETTINGS } from "@speeedy/sync";
import { describe, expect, it } from "vitest";
import {
	FOCUS_PREFS_KEY,
	loadFocusOnPlay,
	saveFocusOnPlay,
} from "../src/lib/reader/focus.ts";

const memory = () => {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			items.set(key, value);
		},
	};
};

describe("focus on Play", () => {
	it("is off until the reader turns it on", () => {
		expect(loadFocusOnPlay(memory())).toBe(false);
		expect(loadFocusOnPlay(undefined)).toBe(false);
	});

	it("is remembered on this device", () => {
		const storage = memory();
		saveFocusOnPlay(storage, true);
		expect(loadFocusOnPlay(storage)).toBe(true);
		saveFocusOnPlay(storage, false);
		expect(loadFocusOnPlay(storage)).toBe(false);
	});

	it("reads a damaged or foreign value as off", () => {
		const storage = memory();
		for (const raw of ["yes", "{", '{"onPlay":"true"}', "[true]", "null"]) {
			storage.items.set(FOCUS_PREFS_KEY, raw);
			expect(loadFocusOnPlay(storage)).toBe(false);
		}
	});

	it("does not throw when storage is blocked", () => {
		const blocked = {
			getItem: () => {
				throw new Error("SecurityError");
			},
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
		};
		expect(loadFocusOnPlay(blocked)).toBe(false);
		expect(() => saveFocusOnPlay(blocked, true)).not.toThrow();
	});

	it("stays on this device and is never synced", () => {
		expect(SYNCED_SETTINGS).not.toContain(FOCUS_PREFS_KEY);
	});
});
