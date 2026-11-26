import type { TrainingResult } from "../../library/store.ts";
import type { BenchmarkResult } from "./controller.ts";

export const BENCHMARK_KIND = "benchmark";

export type TrendPoint = {
	id: string;
	date: string;
	wpm: number;
	band: "study" | "read" | "skim";
};
export type TrendRow = {
	id: string;
	date: string;
	wpm: number;
	comprehension: number;
};
export type BenchmarkTrend = {
	count: number;
	/** The latest results, oldest first, for the chart. */
	points: TrendPoint[];
	/** The latest results, newest first, for the table. */
	rows: TrendRow[];
};

export async function saveBenchmarkResult(
	_store: {
		addTrainingResult(result: {
			kind: string;
			scores: Record<string, number>;
		}): Promise<unknown>;
	},
	_result: BenchmarkResult,
): Promise<void> {
	throw new Error("not implemented");
}

export function buildBenchmarkTrend(
	_results: TrainingResult[],
): BenchmarkTrend {
	throw new Error("not implemented");
}
