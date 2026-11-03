import { describe, expect, it } from "vitest";
import { handOff, takeHandOff } from "../src/lib/reader/handoff.ts";

describe("reader handoff", () => {
	it("starts empty", () => {
		expect(takeHandOff()).toBeUndefined();
	});

	it("gives the source to the reader once, then nothing", () => {
		const source = { kind: "text", text: "hello there" } as const;
		handOff(source);
		expect(takeHandOff()).toEqual(source);
		expect(takeHandOff()).toBeUndefined();
	});

	it("keeps only the latest source", () => {
		handOff({ kind: "text", text: "first" });
		handOff({ kind: "text", text: "second" });
		expect(takeHandOff()).toEqual({ kind: "text", text: "second" });
	});
});
