import type { Position } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	type EngineEventName,
	type EngineSettings,
	rebuildTimeline,
} from "../src/index";
import { paragraphs } from "./helpers";

const SIX = "one two three four five six";

/** Six 200 ms Frames at 300 wpm: one 0-200, two 200-400, three 400-600, and so on. */
function setup(settings: Partial<EngineSettings> = {}, text = SIX) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		document: paragraphs(text),
		settings: { wpm: 300, ...settings },
	});
	const shown: string[] = [];
	engine.on("frameShown", ({ frame }) => shown.push(frame.text));
	const names: EngineEventName[] = ["play", "pause", "seek", "end"];
	const log: EngineEventName[] = [];
	for (const name of names) engine.on(name, () => log.push(name));
	return { clock, engine, shown, log };
}

const at = (offset: number, block = 0): Position => ({ block, offset });

describe("rebuildTimeline", () => {
	it("keeps the Frames before the index and rebuilds the rest", () => {
		const document = paragraphs(SIX);
		const base = buildTimeline(document, { wpm: 300 });
		const rebuilt = rebuildTimeline(document, base, 2, { wpm: 600 });
		expect(rebuilt.frames.slice(0, 2)).toEqual(base.frames.slice(0, 2));
		expect(rebuilt.frames).toHaveLength(6);
		expect(rebuilt.frames[2]?.position).toEqual(base.frames[2]?.position);
		expect(rebuilt.frames[2]?.startMs).toBe(400);
		expect(rebuilt.frames[2]?.durationMs).toBe(100);
		expect(rebuilt.totalMs).toBe(400 + 4 * 100);
	});

	it("regroups the Frames after the index when the chunk size changes", () => {
		const document = paragraphs(SIX, "seven eight");
		const base = buildTimeline(document, { wpm: 300 });
		const rebuilt = rebuildTimeline(document, base, 1, {
			wpm: 300,
			chunkSize: 2,
		});
		expect(rebuilt.frames.map((f) => f.text)).toEqual([
			"one",
			"two three",
			"four five",
			"six",
			"seven eight",
		]);
	});

	it("rebuilds the same Timeline when nothing changed, paragraph pauses included", () => {
		const document = paragraphs("one two", "three four");
		const base = buildTimeline(document, { wpm: 300 });
		expect(rebuildTimeline(document, base, 2, { wpm: 300 })).toEqual(base);
		expect(rebuildTimeline(document, base, 3, { wpm: 300 })).toEqual(base);
	});
});

describe("an Engine built from a Document", () => {
	it("builds its Timeline from the Document and settings", () => {
		const { engine } = setup();
		expect(engine.timeline.frames).toHaveLength(6);
		expect(engine.settings.wpm).toBe(300);
		expect(engine.settings.chunkSize).toBe(1);
	});
});

