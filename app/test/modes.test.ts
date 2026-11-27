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
	expect(readerModes.modes().map((mode) => mode.id)).toEqual([
		"rsvp",
		"pacer",
		"listen",
	]);
});

it("drives Pacer with the timer Clock and the same pacing rules as RSVP", () => {
	const rsvp = readerModes.get("rsvp");
	const pacer = readerModes.get("pacer");
	expect(pacer?.pacingRules).toEqual(rsvp?.pacingRules);
	// The same settings, less the paused view (Pacer always shows the whole text) and the
	// start countdown (a count needs the single word's stage).
	expect(pacer?.settingsUsed).toEqual(
		rsvp?.settingsUsed.filter((id) => id !== "pauseView" && id !== "countdown"),
	);
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

it("registers Listen through the same registry, on the Web Speech Clock", () => {
	const listen = readerModes.get("listen");
	expect(listen).toMatchObject({
		kind: "mode",
		id: "listen",
		analyticsValue: "listen",
		clock: "web-speech",
	});
	expect(typeof listen?.view).toBe("function");
});

it("keeps Listen playing on a hidden tab", () => {
	const listen = readerModes.get("listen");
	expect(listen && pausesWhenHidden(listen)).toBe(false);
});

it("paces Listen by the voice: no pacing rules, and no reading speed among its settings", () => {
	const listen = readerModes.get("listen");
	expect(listen?.pacingRules).toEqual([]);
	expect(listen?.settingsUsed).not.toContain("wpm");
	expect(listen?.settingsUsed).toEqual(
		expect.arrayContaining(["voice", "voiceRate"]),
	);
});

it("gives RSVP and Pacer every pacing setting: the pauses, the ramp with its target and length, the rewind step", () => {
	for (const id of ["rsvp", "pacer"]) {
		expect(readerModes.get(id)?.settingsUsed, id).toEqual(
			expect.arrayContaining([
				"smartSpeed",
				"punctuationPauses",
				"sentencePause",
				"paragraphPause",
				"commaPause",
				"asidePause",
				"speedRamp",
				"rampTarget",
				"rampLength",
				"rewindStep",
			]),
		);
	}
});

it("offers the start countdown in RSVP only", () => {
	expect(readerModes.get("rsvp")?.settingsUsed).toContain("countdown");
	expect(readerModes.get("pacer")?.settingsUsed).not.toContain("countdown");
	expect(readerModes.get("listen")?.settingsUsed).not.toContain("countdown");
});
