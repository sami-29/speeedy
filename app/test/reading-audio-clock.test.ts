import "fake-indexeddb/auto";
import { buildTimeline } from "@speeedy/engine";
import { describe, expect, it } from "vitest";
import { startReading } from "../src/lib/reader/reading.ts";
import { DEFAULT_READER_SETTINGS } from "../src/lib/reader/settings.ts";

const DOC = {
	version: 1 as const,
	blocks: [
		{ kind: "paragraph" as const, text: "one two three four", spans: [] },
	],
};

function setup() {
	const output = { currentTime: 0, outputLatency: 0.01 };
	const reading = startReading({
		timeline: buildTimeline(DOC, { wpm: 250 }),
		settings: DEFAULT_READER_SETTINGS,
		client: { change: async () => {} } as never,
		audio: () => output,
	});
	return { output, reading };
}

describe("Reading's audio Clock", () => {
	it("is one of the Clocks a mode can run on, beside the timer and the speech Clock", () => {
		const { reading } = setup();
		expect(Object.keys(reading.clocks).sort()).toEqual([
			"audio",
			"timer",
			"web-speech",
		]);
		reading.dispose();
	});

	it("reads the audio context's time minus its output latency", () => {
		const { reading, output } = setup();
		output.currentTime = 2;
		expect(reading.clocks.audio?.now()).toBeCloseTo(1990, 6);
		reading.dispose();
	});

	it("is what useClock switches the Engine to for the audio kind", () => {
		const { reading } = setup();
		expect(reading.useClock("audio")).toBe(reading.clocks.audio);
		reading.dispose();
	});
});