describe("changing a setting mid-play", () => {
	it("rebuilds from the Cursor: faster WPM shortens the Frames from here on", () => {
		const { engine, clock, shown } = setup();
		engine.play();
		clock.advance(250);
		expect(engine.frame?.text).toBe("two");

		engine.updateSettings({ wpm: 600 });
		expect(engine.frame?.text).toBe("two");
		expect(engine.index).toBe(1);
		expect(engine.timeline.totalMs).toBe(200 + 5 * 100);

		clock.advance(49);
		expect(engine.frame?.text).toBe("two");
		clock.advance(1);
		expect(engine.frame?.text).toBe("three");
		expect(shown).toEqual(["one", "two", "three"]);
	});

	it("rebuilds from the Cursor: slower WPM keeps the current Frame up longer", () => {
		const { engine, clock } = setup();
		engine.play();
		clock.advance(250);
		engine.updateSettings({ wpm: 150 });
		clock.advance(349);
		expect(engine.frame?.text).toBe("two");
		clock.advance(1);
		expect(engine.frame?.text).toBe("three");
	});

	it("leaves the Frames already read as they were", () => {
		const { engine, clock } = setup();
		const before = engine.timeline.frames[0];
		engine.play();
		clock.advance(250);
		engine.updateSettings({ wpm: 600 });
		expect(engine.timeline.frames[0]).toEqual(before);
	});

	it("regroups the Frames when the chunk size changes, without moving the Cursor", () => {
		const { engine, clock, shown } = setup();
		engine.play();
		clock.advance(250);
		engine.updateSettings({ chunkSize: 2 });
		expect(engine.index).toBe(1);
		expect(engine.position).toEqual(at(4));
		expect(engine.frame?.text).toBe("two three");
		expect(shown).toEqual(["one", "two", "two three"]);

		clock.advance(349);
		expect(engine.frame?.text).toBe("two three");
		clock.advance(1);
		expect(engine.frame?.text).toBe("four five");
		clock.advance(400);
		expect(engine.frame?.text).toBe("six");
		clock.advance(200);
		expect(engine.playing).toBe(false);
	});

	it("restores single-word Frames when the chunk size goes back to 1", () => {
		const { engine, clock } = setup({ chunkSize: 2 });
		engine.play();
		clock.advance(100);
		expect(engine.frame?.text).toBe("one two");
		engine.updateSettings({ chunkSize: 1 });
		expect(engine.frame?.text).toBe("one");
		expect(engine.position).toEqual(at(0));
	});

	const patches: Partial<EngineSettings>[] = [
		{ wpm: 900 },
		{ wpm: 100 },
		{ chunkSize: 3 },
		{ smartSpeed: true },
		{ sentencePauseMultiplier: 0 },
		{ rampSpanWords: 10 },
		{ sprintEveryWords: 3, sprintWords: 1, sprintSpeedup: 3 },
	];
	it.each(patches)("never moves the Cursor off its Position: %j", (patch) => {
		const { engine, clock } = setup({}, "one two three. four five six seven");
		engine.play();
		clock.advance(450);
		const position = engine.position;
		engine.updateSettings(patch);
		expect(engine.position).toEqual(position);
		expect(engine.playing).toBe(true);
		expect(engine.frame?.position).toEqual(position);
	});

	it("emits no seek, pause or play for a rebuild", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(250);
		log.length = 0;
		engine.updateSettings({ wpm: 600, chunkSize: 2 });
		expect(log).toEqual([]);
	});

	it("while paused, rebuilds from the Cursor and shows the regrouped Frame", () => {
		const { engine, shown } = setup();
		engine.seek(at(4));
		engine.updateSettings({ chunkSize: 2 });
		expect(engine.playing).toBe(false);
		expect(engine.frame?.text).toBe("two three");
		expect(engine.position).toEqual(at(4));
		expect(shown).toEqual(["two three"]);
	});

	it("does not announce a Frame that did not change", () => {
		const { engine, shown } = setup();
		engine.seek(at(4));
		engine.updateSettings({ sentencePauseMultiplier: 3 });
		expect(shown).toEqual([]);
	});

	it("still ends at the new total time", () => {
		const { engine, clock, log } = setup();
		engine.play();
		clock.advance(250);
		engine.updateSettings({ wpm: 600 });
		clock.advance(449);
		expect(log).not.toContain("end");
		clock.advance(1);
		expect(log).toContain("end");
	});

	it("throws if the Engine was given a Timeline but no Document to rebuild", () => {
		const engine = createEngine({
			clock: createManualClock(),
			timeline: buildTimeline(paragraphs(SIX), { wpm: 300 }),
		});
		expect(() => engine.updateSettings({ wpm: 600 })).toThrow();
	});
});

describe("the ramp and sprints run from each play", () => {
	const ramp = { rampSpanWords: 2, rampStart: 0.5 };

	it("slows the first Frames after a seek and play, not only at the Document start", () => {
		const { engine, clock } = setup(ramp);
		engine.seek(at(8));
		engine.play();
		clock.advance(399);
		expect(engine.frame?.text).toBe("three");
		clock.advance(1);
		expect(engine.frame?.text).toBe("four");
		// four ramps at 0.75: 266.667 ms
		clock.advance(266);
		expect(engine.frame?.text).toBe("four");
		clock.advance(2);
		expect(engine.frame?.text).toBe("five");
	});

	it("starts slow again after a pause and play", () => {
		const { engine, clock } = setup(ramp);
		engine.play();
		clock.advance(500);
		expect(engine.frame?.text).toBe("two");
		engine.pause();
		engine.play();
		expect(engine.frame?.text).toBe("two");
		clock.advance(399);
		expect(engine.frame?.text).toBe("two");
		clock.advance(1);
		expect(engine.frame?.text).toBe("three");
	});

	it("does not restart when a setting changes mid-play", () => {
		const { engine, clock } = setup(ramp);
		engine.play();
		clock.advance(500);
		expect(engine.frame?.text).toBe("two");
		engine.updateSettings({ wpm: 600 });
		// two keeps its ramp (100 / 0.75 = 133.333 ms, started at 400); three is past the ramp.
		clock.advance(33);
		expect(engine.frame?.text).toBe("two");
		clock.advance(1);
		expect(engine.frame?.text).toBe("three");
		clock.advance(99);
		expect(engine.frame?.text).toBe("three");
		clock.advance(1);
		expect(engine.frame?.text).toBe("four");
	});

	it("counts sprints from the play too", () => {
		const { engine, clock } = setup({
			sprintEveryWords: 3,
			sprintWords: 1,
			sprintSpeedup: 2,
		});
		engine.seek(at(8));
		engine.play();
		// three and four read normally; five is the sprint word (100 ms).
		clock.advance(399);
		expect(engine.frame?.text).toBe("four");
		clock.advance(1);
		expect(engine.frame?.text).toBe("five");
		clock.advance(100);
		expect(engine.frame?.text).toBe("six");
	});
});
