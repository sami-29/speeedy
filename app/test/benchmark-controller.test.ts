import { describe, expect, it } from "vitest";
import { createBenchmark } from "../src/lib/training/benchmark/controller.ts";
import type { BenchmarkPassage } from "../src/lib/training/benchmark/passages.ts";

const words = (n: number, prefix: string) =>
	Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

const question = (n: number) => ({
	q: `Question ${n}?`,
	options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`],
	correct: n % 4,
});

const passage = (id: string): BenchmarkPassage => ({
	id,
	title: `Passage ${id}`,
	text: `${words(60, `${id}x`)}\n\n${words(40, `${id}y`)}`,
	questions: [question(0), question(1), question(2), question(3)],
});

/** A repeatable stand-in for Math.random. */
const seeded = (seed: number) => () => {
	seed = (seed * 1664525 + 1013904223) % 4294967296;
	return seed / 4294967296;
};

const setup = (passages = [passage("A"), passage("B")]) => {
	const clock = { t: 100_000 };
	const bench = createBenchmark({
		passages,
		now: () => clock.t,
		random: seeded(7),
	});
	return { clock, bench };
};

/** Answers every question as the key says. */
const answerRight = (bench: ReturnType<typeof setup>["bench"]) => {
	for (const [i, q] of bench.state().questions.entries()) {
		bench.answer(i, q.correct);
	}
};

describe("the Benchmark flow", () => {
	it("starts on the intro and shows no passage until Start", () => {
		const { bench } = setup();
		expect(bench.state()).toMatchObject({
			phase: "intro",
			passage: null,
			questions: [],
			result: null,
		});
	});

	it("opens the passage in paragraphs on Start, with its word count", () => {
		const { bench } = setup();
		bench.start();
		const state = bench.state();
		expect(state.phase).toBe("reading");
		expect(state.passage?.paragraphs).toHaveLength(2);
		expect(state.passage?.words).toBe(100);
	});

	it("does not ask the questions while the passage is on screen", () => {
		const { bench } = setup();
		bench.start();
		expect(bench.state().questions).toEqual([]);
	});

	it("times from the press of Start to the press of Done", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		expect(bench.state().phase).toBe("quiz");
		answerRight(bench);
		clock.t += 600_000;
		// 100 words in 30 seconds: the minutes spent on the quiz do not count.
		expect(bench.submit()?.wpm).toBe(200);
	});

	it("ignores Done before Start and a second Done", () => {
		const { clock, bench } = setup();
		bench.finishReading();
		expect(bench.state().phase).toBe("intro");
		bench.start();
		clock.t += 20_000;
		bench.finishReading();
		clock.t += 20_000;
		bench.finishReading();
		answerRight(bench);
		expect(bench.submit()?.wpm).toBe(300);
	});

	it("ignores a second Start while reading, so the timer cannot be reset", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 20_000;
		bench.start();
		clock.t += 10_000;
		bench.finishReading();
		answerRight(bench);
		expect(bench.submit()?.wpm).toBe(200);
	});

	it("asks every question with four options", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		expect(bench.state().questions).toHaveLength(4);
		expect(bench.state().answers).toEqual([null, null, null, null]);
		for (const q of bench.state().questions) expect(q.options).toHaveLength(4);
	});

	it("keeps the right answer under its text when the options are shuffled", () => {
		const { clock, bench } = setup([passage("A")]);
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		const asked = bench.state().questions;
		for (const [i, q] of asked.entries()) {
			expect(q.options[q.correct]).toBe(`${"abcd"[i % 4]}${i}`);
			expect([...q.options].sort()).toEqual(
				[`a${i}`, `b${i}`, `c${i}`, `d${i}`].sort(),
			);
		}
	});

	it("shuffles the options, so the answers are not always in the same places", () => {
		const { clock, bench } = setup([passage("A")]);
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		const keys = bench.state().questions.map((q) => q.correct);
		expect(keys).not.toEqual([0, 1, 2, 3]);
	});

	it("takes an answer, and a changed answer replaces it", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		bench.answer(2, 1);
		expect(bench.state().answers).toEqual([null, null, 1, null]);
		bench.answer(2, 3);
		expect(bench.state().answers).toEqual([null, null, 3, null]);
	});

	it("ignores an answer for a question or option that is not there", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		bench.answer(9, 0);
		bench.answer(-1, 0);
		bench.answer(0, 4);
		bench.answer(0, -1);
		bench.answer(0, 1.5);
		expect(bench.state().answers).toEqual([null, null, null, null]);
	});

	it("will not submit until every question is answered", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		bench.answer(0, 0);
		expect(bench.submit()).toBeUndefined();
		expect(bench.state().phase).toBe("quiz");
		expect(bench.state().result).toBeNull();
	});

	it("scores the answers and reports WPM and comprehension", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 60_000;
		bench.finishReading();
		const asked = bench.state().questions;
		// Two right, two wrong.
		bench.answer(0, asked[0]?.correct ?? 0);
		bench.answer(1, asked[1]?.correct ?? 0);
		bench.answer(2, ((asked[2]?.correct ?? 0) + 1) % 4);
		bench.answer(3, ((asked[3]?.correct ?? 0) + 1) % 4);
		const result = bench.submit();
		expect(result).toEqual({
			wpm: 100,
			comprehension: 50,
			correct: 2,
			questions: 4,
			words: 100,
		});
		expect(bench.state().phase).toBe("results");
		expect(bench.state().result).toEqual(result);
	});

	it("gives the result once: a second submit changes nothing", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 60_000;
		bench.finishReading();
		answerRight(bench);
		const first = bench.submit();
		expect(first).toBeDefined();
		expect(bench.submit()).toBeUndefined();
	});

	it("goes back to the intro for another try", () => {
		const { clock, bench } = setup();
		bench.start();
		clock.t += 30_000;
		bench.finishReading();
		answerRight(bench);
		bench.submit();
		bench.again();
		expect(bench.state()).toMatchObject({
			phase: "intro",
			passage: null,
			questions: [],
			result: null,
		});
	});

	it("starts each try on a different passage from the one before", () => {
		const { clock, bench } = setup([passage("A"), passage("B"), passage("C")]);
		let last = "";
		for (let round = 0; round < 8; round++) {
			bench.start();
			const id = bench.state().passage?.id ?? "";
			expect(id).not.toBe(last);
			last = id;
			clock.t += 30_000;
			bench.finishReading();
			answerRight(bench);
			bench.submit();
			bench.again();
		}
	});

	it("can only repeat the passage when there is just one", () => {
		const { bench } = setup([passage("only")]);
		bench.start();
		expect(bench.state().passage?.id).toBe("only");
	});
});
