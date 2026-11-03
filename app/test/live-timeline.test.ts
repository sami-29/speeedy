import type { Document } from "@speeedy/contracts";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	createTimelineSession,
	rebuildTimeline,
	type TimelineChange,
	type TimelineReply,
	type TimelineRequest,
} from "@speeedy/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveTimeline } from "../src/lib/reader/live-timeline.ts";
import {
	createTimelineClient,
	type WorkerLike,
} from "../src/lib/reader/timeline-client.ts";

const numbered = (count: number) =>
	Array.from({ length: count }, (_, i) => `w${i + 1}`).join(" ");
const offsetOf = (word: number) =>
	Array.from({ length: word - 1 }, (_, i) => `w${i + 1} `).join("").length;
const at = (word: number) => ({ block: 0, offset: offsetOf(word) });

const DOCUMENT: Document = {
	version: 1,
	blocks: [{ kind: "paragraph", text: numbered(60), spans: [] }],
};

/** Twelve sentences of five words, three to a paragraph. */
const SENTENCES: Document = {
	version: 1,
	blocks: Array.from({ length: 4 }, (_, p) => ({
		kind: "paragraph" as const,
		text: Array.from(
			{ length: 3 },
			(_, s) =>
				`${Array.from({ length: 5 }, (_, k) => `s${p * 3 + s}x${k}`).join(" ")}.`,
		).join(" "),
		spans: [],
	})),
};

/** A worker that runs the real Timeline session in this thread and answers on a microtask. */
function loopback(windowWords?: number) {
	const session = createTimelineSession({
		chunkFrames: 4,
		...(windowWords ? { windowWords } : {}),
	});
	type Listener = (event: { data?: unknown }) => void;
	const listeners = {
		message: new Set<Listener>(),
		error: new Set<Listener>(),
	};
	const requests: TimelineRequest[] = [];
	const held: (() => void)[] = [];
	let holding = false;
	let failNext: string | undefined;

	const deliver = (replies: TimelineReply[]) => () => {
		queueMicrotask(() => {
			for (const reply of replies) {
				for (const listener of [...listeners.message])
					listener({ data: reply });
			}
		});
	};

	const worker: WorkerLike & {
		requests: TimelineRequest[];
		hold(): void;
		release(): void;
		failNext(error: string): void;
		crash(): void;
	} = {
		requests,
		postMessage(request: TimelineRequest) {
			requests.push(request);
			const replies: TimelineReply[] = failNext
				? [{ kind: "failed", id: request.id, error: failNext }]
				: session.handle(request);
			failNext = undefined;
			if (holding) held.push(deliver(replies));
			else deliver(replies)();
		},
		addEventListener(type: "message" | "error", listener: Listener) {
			listeners[type].add(listener);
		},
		removeEventListener(type: "message" | "error", listener: Listener) {
			listeners[type].delete(listener);
		},
		hold() {
			holding = true;
		},
		release() {
			holding = false;
			for (const send of held.splice(0)) send();
		},
		failNext(error: string) {
			failNext = error;
		},
		crash() {
			for (const listener of [...listeners.error]) listener({});
		},
	};
	return worker;
}

async function setup(
	settings: { wpm?: number; rampSpanWords?: number } = {},
	options: { document?: Document; windowWords?: number } = {},
) {
	const document = options.document ?? DOCUMENT;
	const worker = loopback(options.windowWords);
	const client = createTimelineClient(worker);
	const built = await client.build({
		document,
		settings: { wpm: 300, ...settings },
	});
	if (!built.ok) throw new Error(built.error);
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: built.timeline,
		settings: built.settings,
	});
	return { worker, client, engine, clock, document };
}

const settingsRequests = (worker: { requests: TimelineRequest[] }) =>
	worker.requests.filter((request) => request.kind === "settings");

describe("Timeline client", () => {
	it("builds the first Timeline in the worker and joins its chunks", async () => {
		const worker = loopback();
		const client = createTimelineClient(worker);
		const result = await client.build({
			document: DOCUMENT,
			settings: { wpm: 450 },
		});
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;
		expect(result.timeline).toEqual(buildTimeline(DOCUMENT, { wpm: 450 }));
		expect(result.settings.wpm).toBe(450);
		expect(worker.requests.map((request) => request.kind)).toEqual(["build"]);
	});

	it("hands over each phase of a change as soon as its chunks are in", async () => {
		const { client } = await setup({}, { document: SENTENCES, windowWords: 8 });
		const changes: TimelineChange[] = [];
		const result = await client.change(
			{
				kind: "settings",
				position: { block: 1, offset: 0 },
				patch: { chunkSize: 2 },
			},
			(change) => changes.push(change),
		);
		expect(result).toEqual({ ok: true });
		expect(changes.map((change) => change.phase)).toEqual(["window", "tail"]);
		expect(changes.map((change) => change.last)).toEqual([false, true]);
		expect(changes[0]?.settings.chunkSize).toBe(2);
	});

	it("reports a failed request", async () => {
		const { client, worker } = await setup();
		worker.failNext("no timeline to change");
		expect(
			await client.change({ kind: "anchor", position: at(1) }, () => {}),
		).toEqual({ ok: false, error: "no timeline to change" });
	});

	it("fails every request still waiting when the worker crashes", async () => {
		const { client, worker } = await setup();
		worker.hold();
		const waiting = client.change(
			{ kind: "settings", position: at(1), patch: { chunkSize: 2 } },
			() => {},
		);
		worker.crash();
		expect(await waiting).toMatchObject({ ok: false });
	});
});

