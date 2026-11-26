import { describe, expect, it } from "vitest";
import { BENCHMARK_PASSAGES } from "../src/lib/training/benchmark/passages.ts";
import {
	comprehensionScore,
	countWords,
	MIN_READING_MS,
	rangeStanding,
	wordsPerMinute,
} from "../src/lib/training/benchmark/score.ts";

describe("counting words", () => {
	it("counts runs between spaces, however they are spaced", () => {
		expect(countWords("one two  three\n\nfour\tfive")).toBe(5);
		expect(countWords("")).toBe(0);
		expect(countWords("  \n ")).toBe(0);
	});

	it("counts a word with an apostrophe, a hyphen or a number as one", () => {
		expect(countWords("Earth's well-known 2,000 metres")).toBe(4);
	});

	it("does not count a dash that stands alone", () => {
		expect(countWords("deep - dark — cold")).toBe(3);
	});
});

describe("words per minute", () => {
	it("is words over minutes, rounded", () => {
		expect(wordsPerMinute(300, 60_000)).toBe(300);
		expect(wordsPerMinute(238, 60_000)).toBe(238);
		expect(wordsPerMinute(300, 70_000)).toBe(257);
		expect(wordsPerMinute(100, 30_000)).toBe(200);
	});

	it("times a read faster than 6 seconds as 6 seconds, so a stray double press is not 40,000 WPM", () => {
		expect(MIN_READING_MS).toBe(6000);
		expect(wordsPerMinute(300, 1_000)).toBe(3000);
		expect(wordsPerMinute(300, 0)).toBe(3000);
	});

	it("gives 0 for a clock that went backwards or a passage with no words", () => {
		expect(wordsPerMinute(300, -5_000)).toBe(3000);
		expect(wordsPerMinute(0, 60_000)).toBe(0);
	});
});

describe("comprehension", () => {
	it("is the share answered right, as a whole percentage", () => {
		expect(comprehensionScore(7, 10)).toBe(70);
		expect(comprehensionScore(0, 10)).toBe(0);
		expect(comprehensionScore(10, 10)).toBe(100);
		expect(comprehensionScore(3, 7)).toBe(43);
	});

	it("is 0 when there are no questions", () => {
		expect(comprehensionScore(0, 0)).toBe(0);
	});
});

describe("standing against the adult range", () => {
	it("splits at Brysbaert's 175 and 300 words per minute, both inside the range", () => {
		expect(rangeStanding(174)).toBe("below");
		expect(rangeStanding(175)).toBe("within");
		expect(rangeStanding(238)).toBe("within");
		expect(rangeStanding(300)).toBe("within");
		expect(rangeStanding(301)).toBe("above");
	});
});

describe("the built-in passages", () => {
	it("has five passages with their own ids and titles", () => {
		expect(BENCHMARK_PASSAGES).toHaveLength(5);
		expect(new Set(BENCHMARK_PASSAGES.map((p) => p.id)).size).toBe(5);
		expect(new Set(BENCHMARK_PASSAGES.map((p) => p.title)).size).toBe(5);
	});

	it("is a read of about 300 words, counted with one rule", () => {
		for (const passage of BENCHMARK_PASSAGES) {
			const words = countWords(passage.text);
			expect(words, passage.id).toBeGreaterThanOrEqual(280);
			expect(words, passage.id).toBeLessThanOrEqual(320);
		}
	});

	it("carries no word count of its own to drift from the text", () => {
		for (const passage of BENCHMARK_PASSAGES) {
			expect(Object.keys(passage).sort()).toEqual([
				"id",
				"questions",
				"text",
				"title",
			]);
		}
	});

	it("asks ten questions with four distinct options and one right answer each", () => {
		for (const passage of BENCHMARK_PASSAGES) {
			expect(passage.questions, passage.id).toHaveLength(10);
			for (const question of passage.questions) {
				expect(question.q.trim()).not.toBe("");
				expect(question.options).toHaveLength(4);
				expect(new Set(question.options).size).toBe(4);
				expect(Number.isInteger(question.correct)).toBe(true);
				expect(question.options[question.correct]).toBeDefined();
			}
		}
	});
});
