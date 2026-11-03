import type { Position } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	type EngineEventName,
	type EngineSettings,
} from "../src/index";
import { paragraphs } from "./helpers";

const SIX = "one two three four five six";
const document = paragraphs(SIX);
const at = (offset: number, block = 0): Position => ({ block, offset });

/** An Engine that has only a Timeline, like the app's: a worker builds the rest. */
function setup(settings: Partial<EngineSettings> = {}) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(document, { wpm: 300, ...settings }),
		settings: { wpm: 300, ...settings },
	});
	const shown: string[] = [];
	engine.on("frameShown", ({ frame }) => shown.push(frame.text));
	const names: EngineEventName[] = ["play", "pause", "seek", "end"];
	const log: EngineEventName[] = [];
	for (const name of names) engine.on(name, () => log.push(name));
	return { clock, engine, shown, log };
}

describe("Engine.replaceTimeline", () => {
	it("installs a Timeline built elsewhere, with its settings", () => {
		const { engine } = setup();
		const next = buildTimeline(document, { wpm: 600 });
		engine.replaceTimeline(next, { wpm: 600 });
		expect(engine.timeline).toBe(next);
		expect(engine.settings.wpm).toBe(600);
	});

	it("keeps the settings it has when none come with the Timeline", () => {
		const { engine } = setup();
		engine.replaceTimeline(buildTimeline(document, { wpm: 600 }));
		expect(engine.settings.wpm).toBe(300);
	});

	it("keeps the Cursor on its Position", () => {
		const { engine } = setup();
		engine.seek(at(8));
		expect(engine.frame?.text).toBe("three");
		engine.replaceTimeline(buildTimeline(document, { wpm: 600 }), { wpm: 600 });
		expect(engine.index).toBe(2);
		expect(engine.position).toEqual(at(8));
		expect(engine.frame?.durationMs).toBe(100);
	});

	it("puts the Cursor on the chunk that holds its word when the chunk size grows", () => {
		const { engine, shown } = setup();
		engine.seek(at(8));
		shown.length = 0;
		engine.replaceTimeline(buildTimeline(document, { chunkSize: 2 }), {
			chunkSize: 2,
		});
		expect(engine.frame?.text).toBe("three four");
		expect(shown).toEqual(["three four"]);
	});

	it("reports no Frame when the current Frame did not change", () => {
		const { engine, shown } = setup();
		engine.seek(at(4));
		shown.length = 0;
		engine.replaceTimeline(buildTimeline(document, { wpm: 600 }), { wpm: 600 });
		expect(shown).toEqual([]);
	});

	it("emits no play, pause or seek", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(250);
		log.length = 0;
		engine.replaceTimeline(buildTimeline(document, { wpm: 600 }), { wpm: 600 });
		expect(log).toEqual([]);
	});

	it("keeps a playing Engine playing, at the same place inside the Frame", () => {
		const { engine, clock, shown } = setup();
		engine.play();
		clock.advance(250);
		expect(engine.frame?.text).toBe("two");
		// 50 ms into "two". At 600 wpm "two" runs 100 to 200 ms.
		engine.replaceTimeline(buildTimeline(document, { wpm: 600 }), { wpm: 600 });
		expect(engine.playing).toBe(true);
		expect(engine.frame?.text).toBe("two");
		clock.advance(49);
		expect(engine.frame?.text).toBe("two");
		clock.advance(1);
		expect(engine.frame?.text).toBe("three");
		expect(shown).toEqual(["one", "two", "three"]);
	});

	it("keeps a paused Engine paused", () => {
		const { engine, clock } = setup();
		engine.seek(at(4));
		engine.replaceTimeline(buildTimeline(document, { wpm: 600 }), { wpm: 600 });
		clock.advance(1000);
		expect(engine.playing).toBe(false);
		expect(engine.frame?.text).toBe("two");
	});

	it("ends at the new total time", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(250);
		engine.replaceTimeline(buildTimeline(document, { wpm: 600 }), { wpm: 600 });
		clock.advance(100 * 4 - 50 + 1);
		expect(engine.playing).toBe(false);
		expect(log).toContain("end");
	});

	it("rewinds by the new Timeline's sentences", () => {
		const text = "One two. Three four. Five six.";
		const engine = createEngine({
			clock: createManualClock(),
			timeline: buildTimeline(paragraphs(text), { wpm: 300 }),
		});
		engine.seek(at(23));
		expect(engine.frame?.text).toBe("Five");
		engine.replaceTimeline(buildTimeline(paragraphs(text), { chunkSize: 2 }), {
			chunkSize: 2,
		});
		engine.back("sentence");
		expect(engine.frame?.text).toBe("Three four.");
	});
});
