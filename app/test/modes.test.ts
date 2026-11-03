import { expect, it } from "vitest";
import { pausesWhenHidden, readerModes } from "../src/lib/reader/modes.ts";

it("registers RSVP as a mode through the registry", () => {
	const rsvp = readerModes.get("rsvp");
	expect(rsvp).toMatchObject({
		kind: "mode",
		id: "rsvp",
		analyticsValue: "rsvp",
		clock: "timer",
	});
	expect(readerModes.modes().map((mode) => mode.id)).toContain("rsvp");
});

it("loads the view lazily, so the registry itself has no component code", () => {
	const rsvp = readerModes.get("rsvp");
	expect(typeof rsvp?.view).toBe("function");
});

it("registers Pacer through the same registry, after RSVP", () => {
	expect(readerModes.get("pacer")).toMatchObject({
		kind: "mode",
		id: "pacer",
		analyticsValue: "pacer",
		clock: "timer",
	});
	expect(readerModes.modes().map((mode) => mode.id)).toEqual(["rsvp", "pacer"]);
});

it("drives Pacer with the timer Clock and the same pacing rules as RSVP", () => {
	const rsvp = readerModes.get("rsvp");
	const pacer = readerModes.get("pacer");
	expect(pacer?.pacingRules).toEqual(rsvp?.pacingRules);
	expect(pacer?.settingsUsed).toEqual(rsvp?.settingsUsed);
	expect(typeof pacer?.view).toBe("function");
});

it("pauses the visual modes on a hidden tab, and leaves audio modes playing", () => {
	expect(pausesWhenHidden({ clock: "timer" })).toBe(true);
	expect(pausesWhenHidden({ clock: "audio" })).toBe(false);
	expect(pausesWhenHidden({ clock: "web-speech" })).toBe(false);
	for (const id of ["rsvp", "pacer"]) {
		const mode = readerModes.get(id);
		expect(mode && pausesWhenHidden(mode)).toBe(true);
	}
});
