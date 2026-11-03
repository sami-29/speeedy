import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	type EngineSettings,
} from "../src/index";
import { paragraphs } from "./helpers";

const TEXT = Array.from(
	{ length: 40 },
	(_, i) =>
		`Word${i} goes, then "quoted (aside)" ends here${i % 5 === 4 ? "." : ""}`,
).join(" ");
const document = paragraphs(TEXT, "A second paragraph. It has two sentences.");

function setup(settings: Partial<EngineSettings> = {}) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(document, { wpm: 300, ...settings }),
		settings: { wpm: 300, ...settings },
	});
	return { clock, engine };
}

type Played = ReturnType<typeof setup>;

/** The index of the Frame showing after each `step` ms of playing, until `until`. */
function indexesWhilePlaying(
	{ engine, clock }: Played,
	step: number,
	until: number,
) {
	const seen: number[] = [];
	engine.play();
	for (let t = step; t < until; t += step) {
		clock.advance(step);
		seen.push(engine.index);
	}
	return seen;
}

describe("Engine.setWpm", () => {
	it("changes the speed without touching a Frame", () => {
		const { engine } = setup();
		const before = structuredClone(engine.timeline);
		engine.setWpm(600);
		expect(engine.timeline).toEqual(before);
		expect(engine.settings.wpm).toBe(600);
		expect(engine.timelineWpm).toBe(300);
	});

	it("plays at the new speed: twice as fast at twice the WPM", () => {
		const { engine, clock } = setup();
		engine.setWpm(600);
		engine.play();
		const second = engine.timeline.frames[1];
		clock.advance((second?.startMs ?? 0) / 2 - 0.01);
		expect(engine.index).toBe(0);
		clock.advance(0.02);
		expect(engine.index).toBe(1);
	});

	/** A fresh build at the new speed, played on the same clock steps, shows the same Frames. */
	function samePlaybackAsBuilt(rules: Partial<EngineSettings>, wpm: number) {
		const scaled = setup(rules);
		scaled.engine.setWpm(wpm);
		const clock = createManualClock();
		const fresh: Played = {
			clock,
			engine: createEngine({
				clock,
				timeline: buildTimeline(document, { ...rules, wpm }),
				settings: { ...rules, wpm },
			}),
		};
		const total = fresh.engine.timeline.totalMs;
		const boundaries = fresh.engine.timeline.frames.map(
			(frame) => frame.startMs,
		);
		const step = 3.7;
		const got = indexesWhilePlaying(scaled, step, total);
		const want = indexesWhilePlaying(fresh, step, total);
		got.forEach((index, n) => {
			if (index === want[n]) return;
			// The only difference is a Frame boundary that rounding moved by under a millisecond.
			const time = (n + 1) * step;
			const nearest = Math.min(...boundaries.map((b) => Math.abs(b - time)));
			expect(nearest).toBeLessThan(0.5);
		});
		expect(got.length).toBeGreaterThan(50);
	}

	it("plays a fresh build at the new speed, frame for frame", () => {
		samePlaybackAsBuilt({}, 450);
	});

	it("does so with every pacing rule on: none of them depends on the speed", () => {
		samePlaybackAsBuilt(
			{
				smartSpeed: true,
				commaAsPause: true,
				rampSpanWords: 12,
				sprintEveryWords: 9,
				sprintWords: 3,
				chunkSize: 2,
			},
			210,
		);
	});

	it("keeps the Cursor on its Frame and emits nothing", () => {
		const { engine } = setup();
		engine.seek(engine.timeline.frames[7]?.position ?? { block: 0, offset: 0 });
		const events: string[] = [];
		for (const name of [
			"play",
			"pause",
			"seek",
			"frameShown",
			"end",
		] as const) {
			engine.on(name, () => events.push(name));
		}
		engine.setWpm(900);
		expect(engine.index).toBe(7);
		expect(events).toEqual([]);
	});

	it("keeps a playing Engine at the same place in the same Frame", () => {
		const { engine, clock } = setup();
		engine.play();
		const third = engine.timeline.frames[3];
		clock.advance((third?.startMs ?? 0) + (third?.durationMs ?? 0) / 2);
		expect(engine.index).toBe(3);
		engine.setWpm(600);
		expect(engine.index).toBe(3);
		// Half way through the Frame; the other half takes half as long at double speed.
		const half = (engine.frame?.durationMs ?? 0) / 2 / 2;
		clock.advance(half - 0.01);
		expect(engine.index).toBe(3);
		clock.advance(0.02);
		expect(engine.index).toBe(4);
	});

	it("does nothing for the speed it already has, and clamps like every setting", () => {
		const { engine } = setup();
		engine.setWpm(300);
		expect(engine.timelineWpm).toBe(300);
		engine.setWpm(99999);
		expect(engine.settings.wpm).toBe(3000);
	});

	it("is written into the Frames when settings change, so a rebuild builds on it", () => {
		const engine = createEngine({
			clock: createManualClock(),
			document,
			settings: { wpm: 300 },
		});
		engine.setWpm(600);
		engine.updateSettings({ chunkSize: 2 });
		expect(engine.timelineWpm).toBe(600);
		const expected = buildTimeline(document, { wpm: 600, chunkSize: 2 });
		expect(engine.timeline.frames[2]?.text).toBe(expected.frames[2]?.text);
		expect(engine.timeline.frames[2]?.startMs).toBeCloseTo(
			expected.frames[2]?.startMs ?? 0,
			2,
		);
		expect(engine.timeline.totalMs).toBeCloseTo(expected.totalMs, 0);
	});

	it("keeps the reader's speed when a Timeline built at the old speed is laid in", () => {
		const { engine, clock } = setup();
		engine.setWpm(600);
		engine.replaceTimeline(
			buildTimeline(document, { wpm: 300, chunkSize: 2 }),
			{ chunkSize: 2 },
			{ timelineWpm: 300 },
		);
		expect(engine.settings.wpm).toBe(600);
		expect(engine.settings.chunkSize).toBe(2);
		expect(engine.timelineWpm).toBe(300);
		engine.play();
		const first = engine.frame?.durationMs ?? 0;
		clock.advance(first / 2 - 0.01);
		expect(engine.index).toBe(0);
		clock.advance(0.02);
		expect(engine.index).toBe(1);
	});
});
