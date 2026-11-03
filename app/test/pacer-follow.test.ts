import type { Document } from "@speeedy/contracts";
import { createEngine, createManualClock } from "@speeedy/engine";
import { describe, expect, it } from "vitest";
import {
	followCursor,
	type PacerRange,
} from "../src/lib/reader/pacer/follow.ts";
import { pauseWhenHidden } from "../src/lib/reader/pacer/hidden.ts";

const DOCUMENT: Document = {
	version: 1,
	blocks: [
		{ kind: "heading", level: 1, text: "Title words", spans: [] },
		{
			kind: "paragraph",
			text: "alpha beta gamma. delta epsilon zeta.",
			spans: [],
		},
		{ kind: "image-placeholder", alt: "a red fox" },
		{ kind: "quote", text: "quoted line here.", spans: [] },
	],
};

function setup(settings: Parameters<typeof createEngine>[0]["settings"] = {}) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		document: DOCUMENT,
		settings: { wpm: 600, ...settings },
	});
	const ranges: PacerRange[] = [];
	const stop = followCursor(engine, (range) => ranges.push(range));
	return { clock, engine, ranges, stop };
}

/** The text a range covers, read back from the Document. */
function textOf(range: PacerRange): string {
	const block = DOCUMENT.blocks[range.block];
	const text = block?.kind === "image-placeholder" ? block.alt : block?.text;
	return (text ?? "").slice(range.from, range.to);
}

describe("followCursor", () => {
	it("shows the current Frame at once, before anything plays", () => {
		const { ranges } = setup();
		expect(ranges).toHaveLength(1);
		expect(textOf(ranges[0] as PacerRange)).toBe("Title");
	});

	// The Engine has no Frames for an image's alt text, so the Cursor passes over the place.
	it("follows the Cursor Frame by Frame as the Clock advances", () => {
		const { clock, engine, ranges } = setup();
		engine.play();
		const total = engine.timeline.totalMs;
		const seen: string[] = [];
		for (let t = 0; t < total + 10; t += 5) {
			clock.advance(5);
			const last = ranges[ranges.length - 1];
			const text = last ? textOf(last) : "";
			if (seen[seen.length - 1] !== text) seen.push(text);
		}
		expect(seen).toEqual([
			"Title",
			"words",
			"alpha",
			"beta",
			"gamma.",
			"delta",
			"epsilon",
			"zeta.",
			"quoted",
			"line",
			"here.",
		]);
	});

	it("is driven by the Engine's Clock: nothing moves while the Clock stands still", () => {
		const { clock, engine, ranges } = setup();
		engine.play();
		clock.advance(0);
		const before = ranges.length;
		clock.advance(0);
		expect(ranges).toHaveLength(before);
		engine.pause();
		clock.advance(10_000);
		expect(ranges).toHaveLength(before);
	});

	it("moves on a rewind or a seek while paused, which emit no Frame", () => {
		const { engine, ranges } = setup();
		engine.seek({ block: 1, offset: 18 });
		expect(textOf(ranges[ranges.length - 1] as PacerRange)).toBe("delta");
		engine.back("sentence");
		expect(textOf(ranges[ranges.length - 1] as PacerRange)).toBe("alpha");
		engine.seek({ block: 3, offset: 0 });
		expect(ranges[ranges.length - 1]).toMatchObject({ block: 3 });
	});

	it("covers every word of a Frame when several are read together", () => {
		const { engine, ranges } = setup({ chunkSize: 2 });
		engine.seek({ block: 1, offset: 0 });
		expect(textOf(ranges[ranges.length - 1] as PacerRange)).toBe("alpha beta");
	});

	it("follows a settings change that regroups the Frames", () => {
		const { engine, ranges } = setup();
		engine.seek({ block: 1, offset: 0 });
		engine.updateSettings({ chunkSize: 3 });
		expect(textOf(ranges[ranges.length - 1] as PacerRange)).toBe(
			"alpha beta gamma.",
		);
	});

	it("keeps the Position when it is attached again, as after a mode switch", () => {
		const { engine, stop } = setup();
		engine.seek({ block: 1, offset: 18 });
		stop();
		const again: PacerRange[] = [];
		followCursor(engine, (range) => again.push(range));
		expect(again).toHaveLength(1);
		expect(textOf(again[0] as PacerRange)).toBe("delta");
	});

	it("stops listening when detached", () => {
		const { engine, ranges, stop } = setup();
		stop();
		const before = ranges.length;
		engine.seek({ block: 3, offset: 0 });
		expect(ranges).toHaveLength(before);
	});

	it("shows nothing for an Engine with no Frames", () => {
		const clock = createManualClock();
		const engine = createEngine({
			clock,
			document: { version: 1, blocks: [] },
		});
		const ranges: PacerRange[] = [];
		followCursor(engine, (range) => ranges.push(range));
		expect(ranges).toEqual([]);
	});
});

describe("pauseWhenHidden", () => {
	function page() {
		const target = new EventTarget() as EventTarget & {
			visibilityState: string;
		};
		target.visibilityState = "visible";
		return {
			document: target,
			hide() {
				target.visibilityState = "hidden";
				target.dispatchEvent(new Event("visibilitychange"));
			},
			show() {
				target.visibilityState = "visible";
				target.dispatchEvent(new Event("visibilitychange"));
			},
		};
	}

	it("pauses a playing Engine when the tab is hidden and leaves it paused when shown", () => {
		const clock = createManualClock();
		const engine = createEngine({ clock, document: DOCUMENT });
		const tab = page();
		pauseWhenHidden(engine, tab);
		engine.play();
		clock.advance(300);
		expect(engine.playing).toBe(true);
		tab.hide();
		expect(engine.playing).toBe(false);
		const at = engine.index;
		clock.advance(5000);
		expect(engine.index).toBe(at);
		tab.show();
		expect(engine.playing).toBe(false);
	});

	it("does nothing while the tab stays visible", () => {
		const clock = createManualClock();
		const engine = createEngine({ clock, document: DOCUMENT });
		const tab = page();
		pauseWhenHidden(engine, tab);
		engine.play();
		tab.show();
		expect(engine.playing).toBe(true);
	});

	it("stops watching when detached, so a mode that keeps playing is left alone", () => {
		const clock = createManualClock();
		const engine = createEngine({ clock, document: DOCUMENT });
		const tab = page();
		const stop = pauseWhenHidden(engine, tab);
		stop();
		engine.play();
		tab.hide();
		expect(engine.playing).toBe(true);
	});

	it("pauses at once if the tab is already hidden when attached", () => {
		const clock = createManualClock();
		const engine = createEngine({ clock, document: DOCUMENT });
		const tab = page();
		tab.document.visibilityState = "hidden";
		engine.play();
		pauseWhenHidden(engine, tab);
		expect(engine.playing).toBe(false);
	});
});
