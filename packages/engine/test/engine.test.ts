import type { Position } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	type Engine,
	type EngineEventName,
} from "../src/index";
import { paragraphs } from "./helpers";

type Logged = { event: EngineEventName; position: Position; text?: string };

/** Three 200 ms frames at 300 wpm: "one" 0-200, "two" 200-400, "three" 400-600. */
function setup(document = paragraphs("one two three")) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(document, { wpm: 300 }),
	});
	const log: Logged[] = [];
	const names: EngineEventName[] = [
		"play",
		"pause",
		"frameShown",
		"seek",
		"end",
	];
	for (const name of names) {
		engine.on(name, (payload) => {
			log.push({
				event: name,
				position: payload.position,
				...("frame" in payload ? { text: payload.frame.text } : {}),
			});
		});
	}
	return { clock, engine, log };
}

const events = (log: Logged[]) => log.map((entry) => entry.event);
const shown = (log: Logged[]) =>
	log.filter((entry) => entry.event === "frameShown").map((e) => e.text);

describe("a new Engine", () => {
	it("starts paused on the first Frame", () => {
		const { engine } = setup();
		expect(engine.playing).toBe(false);
		expect(engine.index).toBe(0);
		expect(engine.frame?.text).toBe("one");
		expect(engine.position).toEqual({ block: 0, offset: 0 });
	});

	it("has no Frame for an empty Document", () => {
		const { engine, log, clock } = setup(paragraphs(""));
		expect(engine.frame).toBeUndefined();
		engine.play();
		clock.advance(1000);
		expect(engine.playing).toBe(false);
		expect(log).toEqual([]);
	});
});

describe("play", () => {
	it("emits play then shows the first Frame", () => {
		const { engine, log } = setup();
		engine.play();
		expect(engine.playing).toBe(true);
		expect(log).toEqual([
			{ event: "play", position: { block: 0, offset: 0 } },
			{ event: "frameShown", position: { block: 0, offset: 0 }, text: "one" },
		]);
	});

	it("shows each Frame exactly when its time comes", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(199);
		expect(engine.frame?.text).toBe("one");
		clock.advance(1);
		expect(engine.frame?.text).toBe("two");
		expect(log.at(-1)).toEqual({
			event: "frameShown",
			position: { block: 0, offset: 4 },
			text: "two",
		});
		clock.advance(199);
		expect(engine.frame?.text).toBe("two");
		clock.advance(1);
		expect(engine.frame?.text).toBe("three");
		expect(shown(log)).toEqual(["one", "two", "three"]);
	});

	it("does not repeat frameShown while a Frame is still current", () => {
		const { engine, clock, log } = setup();
		engine.play();
		for (let i = 0; i < 10; i++) clock.advance(10);
		expect(shown(log)).toEqual(["one"]);
	});

	it("lands on the right Frame after a late tick and only reports what it showed", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(450);
		expect(engine.frame?.text).toBe("three");
		expect(shown(log)).toEqual(["one", "three"]);
	});

	it("does nothing when already playing", () => {
		const { engine, log } = setup();
		engine.play();
		engine.play();
		expect(events(log)).toEqual(["play", "frameShown"]);
	});
});

describe("end", () => {
	it("emits end after the last Frame has been shown for its duration", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(599);
		expect(engine.playing).toBe(true);
		expect(events(log)).not.toContain("end");
		clock.advance(1);
		expect(engine.playing).toBe(false);
		expect(log.at(-1)).toEqual({
			event: "end",
			position: { block: 0, offset: 13 },
		});
		expect(engine.frame?.text).toBe("three");
	});

	it("stops the Clock ticking after the end", () => {
		const { clock, engine, log } = setup();
		engine.play();
		clock.advance(5000);
		const count = log.length;
		clock.advance(5000);
		expect(log).toHaveLength(count);
		expect(clock.listeners).toBe(0);
		expect(engine.playing).toBe(false);
	});

	it("restarts from the first Frame when played again", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(1000);
		log.length = 0;
		engine.play();
		expect(engine.frame?.text).toBe("one");
		expect(events(log)).toEqual(["play", "frameShown"]);
		clock.advance(200);
		expect(engine.frame?.text).toBe("two");
	});
});

