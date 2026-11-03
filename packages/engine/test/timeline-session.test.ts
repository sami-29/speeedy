import type { Position } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createChangeAssembler,
	createEngine,
	createManualClock,
	createTimelineSession,
	rebuildTimeline,
	spliceTimeline,
	type Timeline,
	type TimelineChange,
	type TimelineReply,
} from "../src/index";
import { paragraphs } from "./helpers";

const at = (offset: number, block = 0): Position => ({ block, offset });

/** `w1 w2 ... wN`, so a word's number is its place and its Position is easy to tell. */
const numbered = (count: number) =>
	Array.from({ length: count }, (_, i) => `w${i + 1}`).join(" ");
const offsetOf = (word: number) =>
	Array.from({ length: word - 1 }, (_, i) => `w${i + 1} `).join("").length;

/** The finished changes in a run of replies, in the order their last chunk arrived. */
function changesOf(replies: TimelineReply[]): TimelineChange[] {
	const assembler = createChangeAssembler();
	const changes: TimelineChange[] = [];
	for (const reply of replies) {
		if (reply.kind !== "chunk") continue;
		const change = assembler.add(reply);
		if (change) changes.push(change);
	}
	return changes;
}

/** What the app does: lay each change over the Timeline, at the reader's speed. */
function applyAll(
	timeline: Timeline,
	replies: TimelineReply[],
	wpm: number,
): Timeline {
	return changesOf(replies).reduce(
		(current, change) => spliceTimeline(current, change, wpm),
		timeline,
	);
}

/** Sentences of five words in paragraphs of three sentences. */
function sentences(count: number) {
	const words = (i: number) =>
		Array.from({ length: 5 }, (_, k) => `s${i}x${k}`).join(" ");
	const paragraphsOf: string[] = [];
	for (let i = 0; i < count; i += 3) {
		paragraphsOf.push(
			Array.from(
				{ length: Math.min(3, count - i) },
				(_, k) => `${words(i + k)}.`,
			).join(" "),
		);
	}
	return paragraphs(...paragraphsOf);
}

describe("Timeline session: build", () => {
	it("answers with the Timeline buildTimeline gives, in chunks", () => {
		const document = paragraphs('He said "stop." Then (ok) go on, now.');
		const session = createTimelineSession({ chunkFrames: 3 });
		const replies = session.handle({
			kind: "build",
			id: 4,
			document,
			settings: { wpm: 450 },
			options: { language: "en" },
		});
		const expected = buildTimeline(document, { wpm: 450 }, { language: "en" });
		const chunks = replies.filter(
			(reply): reply is Extract<TimelineReply, { kind: "chunk" }> =>
				reply.kind === "chunk",
		);
		expect(chunks.length).toBe(Math.ceil(expected.frames.length / 3));
		for (const chunk of chunks) {
			expect(chunk).toMatchObject({
				id: 4,
				phase: "tail",
				fromIndex: 0,
				last: true,
				parts: chunks.length,
			});
			expect(chunk.settings.wpm).toBe(450);
		}
		const [change] = changesOf(replies);
		expect(change?.frames).toEqual(expected.frames);
		expect(change?.endMs).toBe(expected.totalMs);
	});

	it("answers an empty Document with one empty chunk", () => {
		const session = createTimelineSession();
		const replies = session.handle({
			kind: "build",
			id: 1,
			document: { version: 1, blocks: [] },
		});
		expect(replies).toHaveLength(1);
		expect(changesOf(replies)[0]?.frames).toEqual([]);
	});

	it("replies with plain data that structuredClone accepts", () => {
		const session = createTimelineSession({ chunkFrames: 2 });
		const replies = session.handle({
			kind: "build",
			id: 1,
			document: paragraphs("one two three"),
		});
		expect(structuredClone(replies)).toEqual(replies);
	});

	it("reports a failure instead of throwing on a malformed request", () => {
		const session = createTimelineSession();
		const replies = session.handle({
			kind: "build",
			id: 2,
			document: null as never,
		});
		expect(replies).toEqual([
			{ kind: "failed", id: 2, error: "timeline could not be built" },
		]);
	});

	it("starts over when a new Document is built", () => {
		const session = createTimelineSession();
		session.handle({ kind: "build", id: 1, document: paragraphs("one two") });
		session.handle({
			kind: "build",
			id: 2,
			document: paragraphs("alpha beta gamma"),
		});
		const replies = session.handle({
			kind: "settings",
			id: 3,
			position: at(0),
			patch: { chunkSize: 2 },
		});
		expect(
			changesOf(replies).flatMap((change) =>
				change.frames.map((frame) => frame.text),
			),
		).toEqual(["alpha beta", "gamma"]);
	});

	it("streams each reply to `emit` as it is made, when given one", () => {
		const session = createTimelineSession({ chunkFrames: 2 });
		const emitted: TimelineReply[] = [];
		const returned = session.handle(
			{ kind: "build", id: 1, document: paragraphs("one two three four five") },
			(reply) => emitted.push(reply),
		);
		expect(returned).toEqual([]);
		expect(emitted).toHaveLength(3);
	});
});

