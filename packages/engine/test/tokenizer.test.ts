import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/index";
import { framesOf, paragraphs, wordsOf } from "./helpers";

describe("tokenizer", () => {
	it("splits plain text into one Frame per word", () => {
		expect(wordsOf("Hello world")).toEqual(["Hello", "world"]);
	});

	it("keeps contractions and decimals as single words", () => {
		expect(wordsOf("don't pay 3.50 now")).toEqual([
			"don't",
			"pay",
			"3.50",
			"now",
		]);
	});

	it("gives an empty text no Frames", () => {
		expect(wordsOf("")).toEqual([]);
		expect(wordsOf("   \n  ")).toEqual([]);
	});

	describe("opening punctuation attaches to the next word", () => {
		it("quotes", () => {
			expect(wordsOf('He said "stop" now')).toEqual([
				"He",
				"said",
				'"stop"',
				"now",
			]);
		});

		it("parentheses after sentence punctuation", () => {
			expect(wordsOf("what?(yes) ok")).toEqual(["what?", "(yes)", "ok"]);
		});

		it("currency signs", () => {
			expect(wordsOf("It cost $3.50, wait")).toEqual([
				"It",
				"cost",
				"$3.50,",
				"wait",
			]);
		});

		it("opening Slavic and guillemet quotes", () => {
			expect(wordsOf("Powiedział „stop” teraz »tak«")).toEqual([
				"Powiedział",
				"„stop”",
				"teraz",
				"»tak«",
			]);
		});

		it("punctuation at the very start of a block", () => {
			expect(wordsOf('"Hello" she said')).toEqual(['"Hello"', "she", "said"]);
		});
	});

	describe("hyphens and dashes", () => {
		it("a hyphenated word splits after the hyphen", () => {
			expect(wordsOf("A well-known fact")).toEqual([
				"A",
				"well-",
				"known",
				"fact",
			]);
		});

		it("an em dash stays with the word before it", () => {
			expect(wordsOf("wait—what")).toEqual(["wait—", "what"]);
			expect(wordsOf("wait — what")).toEqual(["wait—", "what"]);
		});
	});

	describe("context does not drift after hyphens (1.x regression)", () => {
		const frames = framesOf('A well-known fact (really) is "true". Then more');
		const byText = (text: string) => {
			const frame = frames.find((candidate) => candidate.text === text);
			if (!frame) throw new Error(`no frame ${text}`);
			return frame.context;
		};

		it("marks only the parenthesised word as inside parentheses", () => {
			expect(byText("(really)").inParens).toBe(true);
			expect(byText("known").inParens).toBe(false);
			expect(byText("fact").inParens).toBe(false);
			expect(byText("is").inParens).toBe(false);
		});

		it("marks only the quoted word as inside quotes", () => {
			expect(byText('"true".').inQuotes).toBe(true);
			expect(byText("is").inQuotes).toBe(false);
			expect(byText("Then").inQuotes).toBe(false);
			expect(byText("more").inQuotes).toBe(false);
		});
	});

	describe("context", () => {
		it("marks every word inside quotes, parentheses and brackets", () => {
			expect(
				framesOf('"Hello big world"').every((frame) => frame.context.inQuotes),
			).toBe(true);
			expect(
				framesOf("(aside here)").every((frame) => frame.context.inParens),
			).toBe(true);
			expect(
				framesOf("[note here]").every((frame) => frame.context.inBrackets),
			).toBe(true);
		});

		it("does not treat an apostrophe inside a word as a quote", () => {
			expect(
				framesOf("don't stop").some((frame) => frame.context.inQuotes),
			).toBe(false);
		});

		it("resets at each block", () => {
			const { frames } = buildTimeline(
				paragraphs('"unclosed quote', "plain text"),
			);
			expect(frames.map((frame) => frame.context.inQuotes)).toEqual([
				true,
				true,
				false,
				false,
			]);
		});

		it("marks the word that closes an aside", () => {
			const frames = framesOf("see (this one) now");
			expect(frames.map((frame) => frame.context.closesAside)).toEqual([
				false,
				false,
				true,
				false,
			]);
		});
	});

	describe("Intl.Segmenter with the document language", () => {
		it("segments text without spaces by language", () => {
			expect(
				wordsOf("我喜欢阅读", {}, { language: "zh" }).length,
			).toBeGreaterThan(1);
		});

		it("falls back instead of throwing on an invalid language tag", () => {
			expect(wordsOf("Hello world", {}, { language: "not a tag!" })).toEqual([
				"Hello",
				"world",
			]);
		});
	});
});
