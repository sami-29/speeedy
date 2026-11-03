// The event registry is the one list of what Speeedy may send to analytics.
// Run with: node --test test/*.test.ts (from packages/contracts)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	CANARY,
	checkEvent,
	clientEvents,
	EVENTS,
	eventList,
	pageviewFor,
	privacyCases,
	registryProblems,
	renderEventListMarkdown,
	serverEvents,
	validExamples,
} from "../src/index.ts";

const text = { kind: "text", max: 100 } as const;

function withEvent(def: Record<string, unknown>) {
	return { ...EVENTS, broken_event: def } as never;
}

function definition(extra: Record<string, unknown>) {
	return {
		origin: "client",
		kind: "product",
		schemaVersion: 1,
		description: "x",
		props: {},
		...extra,
	};
}

describe("registry rules", () => {
	it("accepts the real registry", () => {
		assert.deepEqual(registryProblems(EVENTS), []);
	});

	it("registers the pageview, the #02 survey and a server event", () => {
		assert.ok("$pageview" in EVENTS);
		assert.ok("feature_survey_answered" in EVENTS);
		assert.ok(Object.keys(serverEvents(EVENTS)).length > 0);
	});

	it("allows free text on the survey type only", () => {
		const problems = registryProblems(
			withEvent(definition({ props: { note: text } })),
		);
		assert.ok(problems.some((p) => p.includes("broken_event")));
		assert.ok(problems.some((p) => p.includes("text")));
	});

	it("allows free text on a client survey event", () => {
		const problems = registryProblems(
			withEvent(definition({ kind: "survey", props: { note: text } })),
		);
		assert.deepEqual(problems, []);
	});

	it("rejects a server event that carries free text", () => {
		const problems = registryProblems(
			withEvent(
				definition({
					origin: "server",
					kind: "survey",
					props: { note: text },
				}),
			),
		);
		assert.ok(problems.length > 0);
	});

	const broken: [string, Record<string, unknown>][] = [
		["no schema version", { schemaVersion: 0 }],
		["an empty enum", { props: { a: { kind: "enum", values: [] } } }],
		[
			"an unbounded number",
			{ props: { a: { kind: "int", min: 0, max: Number.POSITIVE_INFINITY } } },
		],
		[
			"an inverted number range",
			{ props: { a: { kind: "int", min: 5, max: 1 } } },
		],
		[
			"an enum value with a space",
			{ props: { a: { kind: "enum", values: ["two words"] } } },
		],
		["a property kind that does not exist", { props: { a: { kind: "any" } } }],
		["an unknown origin", { origin: "everywhere" }],
	];
	for (const [label, extra] of broken) {
		it(`rejects ${label}`, () => {
			const problems = registryProblems(withEvent(definition(extra)));
			assert.ok(problems.length > 0, "expected a problem");
		});
	}
});

describe("checkEvent", () => {
	const allowed = clientEvents(EVENTS);

	it("accepts a valid event and reports its schema version", () => {
		const result = checkEvent(allowed, "$pageview", { route: "/reader" });
		assert.deepEqual(result, {
			ok: true,
			schemaVersion: EVENTS.$pageview.schemaVersion,
			properties: { route: "/reader" },
		});
	});

	it("rejects an unknown event, an unknown property and a bad value", () => {
		assert.deepEqual(checkEvent(allowed, "nope", {}), {
			ok: false,
			reason: "unknown_event",
		});
		assert.deepEqual(
			checkEvent(allowed, "$pageview", { route: "/reader", title: "x" }),
			{ ok: false, reason: "unknown_property" },
		);
		assert.deepEqual(checkEvent(allowed, "$pageview", { route: "/s#abc" }), {
			ok: false,
			reason: "bad_property_value",
		});
	});

	it("rejects a missing required property", () => {
		assert.deepEqual(checkEvent(allowed, "$pageview", {}), {
			ok: false,
			reason: "missing_property",
		});
	});

	it("does not treat Object prototype keys as events or properties", () => {
		assert.equal(checkEvent(allowed, "__proto__", {}).ok, false);
		assert.equal(checkEvent(allowed, "constructor", {}).ok, false);
		assert.equal(
			checkEvent(
				allowed,
				"$pageview",
				JSON.parse('{"route":"/","__proto__":"x"}'),
			).ok,
			false,
		);
	});

	it("keeps server events out of the client allowlist", () => {
		for (const name of Object.keys(serverEvents(EVENTS))) {
			assert.equal(checkEvent(allowed, name, {}).ok, false, name);
		}
	});
});

