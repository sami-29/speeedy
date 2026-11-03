import { describe, expect, it } from "vitest";
import {
	commandForKey,
	type KeyInput,
	nextMode,
	SHORTCUTS,
} from "../src/lib/reader/shortcuts.ts";

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
	key,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	target: { tagName: "BODY" },
	...extra,
});

describe("reader keys", () => {
	it("Space and K play or pause", () => {
		expect(commandForKey(press(" "))).toEqual({ kind: "toggle" });
		expect(commandForKey(press("k"))).toEqual({ kind: "toggle" });
	});

	it("ArrowLeft goes back a sentence, Shift+ArrowLeft a paragraph", () => {
		expect(commandForKey(press("ArrowLeft"))).toEqual({
			kind: "back",
			unit: "sentence",
		});
		expect(commandForKey(press("ArrowLeft", { shiftKey: true }))).toEqual({
			kind: "back",
			unit: "paragraph",
		});
	});

	it("ArrowUp and ArrowDown change the speed by 10, by 50 with Shift", () => {
		expect(commandForKey(press("ArrowUp"))).toEqual({
			kind: "speed",
			delta: 10,
		});
		expect(commandForKey(press("ArrowDown"))).toEqual({
			kind: "speed",
			delta: -10,
		});
		expect(commandForKey(press("ArrowUp", { shiftKey: true }))).toEqual({
			kind: "speed",
			delta: 50,
		});
	});

	it("M switches the Reading Mode and ? opens the shortcuts", () => {
		expect(commandForKey(press("m"))).toEqual({ kind: "mode", step: 1 });
		expect(commandForKey(press("M", { shiftKey: true }))).toEqual({
			kind: "mode",
			step: -1,
		});
		expect(commandForKey(press("?", { shiftKey: true }))).toEqual({
			kind: "help",
		});
	});

	it("ignores keys held with Ctrl, Meta or Alt", () => {
		expect(commandForKey(press(" ", { ctrlKey: true }))).toBeUndefined();
		expect(
			commandForKey(press("ArrowLeft", { metaKey: true })),
		).toBeUndefined();
		expect(commandForKey(press("m", { altKey: true }))).toBeUndefined();
	});

	it("ignores unknown keys", () => {
		expect(commandForKey(press("x"))).toBeUndefined();
		expect(commandForKey(press("Enter"))).toBeUndefined();
	});

	it("leaves typing alone in fields", () => {
		for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
			expect(
				commandForKey(press(" ", { target: { tagName } })),
			).toBeUndefined();
			expect(
				commandForKey(press("k", { target: { tagName } })),
			).toBeUndefined();
		}
		expect(
			commandForKey(
				press("k", { target: { tagName: "DIV", isContentEditable: true } }),
			),
		).toBeUndefined();
	});

	it("leaves Space and Enter to a focused button or link", () => {
		for (const tagName of ["BUTTON", "A", "SUMMARY"]) {
			expect(
				commandForKey(press(" ", { target: { tagName } })),
			).toBeUndefined();
		}
		expect(
			commandForKey(press("k", { target: { tagName: "BUTTON" } })),
		).toEqual({
			kind: "toggle",
		});
		expect(
			commandForKey(press("ArrowLeft", { target: { tagName: "BUTTON" } })),
		).toEqual({ kind: "back", unit: "sentence" });
	});

	it("leaves the arrows to a focused slider", () => {
		const slider = { tagName: "DIV", role: "slider" };
		expect(commandForKey(press("ArrowUp", { target: slider }))).toBeUndefined();
		expect(
			commandForKey(press("ArrowLeft", { target: slider })),
		).toBeUndefined();
		expect(commandForKey(press("k", { target: slider }))).toEqual({
			kind: "toggle",
		});
	});
});

describe("shortcut list", () => {
	it("names every key the reader answers to", () => {
		const keys = SHORTCUTS.flatMap((shortcut) => shortcut.keys);
		for (const key of ["Space", "←", "↑", "↓", "M", "?"]) {
			expect(keys).toContain(key);
		}
	});
});

describe("switching modes", () => {
	it("steps through the modes and wraps around", () => {
		const ids = ["rsvp", "pacer", "listen"];
		expect(nextMode(ids, "rsvp", 1)).toBe("pacer");
		expect(nextMode(ids, "listen", 1)).toBe("rsvp");
		expect(nextMode(ids, "rsvp", -1)).toBe("listen");
	});

	it("stays put with one mode, or an unknown one", () => {
		expect(nextMode(["rsvp"], "rsvp", 1)).toBe("rsvp");
		expect(nextMode(["rsvp", "pacer"], "gone", 1)).toBe("rsvp");
	});
});
