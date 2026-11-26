import { localDate } from "@speeedy/engine";
import type { TrainingResult } from "../../library/store.ts";
import type { SpeedZoneId } from "../../reader/zones.ts";
import { zoneFor } from "../../reader/zones.ts";
import type { BenchmarkResult } from "./controller.ts";

/** The `kind` of a Training result the Benchmark saves. */
export const BENCHMARK_KIND = "benchmark";

/** How many results the chart plots. */
export const TREND_POINTS = 20;
/** How many results the table lists. */
export const TREND_ROWS = 10;

export type TrendPoint = {
	id: string;
	date: string;
	wpm: number;
	band: SpeedZoneId;
};
export type TrendRow = {
	id: string;
	date: string;
	wpm: number;
	comprehension: number;
};
export type BenchmarkTrend = {
	/** Every Benchmark result on the device. */
	count: number;
	/** The latest results, oldest first, for the chart. */
	points: TrendPoint[];
	/** The latest results, newest first, for the table. */
	rows: TrendRow[];
};

/** Saves one result as a Training result. Nothing is ever dropped to make room. */
export async function saveBenchmarkResult(
	store: {
		addTrainingResult(result: {
			kind: string;
			scores: Record<string, number>;
		}): Promise<unknown>;
	},
	result: BenchmarkResult,
): Promise<void> {
	await store.addTrainingResult({
		kind: BENCHMARK_KIND,
		scores: {
			wpm: result.wpm,
			comprehension: result.comprehension,
			correct: result.correct,
			questions: result.questions,
			words: result.words,
		},
	});
}

const isScore = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The Benchmark results among Training results, shaped for the chart and the table. */
export function buildBenchmarkTrend(results: TrainingResult[]): BenchmarkTrend {
	const read = results
		.filter((each) => each.kind === BENCHMARK_KIND)
		.flatMap((each) => {
			const { wpm, comprehension } = each.scores;
			if (!isScore(wpm) || !isScore(comprehension)) return [];
			return [
				{
					id: each.id,
					at: each.completedAt,
					date: localDate(each.completedAt),
					wpm,
					comprehension,
				},
			];
		})
		.sort((a, b) => a.at - b.at);

	const latest = read.slice(-TREND_POINTS);
	return {
		count: read.length,
		points: latest.map((each) => ({
			id: each.id,
			date: each.date,
			wpm: each.wpm,
			band: zoneFor(each.wpm).id,
		})),
		rows: read
			.slice(-TREND_ROWS)
			.reverse()
			.map((each) => ({
				id: each.id,
				date: each.date,
				wpm: each.wpm,
				comprehension: each.comprehension,
			})),
	};
}