describe("Timeline session: settings", () => {
	const document = sentences(30);
	const settings = { wpm: 300 };

	function built(windowWords = 20) {
		const session = createTimelineSession({ chunkFrames: 7, windowWords });
		const first = session.handle({ kind: "build", id: 1, document, settings });
		const timeline = applyAll({ frames: [], totalMs: 0 }, first, 300);
		return { session, timeline };
	}

	it("sends a window from the Cursor first, then the rest", () => {
		const { session } = built();
		const position = at(offsetOf(1), 2);
		const emitted: TimelineReply[] = [];
		session.handle(
			{ kind: "settings", id: 2, position, patch: { chunkSize: 2 } },
			(reply) => emitted.push(reply),
		);
		const changes = changesOf(emitted);
		expect(changes.map((change) => change.phase)).toEqual(["window", "tail"]);
		expect(changes.map((change) => change.last)).toEqual([false, true]);
		const [window, tail] = changes;
		// The window runs from the Cursor to the end of a sentence, a few sentences long.
		expect(window?.frames.length).toBeGreaterThan(0);
		expect(
			window?.frames.reduce((n, frame) => n + frame.words, 0),
		).toBeGreaterThanOrEqual(20);
		expect(window?.frames[window.frames.length - 1]?.text).toMatch(/\.$/);
		// The rest follows on from it.
		expect(tail?.fromIndex).toBe(
			(window?.fromIndex ?? 0) + (window?.frames.length ?? 0),
		);
	});

	it("gives, window and rest together, the Timeline a full rebuild gives", () => {
		const { session, timeline } = built();
		const position = at(0, 3);
		const index = timeline.frames.findIndex(
			(frame) => frame.position.block === 3,
		);
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position,
			patch: { chunkSize: 2, smartSpeed: true },
		});
		const expected = rebuildTimeline(document, timeline, index, {
			...settings,
			chunkSize: 2,
			smartSpeed: true,
		});
		expect(applyAll(timeline, replies, 300)).toEqual(expected);
	});

	it("puts the window where the full rebuild has it, and keeps every word once", () => {
		const { session, timeline } = built();
		const index = timeline.frames.findIndex(
			(frame) => frame.position.block === 2,
		);
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position: at(0, 2),
			patch: { chunkSize: 2 },
		});
		const [window] = changesOf(replies);
		if (!window) throw new Error("no window");
		const after = spliceTimeline(timeline, window, 300);
		const full = rebuildTimeline(document, timeline, index, {
			...settings,
			chunkSize: 2,
		});
		// The window is the full rebuild's own first Frames, and joins the ones before it.
		const end = index + window.frames.length;
		expect(after.frames.slice(0, end)).toEqual(full.frames.slice(0, end));
		// Every word is still there once.
		const words = (frames: typeof after.frames) =>
			frames.flatMap((frame) => frame.text.split(" ")).join(" ");
		expect(words(after.frames)).toBe(words(timeline.frames));
	});

	it("sends one change when the document ends inside the window", () => {
		const { session, timeline } = built(1000);
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position: at(0, 1),
			patch: { chunkSize: 2 },
		});
		const changes = changesOf(replies);
		expect(changes).toHaveLength(1);
		expect(changes[0]?.last).toBe(true);
		const index = timeline.frames.findIndex(
			(frame) => frame.position.block === 1,
		);
		expect(applyAll(timeline, replies, 300)).toEqual(
			rebuildTimeline(document, timeline, index, { ...settings, chunkSize: 2 }),
		);
	});

	it("matches an Engine's own updateSettings, for one small change", () => {
		const text = paragraphs(numbered(40));
		const session = createTimelineSession({ chunkFrames: 5 });
		const first = session.handle({
			kind: "build",
			id: 1,
			document: text,
			settings,
		});
		const timeline = applyAll({ frames: [], totalMs: 0 }, first, 300);
		const position = at(offsetOf(11));
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position,
			patch: { wpm: 600, chunkSize: 2 },
		});
		const engine = createEngine({
			clock: createManualClock(),
			document: text,
			settings,
		});
		engine.seek(position);
		engine.updateSettings({ wpm: 600, chunkSize: 2 });
		expect(applyAll(timeline, replies, 600)).toEqual(engine.timeline);
		expect(changesOf(replies)[0]?.settings).toEqual(engine.settings);
	});

	it("adds a patch to the settings of the one before", () => {
		const { session } = built();
		session.handle({
			kind: "settings",
			id: 2,
			position: at(0),
			patch: { chunkSize: 2 },
		});
		const replies = session.handle({
			kind: "settings",
			id: 3,
			position: at(0),
			patch: { smartSpeed: true },
		});
		const change = changesOf(replies)[0];
		expect(change?.settings.chunkSize).toBe(2);
		expect(change?.settings.smartSpeed).toBe(true);
	});

	it("clamps a Position past the end to the last Frame", () => {
		const { session, timeline } = built();
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position: at(99999, 99),
			patch: { chunkSize: 2 },
		});
		const [change] = changesOf(replies);
		expect(change?.fromIndex).toBe(timeline.frames.length - 1);
	});

	it("fails when nothing has been built yet", () => {
		const replies = createTimelineSession().handle({
			kind: "settings",
			id: 5,
			position: at(0),
			patch: { chunkSize: 2 },
		});
		expect(replies).toEqual([
			{ kind: "failed", id: 5, error: "no timeline to change" },
		]);
	});
});

