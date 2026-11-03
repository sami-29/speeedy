import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	createSessionTracker,
	type SessionRecord,
} from "../src/index";
import { paragraphs } from "./helpers";

const SIX = "one two three four five six";

type FakeDocument = EventTarget & { visibilityState: string };

/** 200 ms per Frame at 300 wpm. The wall clock starts at `startEpoch` and follows the Clock. */
function setup({
	text = SIX,
	startEpoch = Date.UTC(2026, 2, 10, 12, 0, 0),
	timeZone,
}: {
	text?: string;
	startEpoch?: number;
	timeZone?: string;
} = {}) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(paragraphs(text), {
			wpm: 300,
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
		}),
	});
	const saved: SessionRecord[] = [];
	const window = new EventTarget();
	const document = Object.assign(new EventTarget(), {
		visibilityState: "visible",
	}) as FakeDocument;
	const tracker = createSessionTracker({
		engine,
		clock,
		now: () => startEpoch + clock.now(),
		...(timeZone ? { timeZone } : {}),
		page: { window, document },
		save: (record) => saved.push(record),
	});
	const hide = () => {
		document.visibilityState = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
	};
	const show = () => {
		document.visibilityState = "visible";
		document.dispatchEvent(new Event("visibilitychange"));
	};
	/** Advance in 10 ms steps, as a real Clock ticks, so no Frame is jumped over. */
	const advance = (ms: number) => {
		for (let left = ms; left > 0; left -= 10) clock.advance(Math.min(10, left));
	};
	return { advance, engine, tracker, saved, window, document, hide, show };
}

describe("Session tracker counts", () => {
	it("active time and the words shown", () => {
		const { engine, advance, tracker, saved } = setup();
		engine.play();
		advance(450);
		engine.pause();
		tracker.flush();
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({ activeMs: 450, wordsRead: 3 });
	});

	it("never counts paused time", () => {
		const { engine, advance, tracker, saved } = setup();
		engine.play();
		advance(300);
		engine.pause();
		advance(10_000);
		engine.play();
		advance(100);
		engine.pause();
		tracker.flush();
		expect(saved[0]?.activeMs).toBe(400);
	});

	it("does not count a Frame twice when playback resumes on it", () => {
		const { engine, advance, tracker, saved } = setup();
		engine.play();
		advance(300);
		engine.pause();
		engine.play();
		advance(50);
		engine.pause();
		tracker.flush();
		expect(saved[0]?.wordsRead).toBe(2);
	});

	it("never counts words that were sought over", () => {
		const { engine, advance, tracker, saved } = setup();
		engine.play();
		advance(100);
		engine.seek({ block: 0, offset: 19 });
		advance(50);
		engine.pause();
		tracker.flush();
		// "one" before the jump and "five" after it; two, three and four were skipped.
		expect(engine.frame?.text).toBe("five");
		expect(saved[0]).toMatchObject({ wordsRead: 2, activeMs: 150 });
	});

	it("counts nothing for a seek while paused", () => {
		const { engine, advance, tracker, saved } = setup();
		engine.play();
		advance(100);
		engine.pause();
		engine.seek({ block: 0, offset: 23 });
		tracker.flush();
		expect(saved[0]).toMatchObject({ wordsRead: 1, activeMs: 100 });
	});

	it("counts words read again after going back", () => {
		const { engine, advance, tracker, saved } = setup();
		engine.play();
		advance(450);
		engine.back("paragraph");
		advance(50);
		engine.pause();
		tracker.flush();
		expect(saved[0]?.wordsRead).toBe(4);
	});

	it("keeps counting up to the end of the Timeline", () => {
		const { engine, advance, tracker, saved } = setup({
			text: "one two three",
		});
		engine.play();
		for (let i = 0; i < 6; i++) advance(100);
		tracker.flush();
		expect(engine.playing).toBe(false);
		expect(saved[0]).toMatchObject({ activeMs: 600, wordsRead: 3 });
	});

	it("saves nothing when nothing was read", () => {
		const { tracker, saved, engine } = setup();
		tracker.flush();
		engine.seek({ block: 0, offset: 10 });
		tracker.flush();
		expect(saved).toEqual([]);
	});

	it("reports the effective words per minute", () => {
		const { engine, advance, tracker, saved } = setup();
		engine.play();
		advance(450);
		engine.pause();
		tracker.flush();
		expect(saved[0]?.wpm).toBe(400);
	});
});

