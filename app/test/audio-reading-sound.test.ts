import {
	buildTimeline,
	createEngine,
	createManualClock,
} from "@speeedy/engine";
import { describe, expect, it } from "vitest";
import { attachReadingSound } from "../src/lib/audio/reading-sound.ts";

const DOC = {
	version: 1 as const,
	blocks: [
		{ kind: "paragraph" as const, text: "one two three four five", spans: [] },
	],
};

/** The slice of the AudioSystem the reading sound drives, recording what it was told. */
function fakeAudio(initial: { tick?: boolean } = {}) {
	const calls: string[] = [];
	const target = new EventTarget();
	let armed = 0;
	const audio = {
		prefs: { tick: initial.tick ?? false },
		setReading: (on: boolean) => calls.push(`reading:${on}`),
		setVoiceActive: (on: boolean) => calls.push(`voice:${on}`),
		tick: () => calls.push("tick"),
		arm: (given: EventTarget) => {
			expect(given).toBe(target);
			armed++;
			return () => {
				armed--;
			};
		},
	};
	return {
		audio,
		calls,
		target,
		get armed() {
			return armed;
		},
	};
}

function setup(options: { tick?: boolean; silent?: boolean } = {}) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(DOC, { wpm: 300 }),
	});
	const rig = fakeAudio({ tick: options.tick ?? false });
	let silent = options.silent ?? true;
	const detach = attachReadingSound({
		engine,
		audio: rig.audio,
		silent: () => silent,
		page: rig.target,
	});
	return {
		engine,
		clock,
		rig,
		detach,
		setSilent: (value: boolean) => {
			silent = value;
		},
	};
}

describe("reading sound", () => {
	it("starts the ambient bed on play and fades it on pause and at the end", () => {
		const { engine, rig, clock } = setup();
		engine.play();
		expect(rig.calls).toContain("reading:true");
		const reading = () =>
			rig.calls.filter((call) => call.startsWith("reading:")).at(-1);
		engine.pause();
		expect(reading()).toBe("reading:false");
		engine.play();
		expect(reading()).toBe("reading:true");
		clock.advance(60_000);
		expect(reading()).toBe("reading:false");
		expect(rig.calls.filter((call) => call === "reading:true")).toHaveLength(2);
	});

	it("plays the ambient bed in every mode: the same calls whether the mode is silent or not", () => {
		for (const silent of [true, false]) {
			const { engine, rig } = setup({ silent });
			engine.play();
			expect(rig.calls).toContain("reading:true");
		}
	});

	it("ticks once per Frame shown while playing in a silent mode when the tick is on", () => {
		const { engine, rig, clock } = setup({ tick: true });
		engine.play();
		expect(rig.calls.filter((call) => call === "tick")).toHaveLength(1);
		clock.advance(200);
		clock.advance(200);
		expect(rig.calls.filter((call) => call === "tick")).toHaveLength(3);
		expect(engine.frame?.text).toBe("three");
	});

	it("does not tick when the tick is off", () => {
		const { engine, rig, clock } = setup({ tick: false });
		engine.play();
		clock.advance(400);
		expect(rig.calls).not.toContain("tick");
	});

	it("does not tick for a seek or a rewind while paused", () => {
		const { engine, rig } = setup({ tick: true });
		const third = engine.timeline.frames[2];
		if (!third) throw new Error("no third frame");
		engine.seek(third.position);
		engine.back("sentence");
		expect(rig.calls).not.toContain("tick");
	});

	it("does not tick in Listen, where the voice is the sound", () => {
		const { engine, rig, clock } = setup({ tick: true, silent: false });
		engine.play();
		clock.advance(400);
		expect(rig.calls).not.toContain("tick");
	});

	it("follows the tick setting as it changes", () => {
		const { engine, rig, clock } = setup({ tick: false });
		engine.play();
		rig.audio.prefs.tick = true;
		clock.advance(200);
		expect(rig.calls).toContain("tick");
	});

	it("ducks the ambient bed under the voice while Listen plays, and only then", () => {
		const listening = setup({ silent: false });
		listening.engine.play();
		expect(listening.rig.calls).toContain("voice:true");
		listening.engine.pause();
		expect(listening.rig.calls.at(-1)).toBe("voice:false");

		const reading = setup({ silent: true });
		reading.engine.play();
		expect(reading.rig.calls).not.toContain("voice:true");
	});

	it("listens for the gestures that unlock the sound while attached, and stops after", () => {
		const { rig, detach } = setup();
		expect(rig.armed).toBe(1);
		detach();
		expect(rig.armed).toBe(0);
	});

	it("silences everything and stops listening to the Engine when detached", () => {
		const { engine, rig, detach, clock } = setup({ tick: true });
		engine.play();
		detach();
		expect(rig.calls.slice(-2)).toEqual(["reading:false", "voice:false"]);
		const before = rig.calls.length;
		engine.play();
		clock.advance(400);
		engine.pause();
		expect(rig.calls).toHaveLength(before);
	});
});
