import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
	CANARY,
	createAnalytics,
	ERROR_CODES,
	EXCEPTION_EVENT,
	errorPrivacyCases,
	hostileErrors,
	ISSUE_DESCRIPTIONS,
	leaksCanary,
} from "@speeedy/contracts";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import { ALLOWLIST } from "../src/e/allowlist";
import { network } from "./network";

const VISIT = "7b1f0c9e-4c1d-4a53-9a43-0d6c7f1d2e11";
const FRAME = {
	file: "/_app/immutable/chunks/AbCd1234.js",
	line: 3,
	col: 14,
	function: "f",
};

// biome-ignore lint/suspicious/noExplicitAny: the fake endpoint stores whatever arrives
let captured: any[];
let texts: string[];

beforeEach(() => {
	captured = [];
	texts = [];
	network.use(
		http.post("https://posthog.test/batch/", async ({ request }) => {
			const text = await request.text();
			texts.push(text);
			captured.push(JSON.parse(text));
			return HttpResponse.json({ status: 1 });
		}),
	);
});

async function call(request: Request): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		request as Request<unknown, IncomingRequestCfProperties>,
		env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}

function post(body: unknown) {
	return call(
		new Request("https://speeedy.app/api/e", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

const exception = (properties: unknown) => ({
	visit: VISIT,
	events: [{ event: EXCEPTION_EVENT, properties }],
});

describe("POST /api/e with an $exception", () => {
	it("keeps $exception out of the registry allowlist and admits it as its own shape", async () => {
		expect(Object.hasOwn(ALLOWLIST, EXCEPTION_EVENT)).toBe(false);
		const response = await post(
			exception({ code: "unhandled_error", frames: [FRAME] }),
		);
		expect(response.status).toBe(202);
	});

	it("forwards an empty message, frames only, the code as fingerprint and an enum description", async () => {
		await post(exception({ code: "render_error", frames: [FRAME] }));

		expect(captured).toHaveLength(1);
		const [event] = captured[0].batch;
		expect(event.event).toBe(EXCEPTION_EVENT);
		expect(Object.keys(event.properties).sort()).toEqual(
			[
				"$exception_fingerprint",
				"$exception_level",
				"$exception_list",
				"$issue_description",
				"$process_person_profile",
				"distinct_id",
				"schema_version",
			].sort(),
		);
		expect(event.properties.distinct_id).toBe(VISIT);
		expect(event.properties.$process_person_profile).toBe(false);
		expect(event.properties.$exception_fingerprint).toBe("render_error");
		expect(event.properties.$issue_description).toBe(
			ISSUE_DESCRIPTIONS.render_error,
		);
		expect(event.properties.$exception_list).toEqual([
			{
				type: "render_error",
				value: "",
				mechanism: { handled: false, synthetic: false },
				stacktrace: {
					type: "raw",
					frames: [
						{
							platform: "web:javascript",
							filename: "/_app/immutable/chunks/AbCd1234.js",
							function: "f",
							lineno: 3,
							colno: 14,
							in_app: true,
						},
					],
				},
			},
		]);
	});

	it("takes the description from the code, not from the client", async () => {
		for (const code of ERROR_CODES) {
			captured.length = 0;
			await post(exception({ code, frames: [] }));
			expect(captured[0].batch[0].properties.$issue_description).toBe(
				ISSUE_DESCRIPTIONS[code],
			);
		}
	});

	it("travels in a batch with a product event", async () => {
		const response = await post({
			visit: VISIT,
			events: [
				{ event: "$pageview", properties: { route: "/reader" } },
				{
					event: EXCEPTION_EVENT,
					properties: { code: "unhandled_error", frames: [FRAME] },
				},
			],
		});
		expect(response.status).toBe(202);
		expect(captured[0].batch.map((e: { event: string }) => e.event)).toEqual([
			"$pageview",
			EXCEPTION_EVENT,
		]);
	});

	it("rejects every generated error privacy case and forwards nothing", async () => {
		for (const c of errorPrivacyCases()) {
			const response = await post(exception(c.properties));
			expect(response.status, c.label).toBe(400);
		}
		expect(captured).toHaveLength(0);
	});

	it("rejects an $exception that carries any extra top-level key", async () => {
		const response = await post({
			visit: VISIT,
			events: [
				{
					event: EXCEPTION_EVENT,
					properties: { code: "unhandled_error", frames: [] },
					message: CANARY,
				},
			],
		});
		expect(response.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	it("rejects the whole batch when one $exception is bad", async () => {
		const response = await post({
			visit: VISIT,
			events: [
				{ event: "$pageview", properties: { route: "/reader" } },
				{
					event: EXCEPTION_EVENT,
					properties: { code: "unhandled_error", frames: [], message: "x" },
				},
			],
		});
		expect(response.status).toBe(400);
		expect(captured).toHaveLength(0);
	});
});

describe("hostile errors sent through the app's send function", () => {
	it("leave the Worker as frames and a code, and nothing else", async () => {
		const analytics = createAnalytics({
			endpoint: "https://speeedy.app/api/e",
			fetch: (url, init) => call(new Request(String(url), init)),
			schedule: () => {},
		});
		for (const hostile of hostileErrors()) {
			analytics.trackError(hostile, "unhandled_error");
		}
		await analytics.flush();

		expect(captured.length).toBeGreaterThan(0);
		expect(leaksCanary(texts.join(""))).toBe(false);
		for (const body of captured) {
			for (const event of body.batch) {
				expect(event.event).toBe(EXCEPTION_EVENT);
				expect(event.properties.$exception_list).toHaveLength(1);
				const [entry] = event.properties.$exception_list;
				expect(entry.value).toBe("");
				expect(Object.keys(entry).sort()).toEqual([
					"mechanism",
					"stacktrace",
					"type",
					"value",
				]);
				for (const frame of entry.stacktrace.frames) {
					expect(Object.keys(frame).sort()).toEqual([
						"colno",
						"filename",
						"function",
						"in_app",
						"lineno",
						"platform",
					]);
				}
			}
		}
	});
});
