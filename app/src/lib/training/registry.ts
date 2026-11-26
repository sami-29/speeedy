import { createRegistry } from "@speeedy/contracts";
import type { Component } from "svelte";

/** A Training drill's view is loaded on demand, like a Reading Mode's. */
export type DrillView = () => Promise<{ default: Component }>;

/** The Training drills: the Benchmark now, sprints and chunk-width drills later. */
export const trainingDrills = createRegistry<DrillView>();
