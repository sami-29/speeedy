// Runs the real Kokoro-7M-Distill model through onnxruntime-web's WASM backend in Node.
// The 30 MB model is never committed: this suite runs only when `pnpm fetch:assets` has
// put it in `.cache` (CI restores that cache), and is skipped otherwise.
import { tokenize } from "@speeedy/engine";
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createGenerator,
	createOrtSession,
	type Generator,
	SAMPLE_RATE,
	voicePack,
} from "../src/index";
import { cachedAsset, isCached, realLexicon } from "./helpers";

const ready = isCached("model") && isCached("voice");

describe.skipIf(!ready)("Kokoro-7M-Distill on WASM", () => {
	let kokoro: Generator;
	beforeAll(async () => {
		ort.env.wasm.numThreads = 1;
		const session = await createOrtSession(ort, await cachedAsset("model"), {
			threads: 1,
		});
		kokoro = createGenerator({
			session,
			voices: { af_msa: voicePack(await cachedAsset("voice")) },
			lexicon: await realLexicon(),
		});
	}, 120_000);

	it("speaks a sentence with one timed word per text word", async () => {
		const sentence = "The quick brown fox jumps over the lazy dog.";
		const result = await kokoro.generate(sentence, { voice: "af_msa" });
		expect(result.words.map((w) => w.text)).toEqual(
			tokenize(sentence).map((t) => t.text),
		);
		const seconds = result.samples.length / SAMPLE_RATE;
		expect(seconds).toBeGreaterThan(1);
		expect(result.words.at(-1)?.end ?? 0).toBeLessThanOrEqual(seconds + 1e-9);
		const total = Array.from(result.durations).reduce((a, b) => a + b, 0);
		expect(result.samples.length).toBe(total * 600);
		expect(result.samples.some((s) => Math.abs(s) > 0.01)).toBe(true);
	}, 60_000);

	it("says the same sentence faster at a higher speed", async () => {
		const sentence = "Reading quickly helps you learn faster.";
		const normal = await kokoro.generate(sentence, { voice: "af_msa" });
		const fast = await kokoro.generate(sentence, {
			voice: "af_msa",
			speed: 1.5,
		});
		expect(fast.samples.length).toBeLessThan(normal.samples.length * 0.85);
	}, 60_000);
});
