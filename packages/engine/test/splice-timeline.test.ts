import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	rebuildTimeline,
	resolveSettings,
	spliceTimeline,
	type TimelineChange,
} from "../src/index";
import { paragraphs } from "./helpers";

const document = paragraphs(
	"One two three. Four five six. Seven eight nine.",
	"Ten eleven twelve. Thirteen fourteen fifteen.",
);

/** What the worker would send for a rebuild at `settings` from Frame `fromIndex`. */
function change(
	fromIndex: number,
	settings: { wpm: number; chunkSize?: number },
	options: { replaceCount?: number; frames?: number } = {},
): TimelineChange {
	const base = buildTimeline(document, { wpm: 300 });
	const rebuilt = rebuildTimeline(document, base, fromIndex, settings);
	const frames = rebuilt.frames.slice(
		fromIndex,
		options.frames === undefined ? undefined : fromIndex + options.frames,
	);
	const last = frames[frames.length - 1];
	return {
		id: 1,
		phase: options.replaceCount === undefined ? "tail" : "window",
		fromIndex,
		...(options.replaceCount === undefined
			? {}
			: { replaceCount: options.replaceCount }),
		last: options.replaceCount === undefined,
		endMs: last ? last.startMs + last.durationMs : 0,
		settings: resolveSettings(settings),
		frames,
	};
}

describe("spliceTimeline", () => {
	const base = buildTimeline(document, { wpm: 300 });

	it("lays a tail built at the same speed over the end, exactly as a rebuild gives it", () => {
		const spliced = spliceTimeline(
			base,
			change(4, { wpm: 300, chunkSize: 2 }),
			300,
		);
		expect(spliced).toEqual(
			rebuildTimeline(document, base, 4, { wpm: 300, chunkSize: 2 }),
		);
	});

	it("leaves the Frames before the index as they are", () => {
		const spliced = spliceTimeline(
			base,
			change(4, { wpm: 300, chunkSize: 2 }),
			300,
		);
		expect(spliced.frames.slice(0, 4)).toEqual(base.frames.slice(0, 4));
	});

	it("brings a tail built at another speed to the speed the reader has now", () => {
		// The worker built at 600 wpm; the reader has since moved to 300.
		const spliced = spliceTimeline(base, change(4, { wpm: 600 }), 300);
		const same = spliceTimeline(base, change(4, { wpm: 300 }), 300);
		spliced.frames.forEach((frame, index) => {
			const expected = same.frames[index];
			expect(frame.startMs).toBeCloseTo(expected?.startMs ?? 0, 6);
			expect(frame.durationMs).toBeCloseTo(expected?.durationMs ?? 0, 6);
		});
		expect(spliced.totalMs).toBeCloseTo(same.totalMs, 6);
	});

	it("starts the tail where the Frames before it end", () => {
		const spliced = spliceTimeline(base, change(4, { wpm: 600 }), 300);
		const before = spliced.frames[3];
		expect(spliced.frames[4]?.startMs).toBeCloseTo(
			(before?.startMs ?? 0) + (before?.durationMs ?? 0),
			6,
		);
	});

	it("puts a window in front of the Frames it does not replace, and leaves those as they are", () => {
		// A window of the first sentence after Frame 4, built with chunks of two words.
		const window = change(
			3,
			{ wpm: 300, chunkSize: 2 },
			{ replaceCount: 3, frames: 2 },
		);
		const spliced = spliceTimeline(base, window, 300);
		expect(spliced.frames.slice(0, 3)).toEqual(base.frames.slice(0, 3));
		expect(spliced.frames.slice(3, 5)).toEqual(window.frames);
		// The window joins the Frames before it without a gap.
		for (let i = 1; i < 5; i++) {
			const previous = spliced.frames[i - 1];
			expect(spliced.frames[i]?.startMs).toBeCloseTo(
				(previous?.startMs ?? 0) + (previous?.durationMs ?? 0),
				6,
			);
		}
		// The rest are the very same Frames, untouched: cheap on a long Document.
		const rest = spliced.frames.slice(5);
		expect(rest).toHaveLength(base.frames.length - 6);
		for (const [i, frame] of rest.entries())
			expect(frame).toBe(base.frames[6 + i]);
		const moved =
			(window.frames[1]?.startMs ?? 0) + (window.frames[1]?.durationMs ?? 0);
		expect(spliced.totalMs).toBeCloseTo(
			base.totalMs + (moved - (base.frames[6]?.startMs ?? 0)),
			6,
		);
	});

	it("does not change the Timeline it was given", () => {
		const copy = structuredClone(base);
		spliceTimeline(
			base,
			change(3, { wpm: 300, chunkSize: 2 }, { replaceCount: 3, frames: 2 }),
			300,
		);
		expect(base).toEqual(copy);
	});
});
