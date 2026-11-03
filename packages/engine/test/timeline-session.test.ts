import type { Position } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	createTimelineSession,
	type Frame,
	rebuildTimeline,
	type TimelineReply,
} from "../src/index";
import { paragraphs } from "./helpers";

const at = (offset: number, block = 0): Position => ({ block, offset });

/** `w1 w2 ... wN`, so a word's number is its place and its Position is easy to tell. */
const numbered = (count: number) =>
	Array.from({ length: count }, (_, i) => `w${i + 1}`).join(" ");
const offsetOf = (word: number) =>
	Array.from({ length: word - 1 }, (_, i) => `w${i + 1} `).join("").length;

type Chunk = Extract<TimelineReply, { kind: "chunk" }>;

function chunksOf(replies: TimelineReply[]): Chunk[] {
	return replies.filter((reply): reply is Chunk => reply.kind === "chunk");
}

function framesOf(replies: TimelineReply[]): Frame[] {
	return chunksOf(replies).flatMap((chunk) => chunk.frames);
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
		const chunks = chunksOf(replies);
		expect(chunks.length).toBe(Math.ceil(expected.frames.length / 3));
		expect(chunks.map((chunk) => chunk.part)).toEqual(
			chunks.map((_, index) => index),
		);
		for (const chunk of chunks) {
			expect(chunk.id).toBe(4);
			expect(chunk.parts).toBe(chunks.length);
			expect(chunk.fromIndex).toBe(0);
			expect(chunk.totalMs).toBe(expected.totalMs);
			expect(chunk.settings.wpm).toBe(450);
		}
		expect(framesOf(replies)).toEqual(expected.frames);
	});

	it("answers an empty Document with one empty chunk", () => {
		const session = createTimelineSession();
		const replies = session.handle({
			kind: "build",
			id: 1,
			document: { version: 1, blocks: [] },
		});
		expect(chunksOf(replies)).toHaveLength(1);
		expect(framesOf(replies)).toEqual([]);
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
		const second = paragraphs("alpha beta gamma");
		session.handle({ kind: "build", id: 2, document: second });
		const replies = session.handle({
			kind: "settings",
			id: 3,
			position: at(0),
			patch: { wpm: 600 },
		});
		expect(framesOf(replies).map((frame) => frame.text)).toEqual([
			"alpha",
			"beta",
			"gamma",
		]);
	});
});

describe("Timeline session: settings", () => {
	const document = paragraphs(numbered(40));

	function built() {
		const session = createTimelineSession({ chunkFrames: 5 });
		session.handle({
			kind: "build",
			id: 1,
			document,
			settings: { wpm: 300 },
		});
		return session;
	}

	it("gives the tail an Engine's own updateSettings would give", () => {
		const session = built();
		const position = at(offsetOf(11));
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position,
			patch: { wpm: 600, chunkSize: 2 },
		});

		const engine = createEngine({
			clock: createManualClock(),
			document,
			settings: { wpm: 300 },
		});
		engine.seek(position);
		engine.updateSettings({ wpm: 600, chunkSize: 2 });

		const chunks = chunksOf(replies);
		expect(chunks.length).toBeGreaterThan(1);
		const fromIndex = chunks[0]?.fromIndex ?? -1;
		expect(fromIndex).toBe(10);
		expect(chunks.every((chunk) => chunk.fromIndex === fromIndex)).toBe(true);
		expect(framesOf(replies)).toEqual(engine.timeline.frames.slice(fromIndex));
		expect(chunks[0]?.totalMs).toBe(engine.timeline.totalMs);
		expect(chunks[0]?.settings).toEqual(engine.settings);
	});

	it("starts the tail where the Frames before the Cursor end", () => {
		const session = built();
		const before = buildTimeline(document, { wpm: 300 });
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position: at(offsetOf(11)),
			patch: { wpm: 600 },
		});
		const tail = framesOf(replies);
		expect(tail[0]?.startMs).toBe(before.frames[10]?.startMs);
		expect(tail[0]?.position).toEqual(before.frames[10]?.position);
		expect(tail[0]?.durationMs).toBe(100);
	});

	it("adds a patch to the settings of the one before", () => {
		const session = built();
		session.handle({
			kind: "settings",
			id: 2,
			position: at(0),
			patch: { wpm: 600 },
		});
		const replies = session.handle({
			kind: "settings",
			id: 3,
			position: at(0),
			patch: { chunkSize: 2 },
		});
		const settings = chunksOf(replies)[0]?.settings;
		expect(settings?.wpm).toBe(600);
		expect(settings?.chunkSize).toBe(2);
	});

	it("clamps a Position past the end to the last Frame", () => {
		const session = built();
		const replies = session.handle({
			kind: "settings",
			id: 2,
			position: at(99999),
			patch: { wpm: 600 },
		});
		expect(chunksOf(replies)[0]?.fromIndex).toBe(39);
		expect(framesOf(replies)).toHaveLength(1);
	});

	it("fails when nothing has been built yet", () => {
		const replies = createTimelineSession().handle({
			kind: "settings",
			id: 5,
			position: at(0),
			patch: { wpm: 600 },
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
		expect(chunksOf(replies)[0]?.fromIndex).toBe(20);
		expect(framesOf(replies)).toEqual(expected.frames.slice(20));
		// The first word after the anchor is back at ramp-start speed: twice as long.
		expect(framesOf(replies)[0]?.durationMs).toBeCloseTo(400, 5);
	});

	it("keeps that anchor when a setting changes afterwards", () => {
		const { session, timeline } = built();
		const position = at(offsetOf(21));
		session.handle({ kind: "anchor", id: 2, position });
		const replies = session.handle({
			kind: "settings",
			id: 3,
			position: at(offsetOf(31)),
			patch: { wpm: 400 },
		});
		const anchored = rebuildTimeline(document, timeline, 20, ramp, {
			anchor: position,
		});
		const expected = rebuildTimeline(
			document,
			anchored,
			30,
			{ ...ramp, wpm: 400 },
			{ anchor: position },
		);
		expect(framesOf(replies)).toEqual(expected.frames.slice(30));
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