describe("Timeline session: anchor", () => {
	const document = paragraphs(numbered(60));
	const ramp = { wpm: 300, rampSpanWords: 10 };

	function built() {
		const session = createTimelineSession({ chunkFrames: 7 });
		session.handle({ kind: "build", id: 1, document, settings: ramp });
		return { session, timeline: buildTimeline(document, ramp) };
	}

	it("restarts the ramp where the reader pressed play", () => {
		const { session, timeline } = built();
		const position = at(offsetOf(21));
		const replies = session.handle({ kind: "anchor", id: 2, position });
		const expected = rebuildTimeline(document, timeline, 20, ramp, {
			anchor: position,
		});
		expect(applyAll(timeline, replies, 300)).toEqual(expected);
		// The first word after the anchor is back at ramp-start speed: twice as long.
		expect(expected.frames[20]?.durationMs).toBeCloseTo(400, 5);
	});

	it("keeps that anchor when a setting changes afterwards", () => {
		const { session, timeline } = built();
		const position = at(offsetOf(21));
		const afterAnchor = applyAll(
			timeline,
			session.handle({ kind: "anchor", id: 2, position }),
			300,
		);
		const replies = session.handle({
			kind: "settings",
			id: 3,
			position: at(offsetOf(31)),
			patch: { chunkSize: 2 },
		});
		const expected = rebuildTimeline(
			document,
			afterAnchor,
			30,
			{ ...ramp, chunkSize: 2 },
			{ anchor: position },
		);
		expect(applyAll(afterAnchor, replies, 300)).toEqual(expected);
	});

	it("answers 'unchanged' when no rule counts from the anchor", () => {
		const session = createTimelineSession();
		session.handle({
			kind: "build",
			id: 1,
			document,
			settings: { wpm: 300 },
		});
		const replies = session.handle({
			kind: "anchor",
			id: 2,
			position: at(offsetOf(21)),
		});
		expect(replies).toEqual([{ kind: "unchanged", id: 2 }]);
	});

	it("answers 'unchanged' when the anchor has not moved", () => {
		const { session } = built();
		const position = at(offsetOf(21));
		session.handle({ kind: "anchor", id: 2, position });
		expect(session.handle({ kind: "anchor", id: 3, position })).toEqual([
			{ kind: "unchanged", id: 3 },
		]);
	});

	it("fails when nothing has been built yet", () => {
		expect(
			createTimelineSession().handle({
				kind: "anchor",
				id: 9,
				position: at(0),
			}),
		).toEqual([{ kind: "failed", id: 9, error: "no timeline to change" }]);
	});
});
