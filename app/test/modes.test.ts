import { expect, it } from "vitest";
import { readerModes } from "../src/lib/reader/modes.ts";

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
