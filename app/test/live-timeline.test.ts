import {
	buildTimeline,
	createEngine,
	createManualClock,
	createTimelineSession,
	rebuildTimeline,
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

const DOCUMENT = {
	version: 1 as const,
	blocks: [{ kind: "paragraph" as const, text: numbered(60), spans: [] }],
};

/** A worker that runs the real Timeline session in this thread and answers on a microtask. */
function loopback() {
	const session = createTimelineSession({ chunkFrames: 4 });
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

async function setup(settings: { wpm?: number; rampSpanWords?: number } = {}) {
	const worker = loopback();
	const client = createTimelineClient(worker);
	const built = await client.build({
		document: DOCUMENT,
		settings: { wpm: 300, ...settings },
	});
	if (!built.ok) throw new Error(built.error);
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: built.timeline,
		settings: built.settings,
	});
	return { worker, client, engine, clock };
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

	it("asks for a settings change and gets the tail back", async () => {
		const { client } = await setup();
		const result = await client.change({
			kind: "settings",
			position: at(11),
			patch: { wpm: 600 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.change?.fromIndex).toBe(10);
		expect(result.change?.frames).toHaveLength(50);
		expect(result.change?.settings.wpm).toBe(600);
	});

	it("reports a failed request", async () => {
		const { client, worker } = await setup();
		worker.failNext("no timeline to change");
		expect(await client.change({ kind: "anchor", position: at(1) })).toEqual({
			ok: false,
			error: "no timeline to change",
		});
	});

	it("fails every request still waiting when the worker crashes", async () => {
		const { client, worker } = await setup();
		worker.hold();
		const waiting = client.change({
			kind: "settings",
			position: at(1),
			patch: { wpm: 600 },
		});
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

	it("turns a drag of the slider into one rebuild", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		for (let wpm = 260; wpm <= 400; wpm += 10) {
			live.change({ wpm });
			await vi.advanceTimersByTimeAsync(20);
		}
		expect(settingsRequests(worker)).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		const sent = settingsRequests(worker);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ patch: { wpm: 400 } });
		expect(engine.settings.wpm).toBe(400);
		expect(engine.timeline.frames[59]?.durationMs).toBe(150);
	});

	it("keeps the Frame on screen while the rebuild is in flight", async () => {
		const { worker, client, engine } = await setup();
		const shown: string[] = [];
		engine.on("frameShown", ({ frame }) => shown.push(frame.text));
		engine.seek(at(11));
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ wpm: 600 });
		await vi.advanceTimersByTimeAsync(300);
		expect(engine.frame?.text).toBe("w11");
		expect(engine.settings.wpm).toBe(300);
		worker.release();
		await live.settled();
		expect(engine.frame?.text).toBe("w11");
		expect(engine.settings.wpm).toBe(600);
		expect(shown).toEqual([]);
	});

	it("rebuilds the same Timeline an Engine would", async () => {
		const { client, engine } = await setup();
		engine.seek(at(11));
		const before = engine.timeline;
		const live = createLiveTimeline({ client, engine });
		live.change({ wpm: 600, chunkSize: 2 });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		const expected = rebuildTimeline(DOCUMENT, before, 10, {
			wpm: 600,
			chunkSize: 2,
		});
		expect(engine.timeline.frames).toEqual(expected.frames);
		expect(engine.timeline.totalMs).toBe(expected.totalMs);
	});

	it("applies to where the Cursor is now, not where it was when asked", async () => {
		const { worker, client, engine } = await setup();
		engine.seek(at(11));
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ wpm: 600 });
		await vi.advanceTimersByTimeAsync(300);
		engine.seek(at(15));
		worker.release();
		await live.settled();
		expect(engine.position).toEqual(at(15));
		expect(engine.frame?.text).toBe("w15");
	});

	it("sends changes made during a rebuild afterwards, as one, in order", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ wpm: 400 });
		await vi.advanceTimersByTimeAsync(300);
		live.change({ chunkSize: 2 });
		live.change({ smartSpeed: true });
		await vi.advanceTimersByTimeAsync(300);
		expect(settingsRequests(worker)).toHaveLength(1);
		worker.release();
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		const sent = settingsRequests(worker);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toMatchObject({
			patch: { chunkSize: 2, smartSpeed: true },
		});
		expect(engine.settings).toMatchObject({
			wpm: 400,
			chunkSize: 2,
			smartSpeed: true,
		});
	});

	it("sends an anchor at once, after any change still waiting", async () => {
		const { worker, client, engine } = await setup({ rampSpanWords: 10 });
		const live = createLiveTimeline({ client, engine });
		live.change({ wpm: 400 });
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
		live.change({ wpm: 600 });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		expect(onError).toHaveBeenCalledWith("timeline could not be built");
		expect(engine.timeline).toBe(before);

		live.change({ wpm: 500 });
		await vi.advanceTimersByTimeAsync(300);
		await live.settled();
		expect(engine.settings.wpm).toBe(500);
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
		live.change({ wpm: 600 });
		now = 1060;
		live.change({ wpm: 700 });
		await vi.advanceTimersByTimeAsync(300);
		now = 1400;
		worker.release();
		await live.settled();
		expect(onApplied).toHaveBeenCalledTimes(1);
		expect(onApplied).toHaveBeenCalledWith({
			request: "settings",
			latencyMs: 400,
		});
	});

	it("does nothing after dispose", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		live.change({ wpm: 600 });
		live.dispose();
		await vi.advanceTimersByTimeAsync(1000);
		expect(settingsRequests(worker)).toHaveLength(0);
		expect(engine.settings.wpm).toBe(300);
	});

	it("does not apply a reply that arrives after dispose", async () => {
		const { worker, client, engine } = await setup();
		const live = createLiveTimeline({ client, engine });
		worker.hold();
		live.change({ wpm: 600 });
		await vi.advanceTimersByTimeAsync(300);
		live.dispose();
		worker.release();
		await vi.advanceTimersByTimeAsync(10);
		expect(engine.settings.wpm).toBe(300);
	});
});