describe("Session dates", () => {
	// 2026-03-01 23:30 UTC is already 2 March in Auckland and still 1 March in Los Angeles.
	const lateInUtc = Date.UTC(2026, 2, 1, 23, 30, 0);

	it("use the reader's local date, not the UTC date", () => {
		for (const [timeZone, date] of [
			["Pacific/Auckland", "2026-03-02"],
			["America/Los_Angeles", "2026-03-01"],
		] as const) {
			const { engine, advance, tracker, saved } = setup({
				startEpoch: lateInUtc,
				timeZone,
			});
			engine.play();
			advance(100);
			engine.pause();
			tracker.flush();
			expect(saved[0]?.date).toBe(date);
		}
	});

	it("count a Session that spans midnight toward its start date", () => {
		// 23:50 on 1 March in Los Angeles (PST).
		const { engine, advance, tracker, saved } = setup({
			text: SIX.repeat(3),
			startEpoch: Date.UTC(2026, 2, 2, 7, 50, 0),
			timeZone: "America/Los_Angeles",
		});
		engine.play();
		advance(1000);
		engine.pause();
		advance(20 * 60_000);
		engine.play();
		advance(500);
		engine.pause();
		tracker.flush();
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({
			date: "2026-03-01",
			activeMs: 1500,
			startedAt: Date.UTC(2026, 2, 2, 7, 50, 0),
		});
	});

	it("start a new Session on the next date after a flush", () => {
		const { engine, advance, tracker, saved } = setup({
			startEpoch: Date.UTC(2026, 2, 2, 7, 50, 0),
			timeZone: "America/Los_Angeles",
		});
		engine.play();
		advance(200);
		engine.pause();
		tracker.flush();
		advance(20 * 60_000);
		engine.play();
		advance(200);
		engine.pause();
		tracker.flush();
		expect(saved.map((s) => s.date)).toEqual(["2026-03-01", "2026-03-02"]);
	});
});

describe("Session tracker flushing", () => {
	it("saves on pagehide and keeps counting afterwards", () => {
		const { engine, advance, window, tracker, saved } = setup();
		engine.play();
		advance(300);
		window.dispatchEvent(new Event("pagehide"));
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({ activeMs: 300, wordsRead: 2 });
		advance(200);
		engine.pause();
		tracker.flush();
		expect(saved).toHaveLength(2);
		expect(saved[1]).toMatchObject({ activeMs: 200, wordsRead: 1 });
	});

	it("saves when the page becomes hidden, not when it becomes visible", () => {
		const { engine, advance, hide, show, saved } = setup();
		engine.play();
		advance(300);
		hide();
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({ activeMs: 300, wordsRead: 2 });
		show();
		expect(saved).toHaveLength(1);
	});

	it("does not count time or words while the page is hidden", () => {
		const { engine, advance, hide, show, tracker, saved } = setup({
			text: Array.from({ length: 100 }, () => "word").join(" "),
		});
		engine.play();
		advance(300);
		hide();
		advance(5000);
		show();
		advance(100);
		engine.pause();
		tracker.flush();
		expect(saved).toHaveLength(2);
		expect(saved[1]?.activeMs).toBe(100);
	});

	it("stops listening after dispose", () => {
		const { engine, advance, window, tracker, saved } = setup();
		engine.play();
		advance(300);
		tracker.dispose();
		window.dispatchEvent(new Event("pagehide"));
		expect(saved).toEqual([]);
	});
});
