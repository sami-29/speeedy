import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import { network } from "./network";

const VISIT = "7b1f0c9e-4c1d-4a53-9a43-0d6c7f1d2e11";
const SURVEY = "feature_survey_answered";

interface Captured {
	url: string;
	headers: Record<string, string>;
	text: string;
	// biome-ignore lint/suspicious/noExplicitAny: the fake endpoint stores whatever arrives
	body: any;
}

let captured: Captured[];
let posthogStatus = 200;

beforeEach(() => {
	captured = [];
	posthogStatus = 200;
	network.use(
		http.post("https://posthog.test/batch/", async ({ request }) => {
			const text = await request.text();
			captured.push({
				url: request.url,
				headers: Object.fromEntries(request.headers),
				text,
				body: JSON.parse(text),
			});
			return HttpResponse.json({ status: 1 }, { status: posthogStatus });
		}),
	);
});

async function call(request: Request, bindings = env): Promise<Response> {
	const ctx = createExecutionContext();
	const incoming = request as Request<unknown, IncomingRequestCfProperties>;
	const response = await worker.fetch(incoming, bindings, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

function post(body: unknown, headers: Record<string, string> = {}) {
	return call(
		new Request("https://speeedy.app/api/e", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
	);
}

function batch(properties: Record<string, unknown> = {}, event = SURVEY) {
	return { visit: VISIT, events: [{ event, properties }] };
}

describe("POST /api/e with an allowlisted event", () => {
	it("forwards it to PostHog with the project token and no person profile", async () => {
		const response = await post(
			batch({ idea_ai_help: true, idea_sync: false, reads: "articles" }),
		);

		expect(response.status).toBe(202);
		expect(captured).toHaveLength(1);
		const { body } = captured[0];
		expect(body.api_key).toBe("phc_test_token");
		expect(body.batch).toHaveLength(1);
		expect(body.batch[0].event).toBe(SURVEY);
		expect(body.batch[0].properties).toMatchObject({
			distinct_id: VISIT,
			$process_person_profile: false,
			idea_ai_help: true,
			idea_sync: false,
			reads: "articles",
		});
	});

	it("forwards every event of a batch in one request", async () => {
		await post({
			visit: VISIT,
			events: [
				{ event: SURVEY, properties: { idea_sync: true } },
				{ event: SURVEY, properties: { own_idea: "a quiet mode" } },
			],
		});

		expect(captured).toHaveLength(1);
		expect(captured[0].body.batch).toHaveLength(2);
	});

	it("forwards the free text of the survey's own-idea field", async () => {
		await post(batch({ own_idea: "x".repeat(500) }));

		expect(captured[0].body.batch[0].properties.own_idea).toBe("x".repeat(500));
	});

	it("lets a property the client left out stay out", async () => {
		await post(batch({}));

		const sent = captured[0].body.batch[0].properties;
		expect(Object.keys(sent).sort()).toEqual(
			["$process_person_profile", "distinct_id", "schema_version"].sort(),
		);
	});

	it("sends nothing the reader's request carried", async () => {
		await post(batch({ idea_sync: true }), {
			"cf-connecting-ip": "203.0.113.9",
			"x-forwarded-for": "203.0.113.9",
			"x-real-ip": "203.0.113.9",
			"user-agent": "Mozilla/5.0 SecretReaderBrowser/1.0",
			cookie: "session=abc",
			referer: "https://speeedy.app/read",
		});

		expect(captured).toHaveLength(1);
		const { headers, text } = captured[0];
		expect(headers["cf-connecting-ip"]).toBeUndefined();
		expect(headers["x-forwarded-for"]).toBeUndefined();
		expect(headers["x-real-ip"]).toBeUndefined();
		expect(headers.forwarded).toBeUndefined();
		expect(headers.cookie).toBeUndefined();
		expect(headers.referer).toBeUndefined();
		expect(headers["user-agent"] ?? "").not.toContain("SecretReaderBrowser");
		expect(text).not.toContain("203.0.113.9");
		expect(text).not.toContain("SecretReaderBrowser");
		expect(captured[0].body.batch[0].properties).not.toHaveProperty("$ip");
	});

	it("answers before PostHog does and survives a PostHog failure", async () => {
		posthogStatus = 500;

		const response = await post(batch({ idea_sync: true }));

		expect(response.status).toBe(202);
	});
});

describe("POST /api/e rejects what the allowlist does not describe", () => {
	const bad: [string, unknown][] = [
		["an unknown event", batch({}, "page_title_seen")],
		["an unknown property", batch({ document_title: "Secret.pdf" })],
		["an enum value outside the list", batch({ reads: "my diary" })],
		["a boolean given as a string", batch({ idea_sync: "yes" })],
		["text over its bound", batch({ own_idea: "x".repeat(501) })],
		["text given as a number", batch({ own_idea: 12 })],
		["a property object", batch({ idea_sync: { nested: true } })],
		["an empty batch", { visit: VISIT, events: [] }],
		[
			"a batch over the size cap",
			{
				visit: VISIT,
				events: Array.from({ length: 21 }, () => ({
					event: SURVEY,
					properties: {},
				})),
			},
		],
		["a missing visit id", { events: [{ event: SURVEY, properties: {} }] }],
		[
			"a visit id that is not an id",
			{ ...batch(), visit: "reader@example.com" },
		],
		["events that are not an array", { visit: VISIT, events: SURVEY }],
		["an event that is not an object", { visit: VISIT, events: ["x"] }],
		["a JSON array body", []],
		["a body that is not JSON", "{not json"],
	];

	it.each(bad)("%s", async (_name, body) => {
		const response = await post(body);

		expect(response.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	it("forwards none of a batch when one event is bad", async () => {
		const response = await post({
			visit: VISIT,
			events: [
				{ event: SURVEY, properties: { idea_sync: true } },
				{ event: SURVEY, properties: { reads: "my diary" } },
			],
		});

		expect(response.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	it("rejects a body over the byte cap", async () => {
		const response = await post(
			`{"visit":"${VISIT}","events":[],"pad":"${"x".repeat(70_000)}"}`,
		);

		expect(response.status).toBe(413);
		expect(captured).toHaveLength(0);
	});

	it("rejects a body that is not JSON content", async () => {
		const response = await call(
			new Request("https://speeedy.app/api/e", {
				method: "POST",
				headers: { "content-type": "text/plain" },
				body: JSON.stringify(batch()),
			}),
		);

		expect(response.status).toBe(415);
		expect(captured).toHaveLength(0);
	});
});

describe("routing", () => {
	it("refuses a method other than POST on /api/e", async () => {
		const response = await call(new Request("https://speeedy.app/api/e"));

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
	});

	it("answers 404 for a module that is not built yet", async () => {
		for (const path of [
			"/api/auth",
			"/api/billing",
			"/api/sync",
			"/api/voice",
			"/api/nope",
		]) {
			const response = await call(
				new Request(`https://speeedy.app${path}`, { method: "POST" }),
			);
			expect(response.status).toBe(404);
		}
	});

	it("answers 404 outside /api", async () => {
		const response = await call(new Request("https://speeedy.app/"));

		expect(response.status).toBe(404);
	});

	it("answers 503 and forwards nothing when the PostHog token is not set", async () => {
		const response = await call(
			new Request("https://speeedy.app/api/e", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(batch({ idea_sync: true })),
			}),
			{ ...env, POSTHOG_PROJECT_TOKEN: "" },
		);

		expect(response.status).toBe(503);
		expect(captured).toHaveLength(0);
	});
});

describe("cookies", () => {
	it("no response sets one", async () => {
		const responses = [
			await post(batch({ idea_sync: true })),
			await post(batch({ reads: "my diary" })),
			await post("{not json"),
			await call(new Request("https://speeedy.app/api/e")),
			await call(
				new Request("https://speeedy.app/api/auth", { method: "POST" }),
			),
			await call(new Request("https://speeedy.app/")),
		];

		for (const response of responses) {
			expect(response.headers.get("set-cookie")).toBeNull();
		}
	});
});
