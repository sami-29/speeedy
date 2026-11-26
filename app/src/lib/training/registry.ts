import { createRegistry } from "@speeedy/contracts";
import type { Component } from "svelte";

/** A Training drill's view is loaded on demand, like a Reading Mode's. */
export type DrillView = () => Promise<{ default: Component }>;

/** The Training drills: the Benchmark now, sprints and chunk-width drills later. */
export const trainingDrills = createRegistry<DrillView>();

trainingDrills.register({
	kind: "drill",
	id: "benchmark",
	analyticsValue: "benchmark",
	view: () => import("./BenchmarkTest.svelte"),
	// The reader sets the pace by pressing Done, so no pacing rule applies.
	pacingRules: [],
	clock: "timer",
	settingsUsed: [],
});
