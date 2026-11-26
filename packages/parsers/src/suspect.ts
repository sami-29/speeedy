import { ParseFailure } from "./types";

/**
 * Decides whether text pulled out of a legacy word-processor file looks broken, so the reader
 * can say so and offer a paste box instead of showing scrambled letters.
 *
 * It counts, over the non-space characters, three kinds of sign that a decoder guessed wrong:
 * - replacement characters (U+FFFD), private-use characters (U+E000 to U+F8FF, where symbol
 *   fonts put their glyphs) and C1 control characters (U+0080 to U+009F, what a Windows code
 *   page leaves undefined);
 * - question marks, which converters write for every character they could not map.
 *
 * Thresholds, set from the fixture corpus (clean text in five scripts has none of these, a
 * document with a few Symbol-font bullets has under 3 percent):
 * - at least 4 of the first kind and more than 10 percent of all characters, or
 * - at least 8 question marks and more than half of all characters.
 */
const BAD_MIN = 4;
const BAD_SHARE = 0.1;
const QUESTION_MIN = 8;
const QUESTION_SHARE = 0.5;

export class SuspectCounter {
	private total = 0;
	private bad = 0;
	private question = 0;

	/** Count the characters of `text`, taken as decoded and before any clean-up. */
	add(text: string): void {
		let total = 0;
		let bad = 0;
		let question = 0;
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (code <= 32 || code === 0xa0) continue;
			total++;
			if (
				code === 0xfffd ||
				(code >= 0xe000 && code <= 0xf8ff) ||
				(code >= 0x80 && code <= 0x9f)
			) {
				bad++;
			} else if (code === 63) {
				question++;
			}
		}
		this.total += total;
		this.bad += bad;
		this.question += question;
	}

	get suspect(): boolean {
		if (this.total === 0) return false;
		return (
			(this.bad >= BAD_MIN && this.bad / this.total > BAD_SHARE) ||
			(this.question >= QUESTION_MIN &&
				this.question / this.total > QUESTION_SHARE)
		);
	}
}

/** The error to raise when text looks broken. The message tells the reader what to do. */
export function brokenTextFailure(kind: "RTF" | "Word"): ParseFailure {
	return new ParseFailure(
		"encoding-suspect",
		`The text in this ${kind} file looks scrambled. Open it in a word processor, copy the text and paste it here instead.`,
	);
}
