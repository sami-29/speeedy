import "fake-indexeddb/auto";
import type { Document } from "@speeedy/contracts";
import { checkEvent, clientEvents, EVENTS } from "@speeedy/contracts";
import {
	buildTimeline,
	createEngine,
	createManualClock,
} from "@speeedy/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLibraryStore,
	LIBRARY_DB_NAME,
	type LibraryStore,
} from "../src/lib/library/store.ts";
import { recordSessions } from "../src/lib/stats/record.ts";
import { sessionStartProps } from "../src/lib/stats/session-start.ts";

const visit = { surface: "web", ref: "hn" } as const;
const past = (date: string, activeMs = 90_000) => ({ date, activeMs });
const props = (input: Partial<Parameters<typeof sessionStartProps>[0]> = {}) =>
	sessionStartProps({
		sessions: [],
		today: "2026-11-03",
		source: "own",
		visit,
		...input,
	});

describe("session_started properties", () => {
	it("marks a first ever Session: first of the month, day 0, Session 1", () => {
		expect(props()).toEqual({
			source: "own",
			surface: "web",
			ref: "hn",
			first_this_month: true,
			days_since_first: "0",
			lifetime_sessions: "1",
		});
	});

	it("leaves the ref out when the Visit had none", () => {
		expect(props({ visit: { surface: "pwa" } })).not.toHaveProperty("ref");
		expect(props({ visit: { surface: "pwa" } })).toHaveProperty(
			"surface",
			"pwa",
		);
	});

	it("passes the source on", () => {
		expect(props({ source: "demo" }).source).toBe("demo");
		expect(props({ source: "share" }).source).toBe("share");
	});

	it("counts the Session that is starting in the lifetime bucket", () => {
		const sessions = Array.from({ length: 5 }, () => past("2026-11-01"));
		expect(props({ sessions }).lifetime_sessions).toBe("6-20");
		expect(props({ sessions: sessions.slice(0, 4) }).lifetime_sessions).toBe(
			"2-5",
		);
		expect(
			props({ sessions: Array.from({ length: 20 }, () => past("2026-11-01")) })
				.lifetime_sessions,
		).toBe("21-plus");
	});

	it.each([
		["2026-11-03", "0"],
		["2026-11-02", "1-6"],
		["2026-10-28", "1-6"],
		["2026-10-27", "7-29"],
		["2026-10-05", "7-29"],
		["2026-10-04", "30-89"],
		["2026-08-06", "30-89"],
		["2026-08-05", "90-plus"],
		["2024-01-01", "90-plus"],
	])("puts a first Session on %s in the day bucket %s", (first, bucket) => {
		expect(
			props({ sessions: [past("2026-11-03"), past(first)] }).days_since_first,
		).toBe(bucket);
	});

	it("counts calendar days on the local dates, across a clock change", () => {
		expect(
			props({ sessions: [past("2026-03-07")], today: "2026-03-14" })
				.days_since_first,
		).toBe("7-29");
		expect(
			props({ sessions: [past("2026-10-31")], today: "2026-11-02" })
				.days_since_first,
		).toBe("1-6");
	});

	it("reads the first Session from the earliest one, whatever the order", () => {
		expect(
			props({
				sessions: [past("2026-11-01"), past("2025-01-01"), past("2026-10-01")],
			}).days_since_first,
		).toBe("90-plus");
	});

	it("is the first activation of the month until a Session of 60 s or more is stored in it", () => {
		expect(props({ sessions: [] }).first_this_month).toBe(true);
		// Last month's reading does not count.
		expect(props({ sessions: [past("2026-10-31")] }).first_this_month).toBe(
			true,
		);
		// Too short to activate.
		expect(
			props({ sessions: [past("2026-11-01", 59_999)] }).first_this_month,
		).toBe(true);
		expect(
			props({ sessions: [past("2026-11-01", 60_000)] }).first_this_month,
		).toBe(false);
		// The same month, a later Session of the month.
		expect(
			props({ sessions: [past("2026-11-02", 600_000)] }).first_this_month,
		).toBe(false);
	});

	it("uses the calendar month of the date it is given, not UTC", () => {
		// 23:30 on 31 October in New York is already November in UTC. The device passes its
		// local date, so the Session belongs to October.
		expect(
			props({ sessions: [past("2026-10-31")], today: "2026-10-31" })
				.first_this_month,
		).toBe(false);
		expect(
			props({ sessions: [past("2026-10-31")], today: "2026-11-01" })
				.first_this_month,
		).toBe(true);
	});

	it("passes the registry's check and carries nothing else", () => {
		const sent = props({ sessions: [past("2026-10-01")] });
		expect(Object.keys(sent).sort()).toEqual(
			[
				"days_since_first",
				"first_this_month",
				"lifetime_sessions",
				"ref",
				"source",
				"surface",
			].sort(),
		);
		expect(checkEvent(clientEvents(EVENTS), "session_started", sent).ok).toBe(
			true,
		);
	});
});

const START = Date.UTC(2026, 10, 3, 17, 0, 0); // 12:00 in New York on 2026-11-03
const ZONE = "America/New_York";
const WORDS = Array.from({ length: 4_000 }, (_, i) => `word${i}`).join(" ");
const DOCUMENT: Document = {
	version: 1,
	blocks: [{ kind: "paragraph", text: WORDS, spans: [] }],
};

let counter = 0;
let store: LibraryStore;
let tracked: [string, Record<string, unknown>][];

beforeEach(() => {
	store = createLibraryStore({
		name: `${LIBRARY_DB_NAME}-start-${++counter}`,
	});
	tracked = [];
});
afterEach(() => store.close());

