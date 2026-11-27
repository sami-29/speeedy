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
			sentencePause: 4.5,
			paragraphPause: 2.3,
			commaPause: true,
			asidePause: false,
			speedRamp: true,
			rampTarget: 650,
			rampLength: 90,
			rewindStep: 12,
			countdown: true,
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

	it("keep each pacing number in its range", () => {
		const storage = memory();
		storage.data.set(
			READER_PREFS_KEY,
			JSON.stringify({
				sentencePause: 0.2,
				paragraphPause: 7,
				rampTarget: 5000,
				rampLength: 1,
				rewindStep: 400.6,
			}),
		);
		expect(loadReaderSettings(storage)).toEqual({
			...DEFAULT_READER_SETTINGS,
			sentencePause: 1,
			paragraphPause: 3,
			rampTarget: 1600,
			rampLength: 10,
			rewindStep: 50,
		});
	});

	it("round the pauses to a tenth and the whole numbers to whole words", () => {
		const storage = memory();
		storage.data.set(
			READER_PREFS_KEY,
			JSON.stringify({
				sentencePause: 2.26,
				paragraphPause: 1.84,
				rampTarget: 512.4,
				rampLength: 33.2,
				rewindStep: 4.4,
			}),
		);
		expect(loadReaderSettings(storage)).toMatchObject({
			sentencePause: 2.3,
			paragraphPause: 1.8,
			rampTarget: 512,
			rampLength: 33,
			rewindStep: 4,
		});
	});

	it("ignore a pacing value that is not a number or a switch that is not a boolean", () => {
		const storage = memory();
		storage.data.set(
			READER_PREFS_KEY,
			JSON.stringify({
				sentencePause: "long",
				rewindStep: Number.NaN,
				commaPause: 1,
				countdown: "on",
			}),
		);
		expect(loadReaderSettings(storage)).toEqual(DEFAULT_READER_SETTINGS);
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
