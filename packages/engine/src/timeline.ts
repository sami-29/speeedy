import {
	comparePositions,
	type Document,
	type Position,
} from "@speeedy/contracts";
import { computeOrp } from "./orp";
import { endsSentence, type PacingContext, pacingMultiplier } from "./pacing";
import { contextOf, tokenize } from "./tokenizer";
import type {
	EngineSettings,
	Frame,
	FrameContext,
	Timeline,
	TimelineOptions,
} from "./types";

export const DEFAULT_SETTINGS: EngineSettings = {
	wpm: 300,
	sentencePauseMultiplier: 2,
	paragraphPauseMultiplier: 1.8,
	commaAsPause: false,
	contextPauseOnClose: true,
	smartSpeed: false,
	chunkSize: 1,
	rampSpanWords: 0,
	rampStart: 0.5,
	sprintEveryWords: 0,
	sprintWords: 0,
	sprintSpeedup: 1.5,
};

const MIN_WPM = 1;
const MAX_WPM = 3000;
const MAX_CHUNK_SIZE = 10;

const finiteOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && !Number.isNaN(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

/** Fill in defaults and pull every setting into a range the rules can work with. */
export function resolveSettings(
	settings: Partial<EngineSettings> = {},
): EngineSettings {
	const sprintEveryWords = Math.max(
		Math.floor(finiteOr(settings.sprintEveryWords, 0)),
		0,
	);
	return {
		wpm: clamp(finiteOr(settings.wpm, DEFAULT_SETTINGS.wpm), MIN_WPM, MAX_WPM),
		sentencePauseMultiplier: Math.max(
			finiteOr(
				settings.sentencePauseMultiplier,
				DEFAULT_SETTINGS.sentencePauseMultiplier,
			),
			0,
		),
		paragraphPauseMultiplier: finiteOr(
			settings.paragraphPauseMultiplier,
			DEFAULT_SETTINGS.paragraphPauseMultiplier,
		),
		commaAsPause: settings.commaAsPause ?? DEFAULT_SETTINGS.commaAsPause,
		contextPauseOnClose:
			settings.contextPauseOnClose ?? DEFAULT_SETTINGS.contextPauseOnClose,
		smartSpeed: settings.smartSpeed ?? DEFAULT_SETTINGS.smartSpeed,
		chunkSize: clamp(
			Math.floor(finiteOr(settings.chunkSize, 1)),
			1,
			MAX_CHUNK_SIZE,
		),
		rampSpanWords: Math.max(Math.floor(finiteOr(settings.rampSpanWords, 0)), 0),
		rampStart: clamp(
			finiteOr(settings.rampStart, DEFAULT_SETTINGS.rampStart),
			0.1,
			1,
		),
		sprintEveryWords,
		sprintWords: clamp(
			Math.floor(finiteOr(settings.sprintWords, 0)),
			0,
			sprintEveryWords,
		),
		sprintSpeedup: clamp(
			finiteOr(settings.sprintSpeedup, DEFAULT_SETTINGS.sprintSpeedup),
			0.25,
			8,
		),
	};
}

const DOCUMENT_START: Position = { block: 0, offset: 0 };

/**
 * Build Frames from `startBlock` on, appended to the Frames already in `frames`.
 * `startOffset` is where in that block to begin. `wordsSinceAnchor` is how many words
 * `frames` already holds from the anchor onward. With `stopAfterWords`, building stops at
 * the first Frame that ends a sentence or a block once that many words have been built,
 * and `stopped` is true: both are places where every chunk size breaks, so the Frames
 * after the stop need not change when only the chunk size does.
 */
function buildFrom(
	document: Document,
	settings: EngineSettings,
	options: TimelineOptions,
	frames: Frame[],
	startBlock: number,
	startOffset: number,
	wordsSinceAnchor: number,
	stopAfterWords = Number.POSITIVE_INFINITY,
): Timeline & { stopped: boolean } {
	const anchor = options.anchor ?? DOCUMENT_START;
	const baseMs = 60_000 / settings.wpm;
	const pacing: PacingContext = { settings, wordsSinceAnchor: -1 };
	if (options.language !== undefined) pacing.language = options.language;
	const previous = frames[frames.length - 1];
	let totalMs = previous ? previous.startMs + previous.durationMs : 0;
	let counted = wordsSinceAnchor;
	let built = 0;
	let stopped = false;

	blocks: for (
		let blockIndex = startBlock;
		blockIndex < document.blocks.length;
		blockIndex++
	) {
		const block = document.blocks[blockIndex];
		if (!block || block.kind === "image-placeholder") continue;
		let cached = options.tokenCache?.get(blockIndex);
		if (!cached) {
			const tokens = tokenize(block.text, options.language);
			cached = { tokens, contexts: contextOf(tokens) };
			options.tokenCache?.set(blockIndex, cached);
		}
		const { tokens, contexts } = cached;
		let i = 0;
		if (blockIndex === startBlock) {
			i = tokens.findIndex((token) => token.start >= startOffset);
			if (i < 0) continue;
		}

		while (i < tokens.length) {
			let j = i;
			while (j < tokens.length && j - i < settings.chunkSize) {
				j++;
				if (endsSentence(tokens[j - 1]?.text ?? "")) break;
			}
			const first = tokens[i];
			const last = tokens[j - 1];
			const firstContext = contexts[i];
			const lastContext = contexts[j - 1];
			if (!first || !last || !firstContext || !lastContext) break;

			const words = j - i;
			const text =
				words === 1
					? first.text
					: tokens
							.slice(i, j)
							.map((token) => token.text)
							.join(" ");
			const context: FrameContext = {
				paragraphStart: i === 0 && frames.length > 0,
				inQuotes: firstContext.inQuotes,
				inParens: firstContext.inParens,
				inBrackets: firstContext.inBrackets,
				closesAside: lastContext.closesAside,
			};
			const position: Position = { block: blockIndex, offset: first.start };

			const reached = comparePositions(position, anchor) >= 0;
			pacing.wordsSinceAnchor = reached ? counted : -1;
			const multiplier = pacingMultiplier({ text, words, context }, pacing);
			const durationMs = Math.round(baseMs * words * multiplier * 1000) / 1000;
			if (reached) counted += words;

			const firstOrp = computeOrp(first.text);
			const orp =
				words === 1
					? firstOrp
					: {
							...firstOrp,
							after: firstOrp.after + text.slice(first.text.length),
						};
			frames.push({
				text,
				words,
				position,
				end: { block: blockIndex, offset: last.end },
				orp,
				orpIndex: orp.before.length,
				startMs: totalMs,
				durationMs,
				context,
			});
			totalMs += durationMs;
			built += words;
			i = j;
			if (
				built >= stopAfterWords &&
				(endsSentence(last.text) || i >= tokens.length)
			) {
				stopped = true;
				break blocks;
			}
		}
	}

	return { frames, totalMs, stopped };
}

/**
 * Turn a Document into a Timeline of Frames, one per chunk of words. Pure and DOM-free, so
 * it runs in a Web Worker; the result is plain data.
 *
 * Image placeholders have no Frames: their alt text is not read.
 */
export function buildTimeline(
	document: Document,
	settings: Partial<EngineSettings> = {},
	options: TimelineOptions = {},
): Timeline {
	const { frames, totalMs } = buildFrom(
		document,
		resolveSettings(settings),
		options,
		[],
		0,
		0,
		0,
	);
	return { frames, totalMs };
}

/** Where a rebuild from `fromIndex` starts: the Frames kept and how far into the anchor they run. */
function rebuildStart(
	timeline: Timeline,
	fromIndex: number,
	options: TimelineOptions,
) {
	const index = Math.max(fromIndex, 0);
	const at = timeline.frames[index];
	if (!at) return undefined;
	const anchor = options.anchor ?? DOCUMENT_START;
	// Frames are in Position order, so the first one at or after the anchor is a binary search away.
	let low = 0;
	let high = index;
	while (low < high) {
		const middle = (low + high) >> 1;
		const frame = timeline.frames[middle] as Frame;
		if (comparePositions(frame.position, anchor) < 0) low = middle + 1;
		else high = middle;
	}
	let wordsSinceAnchor = 0;
	for (let k = low; k < index; k++) {
		wordsSinceAnchor += (timeline.frames[k] as Frame).words;
	}
	return { index, at, wordsSinceAnchor };
}

/**
 * Rebuild a Timeline from the Frame at `fromIndex` onward, for new settings. The Frames
 * before it are kept as they are, so the Frame at `fromIndex` starts at the same Position
 * and the same time, and a reader's place does not move.
 */
export function rebuildTimeline(
	document: Document,
	timeline: Timeline,
	fromIndex: number,
	settings: Partial<EngineSettings> = {},
	options: TimelineOptions = {},
): Timeline {
	const start = rebuildStart(timeline, fromIndex, options);
	if (!start) {
		return { frames: timeline.frames.slice(), totalMs: timeline.totalMs };
	}
	const { frames, totalMs } = buildFrom(
		document,
		resolveSettings(settings),
		options,
		timeline.frames.slice(0, start.index),
		start.at.position.block,
		start.at.position.offset,
		start.wordsSinceAnchor,
	);
	return { frames, totalMs };
}

/**
 * The first Frames of a rebuild from `fromIndex`, enough to cover `minWords` words and
 * then on to the end of a sentence or block: the Frames `rebuildTimeline` would give from
 * `fromIndex`, and no more. `complete` says the window reached the end of the Document.
 * Quick on any Document, because it builds only the window.
 */
export function rebuildWindow(
	document: Document,
	timeline: Timeline,
	fromIndex: number,
	settings: Partial<EngineSettings>,
	options: TimelineOptions,
	minWords: number,
): { frames: Frame[]; complete: boolean } {
	const start = rebuildStart(timeline, fromIndex, options);
	if (!start) return { frames: [], complete: true };
	const { frames, stopped } = buildFrom(
		document,
		resolveSettings(settings),
		options,
		timeline.frames.slice(0, start.index),
		start.at.position.block,
		start.at.position.offset,
		start.wordsSinceAnchor,
		minWords,
	);
	return { frames: frames.slice(start.index), complete: !stopped };
}
