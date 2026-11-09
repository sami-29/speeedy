import { type Oov, phonemize } from "./g2p";
import type { Lexicon } from "./lexicon";
import { joinTimestamps } from "./timing";
import { phonemeIds } from "./vocab";

export const SAMPLE_RATE = 24_000;
/** Kokoro sounds rushed above this; faster reading is the engine's job, not the voice's. */
export const MAX_SPEED = 1.5;
/** The model takes at most 512 ids, two of them the pads. */
export const MAX_PHONEMES = 510;
const STYLE_SIZE = 256;

export type KokoroErrorCode =
	| "not-english"
	| "too-long"
	| "unknown-voice"
	| "empty"
	| "bad-output"
	| "consent-required"
	| "not-loaded"
	| "not-downloaded"
	| "download-failed"
	| "cancelled";

export class KokoroError extends Error {
	readonly code: KokoroErrorCode;
	constructor(code: KokoroErrorCode, message: string = code) {
		super(message);
		this.name = "KokoroError";
		this.code = code;
	}
}

export type SessionInput = {
	inputIds: BigInt64Array;
	style: Float32Array;
	speed: number;
};
export type SessionOutput = {
	waveform: Float32Array;
	durations: BigInt64Array;
};
/** The ONNX model behind a small seam, so tests can stand in for it. */
export type KokoroSession = {
	run(input: SessionInput): Promise<SessionOutput>;
};

export type TimedWord = { text: string; start: number; end: number };
export type GenerateOptions = {
	voice: string;
	speed?: number;
	language?: string;
};
export type GenerateResult = {
	samples: Float32Array;
	sampleRate: number;
	/** Duration frames per input id, pads included. */
	durations: number[];
	phonemes: string;
	/** One entry per engine word of the sentence, in seconds from the start of `samples`. */
	words: TimedWord[];
	speed: number;
};
export type Generator = {
	generate(sentence: string, options: GenerateOptions): Promise<GenerateResult>;
};
export type GeneratorOptions = {
	session: KokoroSession;
	/** Voice packs: float32 [510, 1, 256], one style row per phoneme count. */
	voices: Record<string, Float32Array>;
	lexicon: Lexicon;
	oov?: Oov;
};

/** Read a voice pack file (raw little-endian float32). */
export function voicePack(bytes: Uint8Array): Float32Array {
	const copy = bytes.slice();
	return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

export const clampSpeed = (speed = 1) =>
	Number.isFinite(speed) && speed > 0 ? Math.min(speed, MAX_SPEED) : 1;

/** True when the text is mostly Latin script and the language, if given, is English. */
export function isEnglish(text: string, language?: string): boolean {
	if (language && language.split(/[-_]/)[0]?.toLowerCase() !== "en")
		return false;
	const letters = text.match(/\p{L}/gu) ?? [];
	const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
	return latin * 2 > letters.length || letters.length === 0;
}

export function createGenerator({
	session,
	voices,
	lexicon,
	oov,
}: GeneratorOptions): Generator {
	return {
		async generate(sentence, { voice, speed, language }) {
			const pack = Object.hasOwn(voices, voice) ? voices[voice] : undefined;
			if (!pack) throw new KokoroError("unknown-voice", `no voice ${voice}`);
			if (!sentence.trim()) throw new KokoroError("empty");
			if (!isEnglish(sentence, language)) throw new KokoroError("not-english");
			const { phonemes, words } = phonemize(
				sentence,
				lexicon,
				oov ? { oov } : {},
			);
			const count = phonemes.length;
			if (count === 0) throw new KokoroError("empty", "nothing to say");
			if (count > MAX_PHONEMES) {
				throw new KokoroError(
					"too-long",
					`${count} phonemes, at most ${MAX_PHONEMES}`,
				);
			}
			const row = count - 1;
			const style = pack.slice(row * STYLE_SIZE, (row + 1) * STYLE_SIZE);
			if (style.length !== STYLE_SIZE)
				throw new KokoroError("unknown-voice", "voice pack too short");
			const inputIds = phonemeIds(phonemes);
			const rate = clampSpeed(speed);
			const output = await session.run({ inputIds, style, speed: rate });
			const durations = Array.from(output.durations, Number);
			if (durations.length !== inputIds.length) {
				throw new KokoroError(
					"bad-output",
					`${durations.length} durations for ${inputIds.length} ids`,
				);
			}
			const tokens = words.flatMap((word) => word.tokens);
			const spans = joinTimestamps(tokens, durations);
			let k = 0;
			let last = spans[0]?.start ?? 0;
			const timed = words.map((word) => {
				const own = spans.slice(k, k + word.tokens.length);
				k += word.tokens.length;
				const start = own[0]?.start ?? last;
				const end = own.at(-1)?.end ?? last;
				last = end;
				return { text: word.text, start, end };
			});
			return {
				samples: output.waveform,
				sampleRate: SAMPLE_RATE,
				durations,
				phonemes,
				words: timed,
				speed: rate,
			};
		},
	};
}
