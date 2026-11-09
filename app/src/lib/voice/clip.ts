import { tokenize } from "@speeedy/engine";
import type { AudioCache } from "./audio-cache.ts";

/** A word of a sentence's audio: where it starts in the sentence's text, and when it is said. */
export type ClipWord = {
	/** UTF-16 offset of the word in the sentence. */
	offset: number;
	/** Seconds into the audio. */
	start: number;
	end: number;
};

/** One sentence's audio and the time of each of its words. */
export type Clip = {
	samples: Float32Array;
	sampleRate: number;
	words: ClipWord[];
};

/** A clip, with how long it took to make (0 from the cache) and whether it came from there. */
export type Rendered = Clip & { ms: number; cached: boolean };

/** What the voice makes of one piece of text: one timed word per Engine word. */
export type Generated = {
	samples: Float32Array;
	sampleRate: number;
	words: readonly { text: string; start: number; end: number }[];
	/** How long it took to make. */
	ms: number;
};

export type Generate = (
	text: string,
	speed: number,
	signal?: AbortSignal,
) => Promise<Generated>;

/** A sentence's audio at a speed, from the cache or made and kept. */
export type Render = (
	sentence: string,
	speed: number,
	signal?: AbortSignal,
) => Promise<Rendered>;

const SAMPLE_RATE = 24_000;

const codeOf = (error: unknown): unknown =>
	(error as { code?: unknown } | null)?.code;

/** The name a sentence's audio is kept under: the sentence, the voice and the speed. */
export const clipKey = (sentence: string, voice: string, speed: number) =>
	`${voice}|${speed.toFixed(2)}|${sentence}`;

/** A break after a comma, semicolon, colon or dash (and any closing quote), before a space. */
const PAUSE = /[,;:–—][”’"')\]]*\s+/gu;

/**
 * Where to split a sentence too long for the model: after a pause in its middle half nearest
 * the middle, or else at the start of the word nearest the middle. Undefined for one word.
 */
export function splitSentence(text: string): [string, string] | undefined {
	const middle = text.length / 2;
	const nearest = (points: number[]) =>
		points.reduce<number | undefined>(
			(best, point) =>
				best === undefined || Math.abs(point - middle) < Math.abs(best - middle)
					? point
					: best,
			undefined,
		);
	const pauses = [...text.matchAll(PAUSE)]
		.map((match) => (match.index ?? 0) + match[0].length)
		.filter(
			(point) =>
				point >= text.length / 4 &&
				point <= (text.length * 3) / 4 &&
				point < text.length,
		);
	const words = tokenize(text)
		.map((token) => token.start)
		.filter((start) => start > 0);
	const at = nearest(pauses) ?? nearest(words);
	return at === undefined ? undefined : [text.slice(0, at), text.slice(at)];
}

const emptyClip = (): Clip => ({
	samples: new Float32Array(0),
	sampleRate: SAMPLE_RATE,
	words: [],
});

/** Place each timed word at its Engine word's offset, `shift` characters and `delay` seconds on. */
function placed(text: string, made: Generated, shift: number, delay: number) {
	const tokens = tokenize(text);
	const count = Math.min(tokens.length, made.words.length);
	const words: ClipWord[] = [];
	for (let i = 0; i < count; i++) {
		const word = made.words[i] as Generated["words"][number];
		words.push({
			offset: (tokens[i] as { start: number }).start + shift,
			start: word.start + delay,
			end: word.end + delay,
		});
	}
	return words;
}

/**
 * Make `text`'s audio, splitting it in two (and again) wherever the model says it is too
 * long, and joining the pieces' audio and word times in order.
 */
async function make(
	generate: Generate,
	text: string,
	speed: number,
	signal: AbortSignal | undefined,
): Promise<Clip & { ms: number }> {
	try {
		const made = await generate(text, speed, signal);
		return {
			samples: made.samples,
			sampleRate: made.sampleRate,
			words: placed(text, made, 0, 0),
			ms: made.ms,
		};
	} catch (error) {
		if (codeOf(error) === "empty") return { ...emptyClip(), ms: 0 };
		if (codeOf(error) !== "too-long") throw error;
		const halves = splitSentence(text);
		if (!halves) throw error;
		const [head, tail] = halves;
		const first = await make(generate, head, speed, signal);
		const second = await make(generate, tail, speed, signal);
		const sampleRate = first.samples.length
			? first.sampleRate
			: second.sampleRate;
		const samples = new Float32Array(
			first.samples.length + second.samples.length,
		);
		samples.set(first.samples, 0);
		samples.set(second.samples, first.samples.length);
		const delay = first.samples.length / first.sampleRate;
		return {
			samples,
			sampleRate,
			words: [
				...first.words,
				...second.words.map((word) => ({
					offset: word.offset + head.length,
					start: word.start + delay,
					end: word.end + delay,
				})),
			],
			ms: first.ms + second.ms,
		};
	}
}

/** Sentences' audio in one voice, kept per sentence and speed in `cache`. */
export function createRenderer(options: {
	generate: Generate;
	cache: AudioCache;
	voice: string;
}): Render {
	const { generate, cache, voice } = options;
	return async (sentence, speed, signal) => {
		const key = clipKey(sentence, voice, speed);
		const kept = await cache.get(key);
		if (kept) return { ...kept, ms: 0, cached: true };
		const clip = await make(generate, sentence, speed, signal);
		if (clip.samples.length > 0) {
			await cache.put(key, {
				samples: clip.samples,
				sampleRate: clip.sampleRate,
				words: clip.words,
			});
		}
		return { ...clip, cached: false };
	};
}
