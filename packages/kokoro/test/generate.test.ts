import { tokenize } from "@speeedy/engine";
import { describe, expect, it } from "vitest";
import {
	createGenerator,
	KokoroError,
	type KokoroSession,
	Lexicon,
	MAX_SPEED,
	SAMPLE_RATE,
} from "../src/index";
import cases from "./fixtures/join-timestamps.json" with { type: "json" };
import { fixtureLexicon, rowVoice, stubSession } from "./helpers";

const lexicon = new Lexicon(fixtureLexicon);
const voices = { af_msa: rowVoice() };

function generator(session: KokoroSession = stubSession()) {
	return createGenerator({ session, voices, lexicon });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof KokoroError) return error.code;
		throw error;
	}
	return undefined;
}

describe("generate", () => {
	it("pads the phoneme ids with 0 at both ends and picks the voice row for their count", async () => {
		const session = stubSession();
		const result = await generator(session).generate("Hello, world!", {
			voice: "af_msa",
		});
		expect(result.phonemes).toBe("həlˈO, wˈɜɹld!");
		const [call] = session.calls;
		// Ids from Kokoro's config.json vocab.
		expect(Array.from(call?.inputIds ?? [], Number)).toEqual([
			0, 50, 83, 54, 156, 31, 3, 16, 65, 156, 87, 123, 54, 46, 5, 0,
		]);
		// 14 phonemes, so the style is voice pack row 13.
		expect(call?.style).toHaveLength(256);
		expect(call?.style[0]).toBe(13);
		expect(call?.speed).toBe(1);
	});

	it("returns the waveform at 24 kHz and the model's durations", async () => {
		const result = await generator(stubSession(3)).generate("The cat sat.", {
			voice: "af_msa",
		});
		expect(SAMPLE_RATE).toBe(24_000);
		expect(result.sampleRate).toBe(24_000);
		expect(result.durations).toHaveLength(result.phonemes.length + 2);
		expect(result.samples).toHaveLength(600 * 3 * (result.phonemes.length + 2));
	});

	it("times one word per text word, from the durations through join_timestamps", async () => {
		const [hello] = cases;
		const session: KokoroSession = {
			async run() {
				const durations = hello?.durations ?? [];
				const total = durations.reduce((a, b) => a + b, 0);
				return {
					waveform: new Float32Array(total * 600),
					durations: BigInt64Array.from(durations.map(BigInt)),
				};
			},
		};
		const result = await generator(session).generate("Hello, world!", {
			voice: "af_msa",
		});
		// A word spans its own tokens: "Hello," is həlˈO plus the comma.
		expect(result.words).toEqual([
			{ text: "Hello,", start: 0.275, end: 1.125 },
			{ text: "world!", start: 1.125, end: 1.975 },
		]);
	});

	it("keeps the engine's words, one timed word each, even for a word it cannot say", async () => {
		const sentence = 'She said, "Stop the zyxqv now," and sat (on the mat).';
		const result = await createGenerator({
			session: stubSession(),
			voices,
			lexicon,
			oov: () => "",
		}).generate(sentence, { voice: "af_msa" });
		expect(result.words.map((word) => word.text)).toEqual(
			tokenize(sentence).map((token) => token.text),
		);
		let last = 0;
		for (const word of result.words) {
			expect(word.start).toBeGreaterThanOrEqual(last);
			expect(word.end).toBeGreaterThanOrEqual(word.start);
			last = word.end;
		}
		expect(last).toBeLessThanOrEqual(result.samples.length / SAMPLE_RATE);
	});

	it("sets speed at generation and caps it at 1.5x", async () => {
		const session = stubSession();
		const kokoro = generator(session);
		expect(MAX_SPEED).toBe(1.5);
		const fast = await kokoro.generate("Hello.", { voice: "af_msa", speed: 3 });
		const slower = await kokoro.generate("Hello.", {
			voice: "af_msa",
			speed: 1.25,
		});
		expect(session.calls.map((call) => call.speed)).toEqual([1.5, 1.25]);
		expect(fast.speed).toBe(1.5);
		expect(slower.speed).toBe(1.25);
	});

	it("refuses text that is not English", async () => {
		const kokoro = generator();
		expect(
			await codeOf(kokoro.generate("Привет, мир.", { voice: "af_msa" })),
		).toBe("not-english");
		expect(await codeOf(kokoro.generate("你好", { voice: "af_msa" }))).toBe(
			"not-english",
		);
		expect(
			await codeOf(
				kokoro.generate("Hello.", { voice: "af_msa", language: "de" }),
			),
		).toBe("not-english");
		expect(
			await codeOf(
				kokoro.generate("Hello.", { voice: "af_msa", language: "en-GB" }),
			),
		).toBeUndefined();
	});

	it("refuses a sentence longer than the model's 510 phonemes", async () => {
		const sentence = Array.from({ length: 120 }, () => "hello").join(" ");
		expect(
			await codeOf(generator().generate(sentence, { voice: "af_msa" })),
		).toBe("too-long");
	});

	it("refuses an unknown voice and an empty sentence", async () => {
		expect(
			await codeOf(generator().generate("Hello.", { voice: "nope" })),
		).toBe("unknown-voice");
		expect(await codeOf(generator().generate("  ", { voice: "af_msa" }))).toBe(
			"empty",
		);
	});

	it("fails loudly when the model's durations do not match its input", async () => {
		const session: KokoroSession = {
			async run() {
				return {
					waveform: new Float32Array(600),
					durations: BigInt64Array.from([1n]),
				};
			},
		};
		expect(
			await codeOf(generator(session).generate("Hello.", { voice: "af_msa" })),
		).toBe("bad-output");
	});
});
