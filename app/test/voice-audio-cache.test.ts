import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
	AUDIO_CACHE_BYTES,
	type AudioCache,
	createAudioCache,
	memoryAudioCache,
} from "../src/lib/voice/audio-cache.ts";
import type { Clip } from "../src/lib/voice/clip.ts";

let counter = 0;
const fresh = () => `speeedy-voice-test-${++counter}`;

/** A clip whose samples take `bytes` bytes (4 per sample). */
const clip = (bytes: number, mark = 1): Clip => ({
	samples: new Float32Array(bytes / 4).fill(mark),
	sampleRate: 24_000,
	words: [{ offset: 0, start: 0, end: 0.25 }],
});

function clock() {
	let time = 1_000;
	return { now: () => time++ };
}

const kinds: [string, (cap: number) => AudioCache][] = [
	["IndexedDB", (cap) => createAudioCache({ name: fresh(), cap, ...clock() })],
	["memory", (cap) => memoryAudioCache({ cap, ...clock() })],
];

describe.each(kinds)("The voice's audio cache (%s)", (_, make) => {
	it("gives back the audio and word times it was given", async () => {
		const cache = make(10_000);
		await cache.put("a", clip(400, 7));
		const back = await cache.get("a");
		expect(back?.samples.length).toBe(100);
		expect(back?.samples[99]).toBe(7);
		expect(back?.sampleRate).toBe(24_000);
		expect(back?.words).toEqual([{ offset: 0, start: 0, end: 0.25 }]);
		expect(await cache.get("missing")).toBeUndefined();
	});

	it("drops the oldest clips first to stay under its cap", async () => {
		const cache = make(2_500);
		await cache.put("a", clip(1_000));
		await cache.put("b", clip(1_000));
		await cache.put("c", clip(1_000));
		expect(await cache.get("a")).toBeUndefined();
		expect(await cache.get("b")).toBeDefined();
		expect(await cache.get("c")).toBeDefined();
		expect(await cache.size()).toBeLessThanOrEqual(2_500);
	});

	it("counts a clip played again as new, so the one left unplayed goes first", async () => {
		const cache = make(2_500);
		await cache.put("a", clip(1_000));
		await cache.put("b", clip(1_000));
		await cache.get("a");
		await cache.put("c", clip(1_000));
		expect(await cache.get("a")).toBeDefined();
		expect(await cache.get("b")).toBeUndefined();
	});

	it("keeps nothing bigger than the whole cap", async () => {
		const cache = make(1_000);
		await cache.put("a", clip(400));
		await cache.put("huge", clip(4_000));
		expect(await cache.get("huge")).toBeUndefined();
		expect(await cache.get("a")).toBeDefined();
	});

	it("replaces a clip kept under the same name without counting it twice", async () => {
		const cache = make(2_500);
		await cache.put("a", clip(1_000));
		await cache.put("a", clip(1_000, 2));
		expect(await cache.size()).toBe(1_000);
		expect((await cache.get("a"))?.samples[0]).toBe(2);
	});
});

describe("The voice's audio cache", () => {
	it("holds up to 500 MB across every document, voice and speed", () => {
		expect(AUDIO_CACHE_BYTES).toBe(500_000_000);
	});

	it("is shared by every cache opened under the same name", async () => {
		const name = fresh();
		await createAudioCache({ name, cap: 10_000 }).put("a", clip(400));
		expect(
			await createAudioCache({ name, cap: 10_000 }).get("a"),
		).toBeDefined();
	});
});
