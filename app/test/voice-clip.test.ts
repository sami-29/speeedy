import { tokenize } from "@speeedy/engine";
import { describe, expect, it } from "vitest";
import { memoryAudioCache } from "../src/lib/voice/audio-cache.ts";
import {
	clipKey,
	createRenderer,
	type Generated,
	splitSentence,
} from "../src/lib/voice/clip.ts";

/**
 * A generator shaped like the Kokoro worker's answer: one timed word per Engine word. Each
 * word lasts a quarter second; a sentence of more than `maxWords` words is too long.
 */
function fakeGenerate(maxWords = Number.POSITIVE_INFINITY) {
	const calls: { sentence: string; speed: number }[] = [];
	const generate = async (
		sentence: string,
		speed: number,
	): Promise<Generated> => {
		calls.push({ sentence, speed });
		const words = tokenize(sentence).map((token) => token.text);
		if (words.length === 0) {
			throw Object.assign(new Error("empty"), { code: "empty" });
		}
		if (words.length > maxWords) {
			throw Object.assign(new Error("too long"), { code: "too-long" });
		}
		const seconds = words.length * 0.25;
		return {
			samples: new Float32Array(seconds * 24_000).fill(calls.length),
			sampleRate: 24_000,
			words: words.map((text, i) => ({
				text,
				start: i * 0.25,
				end: (i + 1) * 0.25,
			})),
			ms: seconds * 100,
		};
	};
	return { generate, calls };
}

describe("A sentence's audio", () => {
	it("places each timed word at its own character in the sentence (golden)", async () => {
		const { generate } = fakeGenerate();
		const render = createRenderer({
			generate,
			cache: memoryAudioCache(),
			voice: "af_msa",
		});
		const clip = await render("“Hello,” she said — twice.", 1);
		expect(clip.words).toEqual([
			{ offset: 0, start: 0, end: 0.25 },
			{ offset: 9, start: 0.25, end: 0.5 },
			{ offset: 13, start: 0.5, end: 0.75 },
			{ offset: 20, start: 0.75, end: 1 },
		]);
		expect(clip.samples.length).toBe(24_000);
		expect(clip.cached).toBe(false);
		expect(clip.ms).toBe(100);
	});

	it("splits a sentence too long for the model at a comma, then at a space, and joins the audio (golden)", async () => {
		const { generate, calls } = fakeGenerate(3);
		const render = createRenderer({
			generate,
			cache: memoryAudioCache(),
			voice: "af_msa",
		});
		const clip = await render("Hello there, the cat sat on the mat.", 1);
		expect(calls.map((call) => call.sentence)).toEqual([
			"Hello there, the cat sat on the mat.",
			"Hello there, ",
			"the cat sat on the mat.",
			"the cat sat ",
			"on the mat.",
		]);
		expect(clip.words).toEqual([
			{ offset: 0, start: 0, end: 0.25 },
			{ offset: 6, start: 0.25, end: 0.5 },
			{ offset: 13, start: 0.5, end: 0.75 },
			{ offset: 17, start: 0.75, end: 1 },
			{ offset: 21, start: 1, end: 1.25 },
			{ offset: 25, start: 1.25, end: 1.5 },
			{ offset: 28, start: 1.5, end: 1.75 },
			{ offset: 32, start: 1.75, end: 2 },
		]);
		expect(clip.samples.length).toBe(48_000);
		// The pieces are joined in order.
		expect(clip.samples[0]).toBe(2);
		expect(clip.samples[12_000]).toBe(4);
		expect(clip.samples[30_000]).toBe(5);
	});

	it("has nothing to say for a sentence of marks alone: an empty clip, not an error", async () => {
		const { generate } = fakeGenerate();
		const render = createRenderer({
			generate,
			cache: memoryAudioCache(),
			voice: "af_msa",
		});
		const clip = await render("   ", 1);
		expect(clip.samples.length).toBe(0);
		expect(clip.words).toEqual([]);
	});

	it("passes other failures on", async () => {
		const render = createRenderer({
			generate: async () => {
				throw Object.assign(new Error("bad"), { code: "bad-output" });
			},
			cache: memoryAudioCache(),
			voice: "af_msa",
		});
		await expect(render("Hello there.", 1)).rejects.toMatchObject({
			code: "bad-output",
		});
	});

	it("keeps each sentence's audio per voice and speed, and plays it again from there", async () => {
		const { generate, calls } = fakeGenerate();
		const cache = memoryAudioCache();
		const render = createRenderer({ generate, cache, voice: "af_msa" });
		await render("Hello there.", 1);
		const again = await render("Hello there.", 1);
		expect(again.cached).toBe(true);
		expect(again.ms).toBe(0);
		expect(again.words).toHaveLength(2);
		await render("Hello there.", 1.2);
		await createRenderer({ generate, cache, voice: "bf_other" })(
			"Hello there.",
			1,
		);
		expect(calls).toHaveLength(3);
	});

	it("names a kept clip by sentence, voice and speed", () => {
		expect(clipKey("Hi.", "af_msa", 1)).not.toBe(clipKey("Hi.", "af_msa", 1.1));
		expect(clipKey("Hi.", "af_msa", 1)).not.toBe(clipKey("Hi.", "bf_x", 1));
		expect(clipKey("Hi.", "af_msa", 1)).not.toBe(clipKey("Hi!", "af_msa", 1));
		expect(clipKey("Hi.", "af_msa", 1)).toBe(clipKey("Hi.", "af_msa", 1.0001));
	});

	it("stops splitting when a piece cannot be split", async () => {
		const { generate } = fakeGenerate(0);
		const render = createRenderer({
			generate,
			cache: memoryAudioCache(),
			voice: "af_msa",
		});
		await expect(render("Supercalifragilistic.", 1)).rejects.toMatchObject({
			code: "too-long",
		});
	});
});

describe("splitSentence", () => {
	it("prefers a break after punctuation near the middle", () => {
		expect(splitSentence("Hello there, the cat sat on the mat.")).toEqual([
			"Hello there, ",
			"the cat sat on the mat.",
		]);
	});

	it("falls back to the space nearest the middle", () => {
		expect(splitSentence("the cat sat on the mat.")).toEqual([
			"the cat sat ",
			"on the mat.",
		]);
	});

	it("cannot split one word", () => {
		expect(splitSentence("Supercalifragilistic.")).toBeUndefined();
	});
});
