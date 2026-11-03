import { describe, expect, it } from "vitest";
import { handOff, takeHandoff } from "../src/lib/reader/handoff.ts";

describe("reader handoff", () => {
	it("starts empty", () => {
		expect(takeHandoff()).toBeUndefined();
	});

	it("gives the source to the reader once, then nothing", () => {
		const source = { text: "hello there", source: "own" } as const;
		handOff(source);
		expect(takeHandoff()).toEqual(source);
		expect(takeHandoff()).toBeUndefined();
	});

	it("carries a file from the front door and keeps the share source for a Share Link", () => {
		const file = new File(["x"], "a.txt");
		handOff({ file, source: "own" });
		expect(takeHandoff()).toEqual({ file, source: "own" });
		handOff({ text: "shared", source: "share" });
		expect(takeHandoff()?.source).toBe("share");
	});

	it("keeps only the latest source", () => {
		handOff({ text: "first", source: "own" });
		handOff({ text: "second", source: "share" });
		expect(takeHandoff()).toEqual({ text: "second", source: "share" });
	});
});
