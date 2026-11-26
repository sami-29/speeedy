import type { BenchmarkPassage, BenchmarkQuestion } from "./passages.ts";
import { comprehensionScore, countWords, wordsPerMinute } from "./score.ts";

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
	/** The questions with their options in the order shown. Empty until the quiz. */
	questions: BenchmarkQuestion[];
	answers: (number | null)[];
	result: BenchmarkResult | null;
};

export type Benchmark = {
	state(): BenchmarkState;
	/** Opens the passage and starts the timer. */
	start(): void;
	/** Stops the timer and opens the questions. */
	finishReading(): void;
	answer(question: number, option: number): void;
	/** Scores the answers once every question has one. */
	submit(): BenchmarkResult | undefined;
	/** Back to the intro; the next Start picks another passage. */
	again(): void;
};

/** Fisher-Yates, so the right answer is not always in the same place. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.min(i, Math.floor(random() * (i + 1)));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

/** The questions with their options mixed, each `correct` pointing at the same text. */
function askable(
	questions: readonly BenchmarkQuestion[],
	random: () => number,
): BenchmarkQuestion[] {
	return questions.map((question) => {
		const order = shuffled(
			question.options.map((_, index) => index),
			random,
		);
		return {
			q: question.q,
			options: order.map((index) => question.options[index] as string),
			correct: order.indexOf(question.correct),
		};
	});
}

export function createBenchmark(options: {
	passages: readonly BenchmarkPassage[];
	now: () => number;
	random: () => number;
}): Benchmark {
	const { passages, now, random } = options;
	let phase: Phase = "intro";
	let current: BenchmarkPassage | null = null;
	let lastId: string | null = null;
	let questions: BenchmarkQuestion[] = [];
	let answers: (number | null)[] = [];
	let result: BenchmarkResult | null = null;
	let startedAt = 0;
	let elapsedMs = 0;

	const pick = (): BenchmarkPassage => {
		const others = passages.filter((passage) => passage.id !== lastId);
		const pool = others.length > 0 ? others : passages;
		const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
		return pool[index] as BenchmarkPassage;
	};

	return {
		state() {
			return {
				phase,
				passage: current
					? {
							id: current.id,
							title: current.title,
							paragraphs: current.text
								.split(/\n\s*\n/)
								.map((paragraph) => paragraph.trim())
								.filter(Boolean),
							words: countWords(current.text),
						}
					: null,
				questions,
				answers,
				result,
			};
		},

		start() {
			if (phase !== "intro" || passages.length === 0) return;
			current = pick();
			lastId = current.id;
			phase = "reading";
			startedAt = now();
		},

		finishReading() {
			if (phase !== "reading" || !current) return;
			elapsedMs = now() - startedAt;
			questions = askable(current.questions, random);
			answers = questions.map(() => null);
			phase = "quiz";
		},

		answer(question, option) {
			if (phase !== "quiz") return;
			const asked = questions[question];
			if (!asked || !Number.isInteger(option)) return;
			if (option < 0 || option >= asked.options.length) return;
			answers = answers.map((each, i) => (i === question ? option : each));
		},

		submit() {
			if (phase !== "quiz" || !current) return undefined;
			if (answers.some((each) => each === null)) return undefined;
			const correct = answers.filter(
				(each, i) => each === questions[i]?.correct,
			).length;
			const words = countWords(current.text);
			result = {
				wpm: wordsPerMinute(words, elapsedMs),
				comprehension: comprehensionScore(correct, questions.length),
				correct,
				questions: questions.length,
				words,
			};
			phase = "results";
			return result;
		},

		again() {
			phase = "intro";
			current = null;
			questions = [];
			answers = [];
			result = null;
		},
	};
}
