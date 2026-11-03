// The app's typed send function, driven through a fake fetch.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CANARY,
	createAnalytics,
	EVENTS,
	privacyCases,
	validExamples,
} from "../src/index.ts";

interface Sent {
	url: string;
	init: RequestInit;
	body: {
		visit: string;
		events: { event: string; properties: Record<string, unknown> }[];
	};
}

function harness(options: Partial<Parameters<typeof createAnalytics>[0]> = {}) {
	const sent: Sent[] = [];
	const scheduled: (() => void)[] = [];
	const analytics = createAnalytics({
		endpoint: "/api/e",
		fetch: async (url, init) => {
			sent.push({
				url: String(url),
				init: init ?? {},
				body: JSON.parse(String(init?.body)),
			});
			return new Response(null, { status: 202 });
		},
		schedule: (fn) => {
			scheduled.push(fn);
		},
		...options,
	});
	return { analytics, sent, scheduled };
}

describe("typed send function", () => {
	it("batches queued events into one request carrying the Visit ID", async () => {
		const { analytics, sent } = harness();
		analytics.track("$pageview", { route: "/reader" });
		analytics.track("feature_survey_answered", { idea_sync: true });
		assert.equal(sent.length, 0, "nothing is sent before the flush");

		await analytics.flush();

		assert.equal(sent.length, 1);
		assert.equal(sent[0].url, "/api/e");
		assert.equal(sent[0].body.visit, analytics.visitId);
		assert.deepEqual(sent[0].body.events, [
			{ event: "$pageview", properties: { route: "/reader" } },
			{ event: "feature_survey_answered", properties: { idea_sync: true } },
		]);
	});

	it("sends without cookies, referrer or credentials", async () => {
		const { analytics, sent } = harness();
		analytics.track("$pageview", { route: "/" });
		await analytics.flush();
		const init = sent[0].init;
		assert.equal(init.method, "POST");
		assert.equal(init.credentials, "omit");
		assert.equal(init.referrerPolicy, "no-referrer");
		assert.equal(init.keepalive, true);
		assert.deepEqual(init.headers, { "content-type": "application/json" });
	});

	it("makes a random Visit ID per instance and keeps it for the whole visit", async () => {
		const a = harness();
		const b = harness();
		assert.match(a.analytics.visitId, /^[A-Za-z0-9-]{8,64}$/);
		assert.notEqual(a.analytics.visitId, b.analytics.visitId);
		a.analytics.track("$pageview", { route: "/" });
		await a.analytics.flush();
		a.analytics.track("$pageview", { route: "/library" });
		await a.analytics.flush();
		assert.equal(a.sent[0].body.visit, a.sent[1].body.visit);
	});

	it("never stores the Visit ID", async () => {
		const touched: string[] = [];
		const trap = new Proxy(
			{},
			{
				get(_, key) {
					touched.push(String(key));
					return () => null;
				},
			},
		);
		const globals = globalThis as Record<string, unknown>;
		const before = {
			localStorage: globals.localStorage,
			sessionStorage: globals.sessionStorage,
		};
		Object.defineProperty(globals, "localStorage", {
			value: trap,
			configurable: true,
		});
		Object.defineProperty(globals, "sessionStorage", {
			value: trap,
			configurable: true,
		});
		try {
			const { analytics } = harness();
			analytics.track("$pageview", { route: "/" });
			await analytics.flush();
		} finally {
			Object.defineProperty(globals, "localStorage", {
				value: before.localStorage,
				configurable: true,
			});
			Object.defineProperty(globals, "sessionStorage", {
				value: before.sessionStorage,
				configurable: true,
			});
		}
		assert.deepEqual(touched, []);
	});

	it("sends nothing when there is nothing queued", async () => {
		const { analytics, sent } = harness();
		await analytics.flush();
		assert.equal(sent.length, 0);
	});

	it("splits a long queue into batches of at most 20 events", async () => {
		const { analytics, sent } = harness();
		for (let i = 0; i < 45; i++) analytics.track("$pageview", { route: "/" });
		await analytics.flush();
		assert.deepEqual(
			sent.map((s) => s.body.events.length),
			[20, 20, 5],
		);
	});

	it("schedules one flush per queue, then flushes when it fires", async () => {
		const { analytics, sent, scheduled } = harness();
		analytics.track("$pageview", { route: "/" });
		analytics.track("$pageview", { route: "/library" });
		assert.equal(scheduled.length, 1);
		await analytics.flush();
		assert.equal(sent.length, 1);
		analytics.track("$pageview", { route: "/" });
		assert.equal(scheduled.length, 2);
	});

	it("sends a route-only pageview for any location", async () => {
		const { analytics, sent } = harness();
		analytics.trackPageview(`/s?token=${CANARY}#${CANARY}`);
		await analytics.flush();
		assert.deepEqual(sent[0].body.events, [
			{ event: "$pageview", properties: { route: "/s" } },
		]);
		assert.ok(!JSON.stringify(sent).includes(CANARY));
	});

	it("survives a failed request without throwing", async () => {
		const { analytics } = harness({
			fetch: async () => {
				throw new TypeError("offline");
			},
		});
		analytics.track("$pageview", { route: "/" });
		await analytics.flush();
	});

	it("sends every valid example the registry generates", async () => {
		const { analytics, sent } = harness();
		const examples = validExamples(EVENTS).filter((e) => e.origin === "client");
		for (const ex of examples) {
			assert.equal(
				analytics.track(ex.event as never, ex.properties as never),
				true,
				ex.event,
			);
		}
		await analytics.flush();
		assert.equal(sent.flatMap((s) => s.body.events).length, examples.length);
	});

	it("drops every generated privacy case before it leaves the device", async () => {
		const { analytics, sent } = harness();
		for (const c of privacyCases(EVENTS)) {
			assert.equal(
				analytics.track(c.event as never, c.properties as never),
				false,
				c.label,
			);
		}
		await analytics.flush();
		assert.equal(sent.length, 0);
	});
});
