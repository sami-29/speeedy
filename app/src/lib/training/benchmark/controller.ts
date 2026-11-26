import type { BenchmarkPassage, BenchmarkQuestion } from "./passages.ts";

export type Phase = "intro" | "reading" | "quiz" | "results";

export type BenchmarkResult = {
	wpm: number;
	comprehension: number;
	correct: number;
	questions: number;
	words: number;
};

export type BenchmarkState = {
	phase: Phase;
	/** The passage being read. It is set from Start, so nothing shows it before. */
	passage: {
		id: string;
		title: string;
		paragraphs: string[];
		words: number;
	} | null;
	/** The questions with their options in the order shown. */
	questions: BenchmarkQuestion[];
	answers: (number | null)[];
	result: BenchmarkResult | null;
};

export type Benchmark = {
	state(): BenchmarkState;
	start(): void;
	finishReading(): void;
	answer(question: number, option: number): void;
	submit(): BenchmarkResult | undefined;
	again(): void;
};

export function createBenchmark(_options: {
	passages: readonly BenchmarkPassage[];
	now: () => number;
	random: () => number;
}): Benchmark {
	throw new Error("not implemented");
}