describe("pause", () => {
	it("emits pause with the current Frame's Position and stops advancing", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(250);
		log.length = 0;
		engine.pause();
		expect(engine.playing).toBe(false);
		expect(log).toEqual([
			{ event: "pause", position: { block: 0, offset: 4 } },
		]);
		clock.advance(5000);
		expect(engine.frame?.text).toBe("two");
		expect(log).toHaveLength(1);
		expect(clock.listeners).toBe(0);
	});

	it("does nothing when not playing", () => {
		const { engine, log } = setup();
		engine.pause();
		expect(log).toEqual([]);
	});

	it("resumes on the same Frame for its full duration", () => {
		const { engine, clock } = setup();
		engine.play();
		clock.advance(250);
		engine.pause();
		clock.advance(10_000);
		engine.play();
		expect(engine.frame?.text).toBe("two");
		clock.advance(199);
		expect(engine.frame?.text).toBe("two");
		clock.advance(1);
		expect(engine.frame?.text).toBe("three");
	});
});

describe("seek", () => {
	it("moves to the Frame at a Position and emits seek", () => {
		const { engine, log } = setup();
		engine.seek({ block: 0, offset: 8 });
		expect(engine.frame?.text).toBe("three");
		expect(engine.index).toBe(2);
		expect(log).toEqual([{ event: "seek", position: { block: 0, offset: 8 } }]);
	});

	it("lands on the Frame that contains a mid-word Position", () => {
		const { engine, log } = setup();
		engine.seek({ block: 0, offset: 5 });
		expect(engine.frame?.text).toBe("two");
		expect(log[0]?.position).toEqual({ block: 0, offset: 4 });
	});

	it("clamps a Position past the end to the last Frame and before the start to the first", () => {
		const { engine } = setup(paragraphs("one two", "three four"));
		engine.seek({ block: 9, offset: 0 });
		expect(engine.frame?.text).toBe("four");
		engine.seek({ block: 1, offset: 999 });
		expect(engine.frame?.text).toBe("four");
		engine.seek({ block: -1, offset: 0 });
		expect(engine.frame?.text).toBe("one");
	});

	it("finds Frames in later blocks", () => {
		const { engine } = setup(paragraphs("one two", "three four"));
		engine.seek({ block: 1, offset: 6 });
		expect(engine.frame?.text).toBe("four");
	});

	it("resumes playing from the sought Frame", () => {
		const { engine, clock, log } = setup();
		engine.seek({ block: 0, offset: 4 });
		log.length = 0;
		engine.play();
		expect(shown(log)).toEqual(["two"]);
		clock.advance(200);
		expect(engine.frame?.text).toBe("three");
	});

	it("while playing, shows the new Frame and restarts its timing", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(150);
		log.length = 0;
		engine.seek({ block: 0, offset: 8 });
		expect(events(log)).toEqual(["seek", "frameShown"]);
		expect(engine.playing).toBe(true);
		clock.advance(199);
		expect(engine.playing).toBe(true);
		clock.advance(1);
		expect(log.at(-1)?.event).toBe("end");
	});

	it("does not show a Frame while paused", () => {
		const { engine, log } = setup();
		engine.seek({ block: 0, offset: 4 });
		expect(events(log)).toEqual(["seek"]);
	});

	it("does nothing for an empty Document", () => {
		const { engine, log } = setup(paragraphs(""));
		engine.seek({ block: 0, offset: 0 });
		expect(log).toEqual([]);
	});
});

describe("subscribing", () => {
	it("returns an unsubscribe function", () => {
		const { engine } = setup();
		const seen: string[] = [];
		const unsubscribe = engine.on("seek", () => seen.push("seek"));
		engine.seek({ block: 0, offset: 4 });
		unsubscribe();
		engine.seek({ block: 0, offset: 0 });
		expect(seen).toEqual(["seek"]);
	});

	it("supports several listeners for one event", () => {
		const { engine } = setup();
		let count = 0;
		engine.on("play", () => count++);
		engine.on("play", () => count++);
		engine.play();
		expect(count).toBe(2);
	});
});

describe("the Timeline in a worker", () => {
	it("plays a Timeline that was cloned across a worker boundary", () => {
		const built = buildTimeline(paragraphs("one two three"), { wpm: 300 });
		const clock = createManualClock();
		const engine: Engine = createEngine({
			clock,
			timeline: structuredClone(built),
		});
		engine.play();
		clock.advance(400);
		expect(engine.frame?.text).toBe("three");
	});
});
