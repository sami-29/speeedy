import { describe, expect, it } from "vitest";
import { createRegistry, type Descriptor, RegistryError } from "../src/index";

// A dummy Reading Mode defined entirely in this test file: if it registers and is
// listed, a new mode needs no change to the registry, the engine or any other package.
const dummyMode: Descriptor<string> = {
	kind: "mode",
	id: "dummy",
	analyticsValue: "dummy",
	view: "dummy-view",
	pacingRules: ["base-wpm", "punctuation-pauses"],
	clock: "timer",
	settingsUsed: ["wpm", "chunkSize"],
};

const dummyDrill: Descriptor<string> = {
	kind: "drill",
	id: "dummy-sprint",
	analyticsValue: "dummy_sprint",
	view: "sprint-view",
	pacingRules: ["base-wpm", "sprints"],
	clock: "timer",
	settingsUsed: [],
};

describe("registry", () => {
	it("starts empty", () => {
		expect(createRegistry<string>().list()).toEqual([]);
	});

	it("lists a registered dummy mode", () => {
		const registry = createRegistry<string>();
		registry.register(dummyMode);
		expect(registry.list()).toEqual([dummyMode]);
		expect(registry.modes()).toEqual([dummyMode]);
		expect(registry.drills()).toEqual([]);
	});

	it("looks a registration up by id", () => {
		const registry = createRegistry<string>();
		registry.register(dummyMode);
		expect(registry.get("dummy")).toEqual(dummyMode);
		expect(registry.get("missing")).toBeUndefined();
	});

	it("keeps modes and drills in separate lists, in registration order", () => {
		const registry = createRegistry<string>();
		registry.register(dummyDrill);
		registry.register(dummyMode);
		expect(registry.list().map((d) => d.id)).toEqual(["dummy-sprint", "dummy"]);
		expect(registry.modes().map((d) => d.id)).toEqual(["dummy"]);
		expect(registry.drills().map((d) => d.id)).toEqual(["dummy-sprint"]);
	});

	it("keeps registries independent of each other", () => {
		const a = createRegistry<string>();
		const b = createRegistry<string>();
		a.register(dummyMode);
		expect(b.list()).toEqual([]);
	});

	it("is unaffected by later changes to the descriptor it was given", () => {
		const registry = createRegistry<string>();
		const mutable = { ...dummyMode, settingsUsed: ["wpm"] };
		registry.register(mutable);
		mutable.settingsUsed.push("later");
		mutable.id = "renamed";
		expect(registry.get("dummy")?.settingsUsed).toEqual(["wpm"]);
	});

	it("rejects a second registration under the same id", () => {
		const registry = createRegistry<string>();
		registry.register(dummyMode);
		expect(() =>
			registry.register({ ...dummyMode, analyticsValue: "other" }),
		).toThrow(RegistryError);
		expect(registry.list()).toHaveLength(1);
	});

	it("rejects a second registration with the same analytics value", () => {
		const registry = createRegistry<string>();
		registry.register(dummyMode);
		expect(() => registry.register({ ...dummyMode, id: "other" })).toThrow(
			RegistryError,
		);
	});

	it.each([
		["an empty id", { id: "" }],
		["an id with spaces", { id: "my mode" }],
		["an id with capitals", { id: "MyMode" }],
		["an analytics value with spaces", { analyticsValue: "my mode" }],
		["an empty analytics value", { analyticsValue: "" }],
		["an unknown kind", { kind: "game" }],
		["an unknown clock", { clock: "sundial" }],
		["an unknown pacing rule", { pacingRules: ["base-wpm", "vibes"] }],
		["duplicate pacing rules", { pacingRules: ["base-wpm", "base-wpm"] }],
		["a non-string setting", { settingsUsed: [1] }],
		["settingsUsed not a list", { settingsUsed: "wpm" }],
	])("rejects %s", (_name, patch) => {
		const registry = createRegistry<string>();
		expect(() =>
			registry.register({
				...dummyMode,
				...patch,
			} as unknown as Descriptor<string>),
		).toThrow(RegistryError);
		expect(registry.list()).toEqual([]);
	});

	it("accepts all three clocks and the five pacing rules in order", () => {
		const registry = createRegistry<string>();
		for (const clock of ["timer", "audio", "web-speech"] as const) {
			registry.register({
				...dummyMode,
				id: `m-${clock}`,
				analyticsValue: `m_${clock.replace("-", "_")}`,
				clock,
				pacingRules: [
					"base-wpm",
					"smart-speed",
					"punctuation-pauses",
					"ramp",
					"sprints",
				],
			});
		}
		expect(registry.list()).toHaveLength(3);
	});
});
