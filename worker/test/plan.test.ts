import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src";

const FREE = {
	plan: "free",
	features: { sync: false, serverVoices: false },
	limits: { voiceHoursPerMonth: 0, syncBytes: 0, syncDocumentBytes: 0 },
};

async function call(request: Request): Promise<Response> {
	const ctx = createExecutionContext();
	const incoming = request as Request<unknown, IncomingRequestCfProperties>;
	const response = await worker.fetch(incoming, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe("GET /api/plan", () => {
	it("returns the free plan's features and limits when there is no session", async () => {
		const response = await call(new Request("https://speeedy.app/api/plan"));

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(await response.json()).toEqual(FREE);
	});

	it("still returns the free plan for a request carrying a cookie, until sessions exist", async () => {
		const response = await call(
			new Request("https://speeedy.app/api/plan", {
				headers: { cookie: "session=not-a-real-session" },
			}),
		);

		expect(await response.json()).toEqual(FREE);
	});

	it("exposes no prices or product IDs", async () => {
		const response = await call(new Request("https://speeedy.app/api/plan"));
		const text = await response.text();

		expect(text).not.toContain("price");
		expect(text).not.toContain("product");
	});

	it("refuses other methods", async () => {
		const response = await call(
			new Request("https://speeedy.app/api/plan", { method: "POST" }),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
	});
});
