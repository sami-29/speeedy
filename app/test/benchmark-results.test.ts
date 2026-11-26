import "fake-indexeddb/auto";
import { RegistryError } from "@speeedy/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLibraryStore,
	LIBRARY_DB_NAME,
	type LibraryStore,
} from "../src/lib/library/store.ts";
import {
	BENCHMARK_KIND,
	buildBenchmarkTrend,
	saveBenchmarkResult,
} from "../src/lib/training/benchmark/results.ts";
import { trainingDrills } from "../src/lib/training/registry.ts";

let counter = 0;
let clock = 0;
let store: LibraryStore;

beforeEach(() => {
	clock = new Date(2026, 10, 3, 12).getTime();
	store = createLibraryStore({
		name: `${LIBRARY_DB_NAME}-benchmark-${++counter}`,
		now: () => clock,
	});
});

afterEach(() => store.close());

const result = (wpm: number, comprehension = 80) => ({
	wpm,
	comprehension,
	correct: comprehension / 10,
	questions: 10,
	words: 300,
});

describe("the Benchmark is a registered drill", () => {
	it("registers as a drill with its own id and analytics value", () => {
		const benchmark = trainingDrills.get("benchmark");
		expect(benchmark).toMatchObject({
			kind: "drill",
			id: "benchmark",
			analyticsValue: "benchmark",
			clock: "timer",
		});
		expect(trainingDrills.drills().map((d) => d.id)).toContain("benchmark");
		expect(trainingDrills.modes()).toEqual([]);
	});

	it("is not paced by the engine: the reader sets the pace", () => {
		expect(trainingDrills.get("benchmark")?.pacingRules).toEqual([]);
	});

	it("refuses to register a second drill with the same id", () => {
		const benchmark = trainingDrills.get("benchmark");
		if (!benchmark) throw new Error("benchmark is not registered");
		expect(() => trainingDrills.register(benchmark)).toThrow(RegistryError);
	});

	it("loads its view on demand", () => {
		expect(typeof trainingDrills.get("benchmark")?.view).toBe("function");
	});
});

describe("saving a result", () => {
	it("stores a Training result of kind benchmark with the scores", async () => {
		await saveBenchmarkResult(store, result(310, 70));
		const saved = await store.trainingResults();
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({
			kind: BENCHMARK_KIND,
			completedAt: clock,
			scores: {
				wpm: 310,
				comprehension: 70,
				correct: 7,
				questions: 10,
				words: 300,
			},
		});
	});

	it("keeps every result: there is no cap", async () => {
		for (let i = 0; i < 60; i++) {
			clock += 1_000;
			await saveBenchmarkResult(store, result(200 + i));
		}
		expect(await store.trainingResults()).toHaveLength(60);
	});
});

describe("the trend", () => {
	const at = (
		id: string,
		completedAt: number,
		scores: Record<string, number>,
		kind = "benchmark",
	) => ({
		id,
		kind,
		completedAt,
		scores,
	});
	const noon = new Date(2026, 10, 3, 12).getTime();
	const DAY = 24 * 60 * 60 * 1000;

	it("is empty with no results", () => {
		expect(buildBenchmarkTrend([])).toEqual({ count: 0, points: [], rows: [] });
	});

	it("lists results oldest first for the chart and newest first for the table", () => {
		const trend = buildBenchmarkTrend([
			at("b", noon + DAY, { wpm: 260, comprehension: 80 }),
			at("a", noon, { wpm: 180, comprehension: 60 }),
			at("c", noon + 2 * DAY, { wpm: 360, comprehension: 90 }),
		]);
		expect(trend.count).toBe(3);
		expect(trend.points.map((p) => p.id)).toEqual(["a", "b", "c"]);
		expect(trend.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
	});

	it("puts each result on its local day and in its Speed Zone", () => {
		const trend = buildBenchmarkTrend([
			at("a", noon, { wpm: 180, comprehension: 60 }),
			at("b", noon + DAY, { wpm: 260, comprehension: 80 }),
			at("c", noon + 2 * DAY, { wpm: 360, comprehension: 90 }),
		]);
		expect(trend.points).toEqual([
			{ id: "a", date: "2026-11-03", wpm: 180, band: "study" },
			{ id: "b", date: "2026-11-04", wpm: 260, band: "read" },
			{ id: "c", date: "2026-11-05", wpm: 360, band: "skim" },
		]);
		expect(trend.rows[0]).toEqual({
			id: "c",
			date: "2026-11-05",
			wpm: 360,
			comprehension: 90,
		});
	});

	it("leaves out other kinds of Training result and results it cannot read", () => {
		const trend = buildBenchmarkTrend([
			at("sprint", noon, { wpm: 500 }, "sprint"),
			at("no-wpm", noon, { comprehension: 50 }),
			at("nan", noon, { wpm: Number.NaN, comprehension: 50 }),
			at("neg", noon, { wpm: -3, comprehension: 50 }),
			at("no-comp", noon, { wpm: 250 }),
			at("ok", noon, { wpm: 250, comprehension: 50 }),
		]);
		expect(trend.points.map((p) => p.id)).toEqual(["ok"]);
		expect(trend.count).toBe(1);
	});

	it("plots the latest 20 and lists the latest 10, and counts them all", () => {
		const many = Array.from({ length: 30 }, (_, i) =>
			at(`r${i}`, noon + i * 1000, { wpm: 200 + i, comprehension: 70 }),
		);
		const trend = buildBenchmarkTrend(many);
		expect(trend.count).toBe(30);
		expect(trend.points).toHaveLength(20);
		expect(trend.points[0]?.id).toBe("r10");
		expect(trend.points[19]?.id).toBe("r29");
		expect(trend.rows).toHaveLength(10);
		expect(trend.rows[0]?.id).toBe("r29");
	});

	it("reads back what was saved", async () => {
		await saveBenchmarkResult(store, result(240, 90));
		const trend = buildBenchmarkTrend(await store.trainingResults());
		expect(trend.rows).toEqual([
			{
				id: expect.any(String),
				date: "2026-11-03",
				wpm: 240,
				comprehension: 90,
			},
		]);
	});
});
