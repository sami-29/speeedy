// Real-time factor of Kokoro-7M-Distill on onnxruntime-web's WASM backend: generation time
// divided by audio length (below 1 is faster than real time). Needs `pnpm fetch:assets`.
// Run with `pnpm bench`; KOKORO_THREADS sets the WASM thread count (default 1, the
// non-isolated case).
import { cpus } from "node:os";
import * as ort from "onnxruntime-web";
import { describe, expect, it } from "vitest";
import {
	createGenerator,
	createOrtSession,
	SAMPLE_RATE,
	voicePack,
} from "../src/index";
import { cachedAsset, isCached, realLexicon } from "../test/helpers";

const threads = Number(process.env.KOKORO_THREADS ?? 1);
const sentences = [
	"The quick brown fox jumps over the lazy dog.",
	"Reading quickly helps you learn faster, but only if you understand what you read.",
	"She opened the letter slowly, afraid of what it might say.",
	"In 1969, NASA landed two astronauts on the Moon and brought them home safely.",
	"Please close the door when you leave the room.",
];

describe.skipIf(!isCached("model"))("Kokoro-7M real-time factor", () => {
	it(`generates faster than real time on ${threads} thread(s)`, async () => {
		ort.env.wasm.numThreads = threads;
		const kokoro = createGenerator({
			session: await createOrtSession(ort, await cachedAsset("model"), {
				threads,
			}),
			voices: { af_msa: voicePack(await cachedAsset("voice")) },
			lexicon: await realLexicon(),
		});
		await kokoro.generate(sentences[0] as string, { voice: "af_msa" });
		let compute = 0;
		let audio = 0;
		for (let round = 0; round < 3; round++) {
			for (const sentence of sentences) {
				const start = performance.now();
				const result = await kokoro.generate(sentence, { voice: "af_msa" });
				compute += (performance.now() - start) / 1000;
				audio += result.samples.length / SAMPLE_RATE;
			}
		}
		const rtf = compute / audio;
		console.log(
			`RTF ${rtf.toFixed(3)}: ${compute.toFixed(1)} s compute for ${audio.toFixed(1)} s audio, ` +
				`${threads} thread(s), Node ${process.version}, ${cpus()[0]?.model ?? "unknown CPU"}`,
		);
		expect(rtf).toBeLessThan(1);
	});
});
