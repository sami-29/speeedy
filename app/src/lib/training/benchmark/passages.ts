export interface BenchmarkQuestion {
	q: string;
	options: string[];
	correct: number;
}

export interface BenchmarkPassage {
	id: string;
	title: string;
	text: string;
	questions: BenchmarkQuestion[];
}

export const BENCHMARK_PASSAGES: readonly BenchmarkPassage[] = [];
