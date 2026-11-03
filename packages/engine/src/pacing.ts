import type { EngineSettings, Frame } from "./types";

/** What a pacing rule looks at in a Frame. */
export type PacingFrame = Pick<Frame, "text" | "words" | "context">;

export type PacingContext = {
	settings: EngineSettings;
	/** BCP 47 language tag of the Document, if known. */
	language?: string;
	/**
	 * Words read since the reader last pressed play, before this Frame. Negative for a Frame
	 * before that point, which the ramp and sprints leave alone.
	 */
	wordsSinceAnchor: number;
};

/**
 * A pacing rule: how much longer than its base time a Frame stays up. 1 changes nothing,
 * 2 doubles it, 0.5 halves it. Rules are pure, so each is tested alone.
 */
export type PacingRule = (frame: PacingFrame, context: PacingContext) => number;

/** Closing marks that may follow the punctuation that ends a sentence: `."` `?)` `!»`. */
const CLOSING_MARKS = /[)\]}"'”’»›]+$/u;

const SENTENCE_END = /[.!?…。！？؟]$/u;

/** The last word of a Frame, with its punctuation. */
const lastWord = (text: string): string =>
	text.slice(text.lastIndexOf(" ") + 1);

/** Whether a word ends a sentence, looking through closing quotes and brackets. */
export function endsSentence(word: string): boolean {
	return SENTENCE_END.test(word.replace(CLOSING_MARKS, ""));
}

/** How much longer a word stays up for its last punctuation, before the setting scales it. */
function punctuationWeight(word: string, commaAsPause: boolean): number {
	const bare = word.replace(CLOSING_MARKS, "");
	if (SENTENCE_END.test(bare)) return 2;
	switch (Array.from(bare).pop()) {
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

/** English words of four letters or more that are read as fast as short ones. */
const COMMON_ENGLISH = new Set([
	"that",
	"this",
	"with",
	"from",
	"have",
	"were",
	"been",
	"they",
	"them",
	"then",
	"than",
	"when",
	"what",
	"will",
	"your",
	"into",
	"their",
	"there",
	"which",
	"about",
	"would",
	"could",
]);

const isEnglish = (language: string | undefined): boolean =>
	language === undefined || /^en(?:-|$)/iu.test(language);

/** Duration multiplier for one word under smart speed. */
function wordSpeed(word: string, english: boolean): number {
	const letters = word.replace(/[^\p{L}\p{N}]/gu, "");
	const length = Array.from(letters).length;
	if (length <= 3 || (english && COMMON_ENGLISH.has(letters.toLowerCase()))) {
		return 1 / 1.3;
	}
	if (length >= 8) return 1 / 0.75;
	if (length >= 6) return 1 / 0.9;
	return 1;
}

/** Short and common words go by faster, long words slower. Averaged over a chunk. */
export const smartSpeedRule: PacingRule = (frame, { settings, language }) => {
	if (!settings.smartSpeed) return 1;
	const english = isEnglish(language);
	const words = frame.text.split(" ");
	let total = 0;
	for (const word of words) total += wordSpeed(word, english);
	return total / words.length;
};

/** Extra time on the Frame that closes a bracket or quotation. */
const ASIDE_CLOSE_MULTIPLIER = 1.15;

/** Sentence and comma pauses, the pause at a paragraph start, and the pause on closing an aside. */
export const punctuationRule: PacingRule = (frame, { settings }) => {
	const sentencePause = Math.max(settings.sentencePauseMultiplier, 0);
	let multiplier =
		1 +
		(punctuationWeight(lastWord(frame.text), settings.commaAsPause) - 1) *
			sentencePause;
	if (frame.context.paragraphStart && settings.paragraphPauseMultiplier > 1) {
		multiplier *= settings.paragraphPauseMultiplier;
	}
	if (settings.contextPauseOnClose && frame.context.closesAside) {
		multiplier *= ASIDE_CLOSE_MULTIPLIER;
	}
	return multiplier;
};

/** Starts at `rampStart` of full speed and builds linearly to full speed over the span. */
export const rampRule: PacingRule = (
	_frame,
	{ settings, wordsSinceAnchor },
) => {
	const { rampSpanWords, rampStart } = settings;
	if (rampSpanWords <= 0 || wordsSinceAnchor < 0) return 1;
	const progress = Math.min(wordsSinceAnchor / rampSpanWords, 1);
	return 1 / (rampStart + (1 - rampStart) * progress);
};

/** Reads the last words of every sprint period faster. */
export const sprintRule: PacingRule = (
	_frame,
	{ settings, wordsSinceAnchor },
) => {
	const { sprintEveryWords, sprintWords, sprintSpeedup } = settings;
	if (sprintEveryWords <= 0 || wordsSinceAnchor < 0) return 1;
	const place = wordsSinceAnchor % sprintEveryWords;
	return place >= sprintEveryWords - sprintWords ? 1 / sprintSpeedup : 1;
};

/** Every rule, in the order they combine: smart speed, punctuation, ramp, sprints. */
export const PACING_RULES: readonly PacingRule[] = [
	smartSpeedRule,
	punctuationRule,
	rampRule,
	sprintRule,
];

/** The rules' multipliers multiplied together. */
export function pacingMultiplier(
	frame: PacingFrame,
	context: PacingContext,
): number {
	let multiplier = 1;
	for (const rule of PACING_RULES) multiplier *= rule(frame, context);
	return multiplier;
}
