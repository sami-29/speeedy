import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
	clientEvents,
	createAnalytics,
	EVENTS,
	privacyCases,
	serverEvents,
	validExamples,
} from "@speeedy/contracts";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import { ALLOWLIST } from "../src/e/allowlist";
import { network } from "./network";

const VISIT = "7b1f0c9e-4c1d-4a53-9a43-0d6c7f1d2e11";

// biome-ignore lint/suspicious/noExplicitAny: the fake endpoint stores whatever arrives
let captured: any[];

beforeEach(() => {
	captured = [];
	network.use(
		http.post("https://posthog.test/batch/", async ({ request }) => {
			captured.push(await request.json());
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

describe("the Worker allowlist comes from the registry", () => {
	it("is exactly the registry's client events", () => {
		expect(ALLOWLIST).toEqual(clientEvents(EVENTS));
	});

	it("does not include server events", () => {
		for (const name of Object.keys(serverEvents(EVENTS))) {
			expect(Object.hasOwn(ALLOWLIST, name)).toBe(false);
		}
	});

	it("refuses a server event sent by a client", async () => {
		const [name] = Object.keys(serverEvents(EVENTS));
		const response = await post({
			visit: VISIT,
			events: [{ event: name, properties: {} }],
		});
		expect(response.status).toBe(400);
		expect(captured).toHaveLength(0);
	});
});

describe("generated cases through /api/e", () => {
	it("forwards every valid example with a person profile off", async () => {
		for (const ex of validExamples(EVENTS).filter(
			(e) => e.origin === "client",
		)) {
			captured.length = 0;
			const response = await post({
				visit: VISIT,
				events: [{ event: ex.event, properties: ex.properties }],
			});
			expect(response.status, ex.event).toBe(202);
			expect(captured[0].batch[0].properties.$process_person_profile).toBe(
				false,
			);
		}
	});

	it("rejects every privacy case and forwards nothing", async () => {
		for (const c of privacyCases(EVENTS).filter((x) => x.origin === "client")) {
			const response = await post({
				visit: VISIT,
				events: [{ event: c.event, properties: c.properties }],
			});
			expect(response.status, c.label).toBe(400);
		}
		expect(captured).toHaveLength(0);
	});
});

describe("the app's send function against the Worker", () => {
	it("reaches PostHog with the Visit ID as the distinct id and a route-only pageview", async () => {
		const analytics = createAnalytics({
			endpoint: "https://speeedy.app/api/e",
			fetch: (url, init) => call(new Request(String(url), init)),
			schedule: () => {},
		});
		analytics.trackPageview("/s?secret=abc#eJzLSM3JyVcozy");
		await analytics.flush();

		expect(captured).toHaveLength(1);
		const [event] = captured[0].batch;
		expect(event.event).toBe("$pageview");
		expect(event.properties).toMatchObject({
			distinct_id: analytics.visitId,
			$process_person_profile: false,
			route: "/s",
		});
		expect(JSON.stringify(captured)).not.toContain("secret");
		expect(JSON.stringify(captured)).not.toContain("eJzLSM3J");
	});
});
