import { SYNCED_SETTINGS } from "@speeedy/sync";
import { describe, expect, it } from "vitest";
import {
	loadReaderSettings,
	READER_PREFS_KEY,
	saveReaderSettings,
} from "../src/lib/reader/prefs.ts";
import { DEFAULT_READER_SETTINGS } from "../src/lib/reader/settings.ts";
import { memoryStorage as memory } from "./fake-audio.ts";

describe("reader settings on this device", () => {
	it("are the defaults until the reader changes one", () => {
		expect(loadReaderSettings(memory())).toEqual(DEFAULT_READER_SETTINGS);
		expect(loadReaderSettings(undefined)).toEqual(DEFAULT_READER_SETTINGS);
	});

	it("come back as they were saved", () => {
		const storage = memory();
		const saved = {
			wpm: 420,
			chunkSize: 3,
			smartSpeed: true,
			punctuationPauses: false,
			speedRamp: true,
			pauseView: "context" as const,
			showProgress: false,
			removeCitations: true,
		};
		saveReaderSettings(storage, saved);
		expect(loadReaderSettings(storage)).toEqual(saved);
	});

	it("keep what is sound and default the rest", () => {
		const storage = memory();
		storage.data.set(
			READER_PREFS_KEY,
			JSON.stringify({
				wpm: 5000,
				chunkSize: 9,
				smartSpeed: "yes",
				pauseView: "sideways",
				showProgress: false,
			}),
		);
		expect(loadReaderSettings(storage)).toEqual({
			...DEFAULT_READER_SETTINGS,
			wpm: 1600,
			chunkSize: 5,
			showProgress: false,
		});
	});

	it("read a damaged value as the defaults", () => {
		const storage = memory();
		for (const raw of ["{", "[1]", "null", '"fast"']) {
			storage.data.set(READER_PREFS_KEY, raw);
			expect(loadReaderSettings(storage)).toEqual(DEFAULT_READER_SETTINGS);
		}
	});

	it("do not throw when storage is blocked", () => {
		const blocked = {
			getItem: () => {
				throw new Error("SecurityError");
			},
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
		};
		expect(loadReaderSettings(blocked)).toEqual(DEFAULT_READER_SETTINGS);
		expect(() =>
			saveReaderSettings(blocked, DEFAULT_READER_SETTINGS),
		).not.toThrow();
	});

	it("stay on this device and are never synced", () => {
		expect(SYNCED_SETTINGS).not.toContain(READER_PREFS_KEY);
	});
});
