import type { Document } from "@speeedy/contracts";
import { computeOrp } from "./orp";
import { contextOf, tokenize } from "./tokenizer";
import type { EngineSettings, Frame, Timeline, TimelineOptions } from "./types";

export const DEFAULT_SETTINGS: EngineSettings = {
	wpm: 300,
	sentencePauseMultiplier: 2,
	paragraphPauseMultiplier: 1.8,
	commaAsPause: false,
	contextPauseOnClose: true,
};

const MIN_WPM = 1;
const MAX_WPM = 3000;
/** Extra time on the Frame that closes a bracket or quotation. */
const ASIDE_CLOSE_MULTIPLIER = 1.15;

const finiteOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && !Number.isNaN(value) ? value : fallback;

/** Closing marks that may follow the punctuation that ends a sentence: `."` `?)` `!»`. */
const CLOSING_MARKS = /[)\]}"'”’»›]+$/u;

/**
 * How much longer than a plain word a Frame stays up, by its last punctuation. Closing
 * quotes and brackets are looked through, so `stop."` ends a sentence.
 */
function pauseMultiplier(text: string, commaAsPause: boolean): number {
	const last = Array.from(text.replace(CLOSING_MARKS, "")).pop();
	switch (last) {
		case ".":
		case "!":
		case "?":
		case "…":
		case "。":
		case "！":
		case "？":
		case "؟":
			return 2;
		case ",":
		case ";":
		case "，":
		case "；":
			return commaAsPause ? 2 : 1.4;
		case ":":
		case "：":
			return 1.4;
		default:
			return 1;
	}
}

/**
 * Turn a Document into a Timeline of Frames, one per word. Pure and DOM-free, so it runs
 * in a Web Worker; the result is plain data.
 *
 * Image placeholders have no Frames: their alt text is not read.
 */
export function buildTimeline(
	document: Document,
	settings: Partial<EngineSettings> = {},
	options: TimelineOptions = {},
): Timeline {
	const wpm = Math.min(
		Math.max(finiteOr(settings.wpm, DEFAULT_SETTINGS.wpm), MIN_WPM),
		MAX_WPM,
	);
	const sentencePause = Math.max(
		finiteOr(
			settings.sentencePauseMultiplier,
			DEFAULT_SETTINGS.sentencePauseMultiplier,
		),
		0,
	);
	const paragraphPause = finiteOr(
		settings.paragraphPauseMultiplier,
		DEFAULT_SETTINGS.paragraphPauseMultiplier,
	);
	const commaAsPause = settings.commaAsPause ?? DEFAULT_SETTINGS.commaAsPause;
	const asidePause =
		settings.contextPauseOnClose ?? DEFAULT_SETTINGS.contextPauseOnClose;
	const baseMs = 60_000 / wpm;

	const frames: Frame[] = [];
	let totalMs = 0;

	document.blocks.forEach((block, blockIndex) => {
		if (block.kind === "image-placeholder") return;
		const tokens = tokenize(block.text, options.language);
		const contexts = contextOf(tokens);
		const firstBlockWithWords = frames.length === 0;

		tokens.forEach((token, i) => {
			const context = contexts[i];
			if (!context) return;
			const paragraphStart = i === 0 && !firstBlockWithWords;
			let duration =
				baseMs *
				(1 + (pauseMultiplier(token.text, commaAsPause) - 1) * sentencePause);
			if (paragraphStart && paragraphPause > 1) duration *= paragraphPause;
			if (asidePause && context.closesAside) duration *= ASIDE_CLOSE_MULTIPLIER;
			duration = Math.round(duration * 1000) / 1000;

			const orp = computeOrp(token.text);
			frames.push({
				text: token.text,
				position: { block: blockIndex, offset: token.start },
				end: { block: blockIndex, offset: token.end },
				orp,
				orpIndex: orp.before.length,
				startMs: totalMs,
				durationMs: duration,
				context: { paragraphStart, ...context },
			});
			totalMs += duration;
		});
	});

	return { frames, totalMs };
}