describe("pageviews carry the route only", () => {
	const cases: [string, string][] = [
		["/reader?q=1#frag", "/reader"],
		["/", "/"],
		["/s#eJzLSM3JyVcozy/KSQEAGgsEXQ", "/s"],
		["/#/read/SGVsbG8gd29ybGQgdGhpcyBpcyBhIGRvY3VtZW50", "/"],
		["/learn/speed-reading-myths", "/learn/[slug]"],
		["/learn/", "/learn"],
		["/account/email", "/account/[page]"],
		["https://speeedy.app/library?utm=x#y", "/library"],
		["/aGVsbG8gd29ybGQ", "other"],
		["/unknown/deeper/path", "other"],
	];
	for (const [input, route] of cases) {
		it(`${input} sends ${route}`, () => {
			const view = pageviewFor(input);
			assert.deepEqual(view, { event: "$pageview", properties: { route } });
			assert.equal(
				checkEvent(clientEvents(EVENTS), view.event, view.properties).ok,
				true,
			);
		});
	}

	it("never lets a query, hash, title or token out", () => {
		const view = pageviewFor(`/read?${CANARY}=1#${CANARY}`);
		assert.ok(!JSON.stringify(view).includes(CANARY));
		assert.deepEqual(Object.keys(view.properties), ["route"]);
	});
});

describe("generated privacy cases", () => {
	const cases = privacyCases(EVENTS);
	const defsFor = (origin: string) =>
		origin === "client" ? clientEvents(EVENTS) : serverEvents(EVENTS);

	it("covers every event", () => {
		for (const name of Object.keys(EVENTS)) {
			assert.ok(
				cases.some((c) => c.event === name),
				`no privacy case for ${name}`,
			);
		}
	});

	it("rejects every case, so no event can carry document text", () => {
		for (const c of cases) {
			assert.equal(
				checkEvent(defsFor(c.origin), c.event, c.properties).ok,
				false,
				c.label,
			);
		}
	});

	it("tries the canary on every event", () => {
		for (const name of Object.keys(EVENTS)) {
			assert.ok(
				cases.some(
					(c) =>
						c.event === name && JSON.stringify(c.properties).includes(CANARY),
				),
				name,
			);
		}
	});

	it("has a valid example for every event, and it passes", () => {
		const examples = validExamples(EVENTS);
		assert.deepEqual(
			examples.map((e) => e.event).sort(),
			Object.keys(EVENTS).sort(),
		);
		for (const ex of examples) {
			assert.equal(
				checkEvent(defsFor(ex.origin), ex.event, ex.properties).ok,
				true,
				ex.event,
			);
			assert.ok(!JSON.stringify(ex.properties).includes(CANARY));
		}
	});
});

describe("the published event list", () => {
	it("lists every event with its properties", () => {
		const rows = eventList(EVENTS);
		assert.deepEqual(
			rows.map((r) => r.name).sort(),
			Object.keys(EVENTS).sort(),
		);
		const pageview = rows.find((r) => r.name === "$pageview");
		assert.ok(pageview);
		assert.equal(pageview.origin, "client");
		assert.equal(pageview.props[0].name, "route");
		assert.ok(pageview.props[0].values?.includes("/reader"));
	});

	it("matches the committed generated/events.md, so a hand edit fails CI", () => {
		const committed = readFileSync(
			new URL("../generated/events.md", import.meta.url),
			"utf8",
		);
		assert.equal(committed, renderEventListMarkdown(EVENTS));
	});

	it("says which property is free text", () => {
		assert.match(renderEventListMarkdown(EVENTS), /own_idea[^\n]*free text/i);
	});
});
