import { describe, expect, it } from "vitest";
import { handOff, takeHandoff } from "../src/lib/reader/handoff.ts";
import {
	DEFAULT_READER_SETTINGS,
	READER_PRESETS,
	withPreset,
} from "../src/lib/reader/settings.ts";

describe("reader presets", () => {
	it("the focus preset opens at 220 WPM", () => {
		expect(READER_PRESETS.focus.wpm).toBe(220);
	});

	it("applies over the reader's settings and leaves the rest alone", () => {
		const out = withPreset(DEFAULT_READER_SETTINGS, "focus");
		expect(out.wpm).toBe(220);
		expect(out.chunkSize).toBe(DEFAULT_READER_SETTINGS.chunkSize);
		expect(out.punctuationPauses).toBe(true);
		expect(DEFAULT_READER_SETTINGS.wpm).toBe(250);
	});

	it("changes nothing when there is no preset", () => {
		expect(withPreset(DEFAULT_READER_SETTINGS, undefined)).toEqual(
			DEFAULT_READER_SETTINGS,
		);
	});

	it("travels with the hand-off to the reader, once", () => {
		handOff({ text: "some words here", source: "own", preset: "focus" });
		expect(takeHandoff()).toEqual({
			text: "some words here",
			source: "own",
			preset: "focus",
		});
		expect(takeHandoff()).toBeUndefined();
	});
});