describe("Live Timeline", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("applies a speed change at once, without touching a Frame or asking the worker", async () => {
		const { worker, client, engine } = await setup();
		const before = structuredClone(engine.timeline);
		const live = createLiveTimeline({ client, engine });
		for (let wpm = 260; wpm <= 400; wpm += 10) live.change({ wpm });
		expect(engine.settings.wpm).toBe(400);
		expect(engine.timeline).toEqual(before);
		await vi.advanceTimersByTimeAsync(1000);
		await live.settled();
		expect(settingsRequests(worker)).toHaveLength(0);
	});

	it("turns a burst of structural changes into one rebuild, with the speed the reader has", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		live.change({ chunkSize: 2 });
		await vi.advanceTimersByTimeAsync(20);
		live.change({ wpm: 400 });
		live.change({ smartSpeed: true });
		await vi.advanceTimersByTimeAsync(20);
		live.change({ chunkSize: 3 });
		expect(settingsRequests(worker)).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(500);
		await live.settled();
		const sent = settingsRequests(worker);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			patch: { chunkSize: 3, smartSpeed: true, wpm: 400 },
		});
		expect(engine.settings).toMatchObject({
			wpm: 400,
			chunkSize: 3,
			smartSpeed: true,
		});
	});

	it("keeps the Frame on screen while the rebuild is in flight", async () => {
		const { worker, client, engine } = await setup();
		const shown: string[] = [];
		engine.on("frameShown", ({ frame }) => shown.push(frame.text));
		engine.seek(at(11));
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ smartSpeed: true });
		await vi.advanceTimersByTimeAsync(300);
		expect(engine.frame?.text).toBe("w11");
		expect(engine.settings.smartSpeed).toBe(false);
		worker.release();
		await live.settled();
		expect(engine.frame?.text).toBe("w11");
		expect(engine.settings.smartSpeed).toBe(true);
		expect(shown).toEqual([]);
	});

	it("rebuilds the same Timeline an Engine would", async () => {
		const { client, engine, document } = await setup();
		engine.seek(at(11));
		const before = engine.timeline;
		const live = createLiveTimeline({ client, engine });
		live.change({ chunkSize: 2, smartSpeed: true });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		const expected = rebuildTimeline(document, before, 10, {
			wpm: 300,
			chunkSize: 2,
			smartSpeed: true,
		});
		expect(engine.timeline.frames).toEqual(expected.frames);
		expect(engine.timeline.totalMs).toBe(expected.totalMs);
	});

	it("gives a rebuild in two phases the same Timeline as one rebuild, window first", async () => {
		const { client, engine, document } = await setup(
			{},
			{ document: SENTENCES, windowWords: 8 },
		);
		engine.seek({ block: 1, offset: 0 });
		const before = engine.timeline;
		const index = engine.index;
		const onApplied = vi.fn();
		const live = createLiveTimeline({ client, engine, onApplied });
		live.change({ chunkSize: 2 });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		expect(onApplied.mock.calls.map(([info]) => info.phase)).toEqual([
			"window",
			"tail",
		]);
		const expected = rebuildTimeline(document, before, index, {
			wpm: 300,
			chunkSize: 2,
		});
		expect(engine.timeline).toEqual(expected);
	});

	it("applies to where the Cursor is now, not where it was when asked", async () => {
		const { worker, client, engine } = await setup();
		engine.seek(at(11));
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ smartSpeed: true });
		await vi.advanceTimersByTimeAsync(300);
		engine.seek(at(15));
		worker.release();
		await live.settled();
		expect(engine.position).toEqual(at(15));
		expect(engine.frame?.text).toBe("w15");
	});

	it("keeps the reader's speed when a rebuild made at the old one comes back", async () => {
		const { worker, client, engine, document } = await setup();
		const before = engine.timeline;
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ smartSpeed: true });
		await vi.advanceTimersByTimeAsync(300);
		// The reader speeds up while the worker is still building at 300.
		live.change({ wpm: 600 });
		worker.release();
		await live.settled();
		expect(engine.settings.wpm).toBe(600);
		expect(engine.timelineWpm).toBe(300);
		expect(engine.timeline).toEqual(
			rebuildTimeline(document, before, 0, { wpm: 300, smartSpeed: true }),
		);
	});

	it("brings a rebuild made at a newer speed back to the Timeline's own", async () => {
		const { client, engine, document } = await setup();
		const before = engine.timeline;
		const live = createLiveTimeline({ client, engine });
		live.change({ wpm: 600 });
		live.change({ smartSpeed: true });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		// The worker built at 600; the Frames are in the Timeline's 300 and play at 600.
		expect(engine.settings.wpm).toBe(600);
		expect(engine.timelineWpm).toBe(300);
		const expected = rebuildTimeline(document, before, 0, {
			wpm: 300,
			smartSpeed: true,
		});
		engine.timeline.frames.forEach((frame, index) => {
			expect(frame.startMs).toBeCloseTo(
				expected.frames[index]?.startMs ?? 0,
				1,
			);
			expect(frame.durationMs).toBeCloseTo(
				expected.frames[index]?.durationMs ?? 0,
				2,
			);
		});
	});

	it("sends changes made during a rebuild afterwards, as one, in order", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ chunkSize: 2 });
		await vi.advanceTimersByTimeAsync(300);
		live.change({ smartSpeed: true });
		live.change({ chunkSize: 3 });
		await vi.advanceTimersByTimeAsync(300);
		expect(settingsRequests(worker)).toHaveLength(1);
		worker.release();
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		const sent = settingsRequests(worker);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toMatchObject({
			patch: { chunkSize: 3, smartSpeed: true },
		});
		expect(engine.settings).toMatchObject({ chunkSize: 3, smartSpeed: true });
	});

	it("sends an anchor at once, after any change still waiting", async () => {
		const { worker, client, engine } = await setup({ rampSpanWords: 10 });
		const live = createLiveTimeline({ client, engine });
		live.change({ smartSpeed: true });
		live.anchor(at(21));
		await live.settled();
		expect(worker.requests.slice(1).map((request) => request.kind)).toEqual([
			"settings",
			"anchor",
		]);
	});

	it("does not send the same anchor twice", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		live.anchor(at(21));
		live.anchor(at(21));
		await live.settled();
		expect(
			worker.requests.filter((request) => request.kind === "anchor"),
		).toHaveLength(1);
	});

	it("restarts the ramp for a new anchor", async () => {
		const { client, engine } = await setup({ rampSpanWords: 10 });
		const live = createLiveTimeline({ client, engine });
		live.anchor(at(21));
		await live.settled();
		expect(engine.timeline.frames[20]?.durationMs).toBeCloseTo(400, 5);
	});

	it("reports a failure and keeps the Timeline it has", async () => {
		const { worker, client, engine } = await setup();
		const onError = vi.fn();
		const live = createLiveTimeline({ client, engine, onError });
		const before = engine.timeline;
		worker.failNext("timeline could not be built");
		live.change({ chunkSize: 2 });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		expect(onError).toHaveBeenCalledWith("timeline could not be built");
		expect(engine.timeline).toBe(before);

		live.change({ chunkSize: 3 });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		expect(engine.settings.chunkSize).toBe(3);
	});

	it("reports how long the reader waited, from the first change", async () => {
		const { worker, client, engine } = await setup();
		let now = 1000;
		const onApplied = vi.fn();
		const live = createLiveTimeline({
			client,
			engine,
			onApplied,
			now: () => now,
		});
		worker.hold();
		live.change({ chunkSize: 2 });
		now = 1060;
		live.change({ chunkSize: 3 });
		await vi.advanceTimersByTimeAsync(300);
		now = 1400;
		worker.release();
		await live.settled();
		expect(onApplied).toHaveBeenCalledTimes(1);
		expect(onApplied).toHaveBeenCalledWith({
			request: "settings",
			phase: "tail",
			latencyMs: 400,
		});
	});

	it("reports a speed change as instant", async () => {
		const { client, engine } = await setup();
		const onApplied = vi.fn();
		const live = createLiveTimeline({
			client,
			engine,
			onApplied,
			now: () => 5,
		});
		live.change({ wpm: 500 });
		expect(onApplied).toHaveBeenCalledWith({
			request: "settings",
			phase: "wpm",
			latencyMs: 0,
		});
	});

	it("does nothing after dispose", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		live.change({ chunkSize: 2 });
		live.dispose();
		await vi.advanceTimersByTimeAsync(1000);
		expect(settingsRequests(worker)).toHaveLength(0);
		expect(engine.settings.chunkSize).toBe(1);
	});

	it("does not apply a reply that arrives after dispose", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ chunkSize: 2 });
		await vi.advanceTimersByTimeAsync(300);
		live.dispose();
		worker.release();
		await vi.advanceTimersByTimeAsync(10);
		expect(engine.settings.chunkSize).toBe(1);
	});
});
