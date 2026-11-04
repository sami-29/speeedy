import { LISTEN_LANGUAGES } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/lib/library/languages.ts";
import {
	clampRate,
	DEFAULT_PREFS,
	LISTEN_PREFS_KEY,
	loadPrefs,
	RATE_MAX,
	RATE_MIN,
	savePrefs,
	stepRate,
	withRate,
	withVoice,
} from "../src/lib/reader/listen/prefs.ts";

function memory(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		data,
	};
}

describe("Listen preferences", () => {
	it("start at normal speed with no chosen voice", () => {
		expect(loadPrefs(memory())).toEqual({ rate: 1, voices: {} });
		expect(DEFAULT_PREFS).toEqual({ rate: 1, voices: {} });
	});

	it("come back as they were saved", () => {
		const storage = memory();
		const saved = withVoice(withRate(DEFAULT_PREFS, 1.3), "fr-FR", "fr-voice");
		savePrefs(storage, saved);
		expect(loadPrefs(storage)).toEqual({
			rate: 1.3,
			voices: { fr: "fr-voice" },
		});
	});

	it("keep one voice for each language", () => {
		const prefs = withVoice(
			withVoice(DEFAULT_PREFS, "en-GB", "uk"),
			"en-US",
			"us",
		);
		expect(prefs.voices).toEqual({ en: "us" });
		expect(withVoice(prefs, "en", undefined).voices).toEqual({});
	});

	it("keep the voice choice for an unknown language under one key", () => {
		expect(withVoice(DEFAULT_PREFS, "und", "x").voices).toEqual({ und: "x" });
		expect(withVoice(DEFAULT_PREFS, undefined, "x").voices).toEqual({
			und: "x",
		});
	});

	it("hold the speed between slower than normal and 1.5 times", () => {
		expect(RATE_MIN).toBeLessThan(1);
		expect(RATE_MAX).toBe(1.5);
		expect(clampRate(3)).toBe(1.5);
		expect(clampRate(0.1)).toBe(RATE_MIN);
		expect(clampRate(Number.NaN)).toBe(1);
		expect(clampRate(1.23456)).toBe(1.2);
	});

	it("step the speed a tenth at a time without drifting", () => {
		let rate = 1;
		for (let i = 0; i < 3; i++) rate = stepRate(rate, 1);
		expect(rate).toBe(1.3);
		for (let i = 0; i < 10; i++) rate = stepRate(rate, 1);
		expect(rate).toBe(RATE_MAX);
		for (let i = 0; i < 20; i++) rate = stepRate(rate, -1);
		expect(rate).toBe(RATE_MIN);
	});

	it("fall back to the defaults for storage that is empty, damaged or out of reach", () => {
		expect(loadPrefs(memory({ [LISTEN_PREFS_KEY]: "{not json" }))).toEqual(
			DEFAULT_PREFS,
		);
		expect(loadPrefs(memory({ [LISTEN_PREFS_KEY]: "[1,2]" }))).toEqual(
			DEFAULT_PREFS,
		);
		expect(
			loadPrefs({
				getItem() {
					throw new Error("blocked");
				},
			}),
		).toEqual(DEFAULT_PREFS);
		expect(loadPrefs(undefined)).toEqual(DEFAULT_PREFS);
	});

	it("clamp a speed that was edited by hand and drop voices that are not text", () => {
		const loaded = loadPrefs(
			memory({
				[LISTEN_PREFS_KEY]: JSON.stringify({
					rate: 9,
					voices: { en: "ok", fr: 3, de: null },
				}),
			}),
		);
		expect(loaded).toEqual({ rate: RATE_MAX, voices: { en: "ok" } });
	});

	it("never fail a save, whatever the storage does", () => {
		expect(() =>
			savePrefs(
				{
					setItem() {
						throw new Error("quota");
					},
				},
				DEFAULT_PREFS,
			),
		).not.toThrow();
		expect(() => savePrefs(undefined, DEFAULT_PREFS)).not.toThrow();
	});

	it("store only the speed and voice ids: nothing about the text", () => {
		const storage = memory();
		savePrefs(storage, withVoice(withRate(DEFAULT_PREFS, 1.2), "en", "v"));
		expect(
			Object.keys(JSON.parse(storage.data.get(LISTEN_PREFS_KEY) ?? "{}")),
		).toEqual(["rate", "voices"]);
	});
});

describe("the languages Listen can report", () => {
	it("cover every language a reader can pick for a document", () => {
		for (const code of LANGUAGES) expect(LISTEN_LANGUAGES).toContain(code);
	});
});