function setup(options: { source?: "own" | "demo" | "share" } = {}) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(DOCUMENT, {
			wpm: 300,
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
		}),
	});
	const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
	const recording = recordSessions({
		engine,
		clock,
		store,
		documentId: "doc-1",
		track: (event, props) => tracked.push([event, props]),
		now: () => START + clock.now(),
		timeZone: ZONE,
		page: { window: new EventTarget(), document: doc },
		start: { source: options.source ?? "own", visit: () => visit },
	});
	const read = (seconds: number) => {
		engine.play();
		for (let left = seconds * 1000; left > 0; left -= 10) clock.advance(10);
		engine.pause();
	};
	return { engine, clock, recording, read, doc };
}

const starts = () => tracked.filter(([event]) => event === "session_started");

describe("recording a Session start", () => {
	it("sends session_started once, when the reader first plays", async () => {
		const { recording, read, engine } = setup({ source: "demo" });
		await recording.idle();
		expect(starts()).toEqual([]);
		read(5);
		await recording.idle();
		expect(starts()).toEqual([
			[
				"session_started",
				{
					source: "demo",
					surface: "web",
					ref: "hn",
					first_this_month: true,
					days_since_first: "0",
					lifetime_sessions: "1",
				},
			],
		]);
		// Pausing and playing again inside the Session starts nothing new.
		engine.play();
		engine.pause();
		read(5);
		await recording.idle();
		expect(starts()).toHaveLength(1);
		recording.end();
	});

	it("sends nothing when the reader never plays", async () => {
		const { recording } = setup();
		recording.end();
		await recording.idle();
		expect(tracked).toEqual([]);
	});

	it("starts a new Session after a save, with the earlier one counted", async () => {
		const { recording, read } = setup();
		read(90);
		recording.flush();
		read(10);
		await recording.idle();
		const sent = starts().map(([, p]) => p);
		expect(sent).toHaveLength(2);
		expect(sent[0]).toMatchObject({
			first_this_month: true,
			lifetime_sessions: "1",
		});
		expect(sent[1]).toMatchObject({
			// The first Session read 90 s, so this month is already activated.
			first_this_month: false,
			days_since_first: "0",
			lifetime_sessions: "2-5",
		});
		recording.end();
	});

	it("reads the retention buckets from the Sessions the device kept", async () => {
		for (const [index, date] of [
			"2026-07-01",
			"2026-10-20",
			"2026-11-01",
		].entries()) {
			await store.addSession({
				date,
				startedAt: Date.UTC(2026, 6, 1) + index,
				activeMs: 120_000,
				wordsRead: 500,
				wpm: 250,
				documentId: null,
			});
		}
		const { recording, read } = setup();
		read(5);
		await recording.idle();
		expect(starts()[0]?.[1]).toMatchObject({
			first_this_month: false,
			days_since_first: "90-plus",
			lifetime_sessions: "2-5",
		});
		recording.end();
	});

	it("is quiet, and reading goes on, when the Library cannot be read", async () => {
		const broken = {
			addSession: () => Promise.reject(new Error("blocked")),
			sessions: () => Promise.reject(new Error("blocked")),
			dailyGoalChanges: () => Promise.reject(new Error("blocked")),
		};
		const clock = createManualClock();
		const engine = createEngine({
			clock,
			timeline: buildTimeline(DOCUMENT, {
				wpm: 300,
				sentencePauseMultiplier: 0,
				paragraphPauseMultiplier: 1,
			}),
		});
		const recording = recordSessions({
			engine,
			clock,
			store: broken,
			track: (event, props) => tracked.push([event, props]),
			page: {
				window: new EventTarget(),
				document: Object.assign(new EventTarget(), {
					visibilityState: "visible",
				}),
			},
			start: { source: "own", visit: () => visit },
		});
		engine.play();
		clock.advance(1000);
		engine.pause();
		await expect(recording.idle()).resolves.toBeUndefined();
		expect(starts()).toEqual([]);
	});

	it("sends no start event when it was not asked to", async () => {
		const clock = createManualClock();
		const engine = createEngine({
			clock,
			timeline: buildTimeline(DOCUMENT, {
				wpm: 300,
				sentencePauseMultiplier: 0,
				paragraphPauseMultiplier: 1,
			}),
		});
		const recording = recordSessions({
			engine,
			clock,
			store,
			track: (event, props) => tracked.push([event, props]),
			page: {
				window: new EventTarget(),
				document: Object.assign(new EventTarget(), {
					visibilityState: "visible",
				}),
			},
		});
		engine.play();
		clock.advance(1000);
		engine.pause();
		await recording.idle();
		expect(starts()).toEqual([]);
		recording.end();
	});
});

describe("the event budget", () => {
	it("sends at most 2 events per Session over a scripted Visit", async () => {
		const { recording, read, engine, doc } = setup();
		// A reader plays, pauses, seeks, plays again, switches tab and comes back: three
		// Sessions, because hiding the tab saves one and returning starts another.
		read(70);
		engine.seek({ block: 0, offset: 0 });
		read(70);
		doc.visibilityState = "hidden";
		doc.dispatchEvent(new Event("visibilitychange"));
		doc.visibilityState = "visible";
		doc.dispatchEvent(new Event("visibilitychange"));
		read(30);
		recording.end();
		await recording.idle();
		const sessions = await store.sessions();
		expect(sessions.length).toBeGreaterThanOrEqual(2);
		// Session starts plus the one-a-day goal event, with the import's own event on top.
		const imports = 1;
		expect(tracked.length + imports).toBeLessThanOrEqual(2 * sessions.length);
		// Nothing is sent per word, per Frame or per second.
		expect(starts()).toHaveLength(sessions.length);
	});
});
