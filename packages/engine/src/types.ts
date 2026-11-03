import type { Position } from "@speeedy/contracts";

/** The ORP split of a Frame's text: the pivot letter and what sits either side of it. */
export type Orp = {
	before: string;
	pivot: string;
	after: string;
};

/** Where a Frame sits relative to quotes, brackets and block starts. */
export type FrameContext = {
	/** First Frame of a block, other than the first block that has any. */
	paragraphStart: boolean;
	inQuotes: boolean;
	inParens: boolean;
	inBrackets: boolean;
	/** The Frame ends a parenthesis, bracket or quotation. */
	closesAside: boolean;
};

/**
 * One word on screen. Plain data, so a Timeline can cross a worker boundary with
 * `structuredClone` or `postMessage`.
 */
export type Frame = {
	/** The word with its attached punctuation. */
	text: string;
	/** Where the Frame starts in the Document. */
	position: Position;
	/** Where the Frame ends: the same block, just past the last character. */
	end: Position;
	orp: Orp;
	/** UTF-16 index of the pivot letter within `text`. */
	orpIndex: number;
	/** When the Frame appears, in milliseconds from the start of the Timeline. */
	startMs: number;
	durationMs: number;
	context: FrameContext;
};

export type Timeline = {
	frames: Frame[];
	totalMs: number;
};

/** The reading settings that shape a Timeline. Anything left out takes its default. */
export type EngineSettings = {
	wpm: number;
	/** How strongly sentence and comma punctuation stretches a Frame. 0 turns pauses off. */
	sentencePauseMultiplier: number;
	/** Extra time on the first Frame of a block. 1 means none. */
	paragraphPauseMultiplier: number;
	/** Pause on commas and semicolons like on a sentence end. */
	commaAsPause: boolean;
	/** A short extra pause on the Frame that closes a bracket or quotation. */
	contextPauseOnClose: boolean;
};

export type TimelineOptions = {
	/** BCP 47 language tag of the Document. Defaults to English. */
	language?: string;
};
