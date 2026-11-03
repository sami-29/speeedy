import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
	BUCKET_KEY,
	createAnalytics,
	FLAGS,
	type KeyValueStore,
	loadFlags,
} from "@speeedy/contracts";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import { network } from "./network";

const FLAG = "pipeline_check";
const KEY = "config";

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

const get = () => call(new Request("https://speeedy.app/api/flags"));

function configJson(percent: number) {
	return JSON.stringify({
		version: 1,
		flags: { [FLAG]: { percent, variant: "on" } },
	});
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, value),
	};
}

beforeEach(async () => {
	await env.FLAGS_KV.delete(KEY);
});

describe("GET /api/flags", () => {
	it("serves the empty config when the owner has set none", async () => {
		const response = await get();
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(await response.json()).toEqual({ version: 1, flags: {} });
	});

	it("serves what the owner put in KV, with no deploy", async () => {
		await env.FLAGS_KV.put(KEY, configJson(25));
		expect(await (await get()).json()).toEqual({
			version: 1,
			flags: { [FLAG]: { percent: 25, variant: "on" } },
		});

		await env.FLAGS_KV.put(KEY, configJson(0));
		expect(await (await get()).json()).toEqual({
			version: 1,
			flags: { [FLAG]: { percent: 0, variant: "on" } },
		});
	});

	it("drops flags the registry does not declare and bad entries", async () => {
		await env.FLAGS_KV.put(
			KEY,
			JSON.stringify({
				version: 1,
				flags: {
					ghost: { percent: 50, variant: "on" },
					[FLAG]: { percent: 120, variant: "on" },
				},
			}),
		);
		expect(await (await get()).json()).toEqual({ version: 1, flags: {} });
	});

	it("serves the empty config when the stored value is not JSON", async () => {
		await env.FLAGS_KV.put(KEY, "{not json");
		const response = await get();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ version: 1, flags: {} });
	});

	it("refuses other methods", async () => {
		const response = await call(
			new Request("https://speeedy.app/api/flags", { method: "POST" }),
		);
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
	});
});

describe("a device against the Worker", () => {
	// biome-ignore lint/suspicious/noExplicitAny: the fake endpoint stores whatever arrives
	let captured: any[];
	let seen: string[];

	beforeEach(() => {
		captured = [];
		seen = [];
		network.use(
			http.post("https://posthog.test/batch/", async ({ request }) => {
				captured.push(await request.json());
				return HttpResponse.json({ status: 1 });
			}),
		);
	});

	/** Every request the device makes goes through here and is written down in full. */
	async function toWorker(url: string, init?: RequestInit): Promise<Response> {
		const request = new Request(new URL(url, "https://speeedy.app"), init);
		seen.push(
			JSON.stringify({
				url: request.url,
				method: request.method,
				headers: [...request.headers],
				body: await request.clone().text(),
			}),
		);
		return call(request);
	}

	it("resolves a flag from the served config and reports it as exp_<name>=<variant>, without ever sending the bucket", async () => {
		await env.FLAGS_KV.put(KEY, configJson(100));
		const store = memoryStore();
		const flags = await loadFlags({ fetch: toWorker, store });
		expect(flags.variant(FLAG)).toBe("on");

		const analytics = createAnalytics({
			endpoint: "https://speeedy.app/api/e",
			fetch: toWorker,
			schedule: () => {},
			experiments: () => flags.experiments(),
		});
		analytics.trackPageview("/reader?x=1#frag");
		await analytics.flush();

		const [event] = captured[0].batch;
		expect(event.properties).toMatchObject({
			route: "/reader",
			[`exp_${FLAG}`]: "on",
		});

		const bucket = store.data.get(BUCKET_KEY) ?? "";
		expect(bucket).not.toBe("");
		expect(seen.length).toBe(2);
		for (const request of [...seen, JSON.stringify(captured)]) {
			expect(request).not.toContain(bucket);
		}
	});

	it("falls back to the built-in default when the Worker is unreachable", async () => {
		const flags = await loadFlags({
			fetch: async () => {
				throw new TypeError("offline");
			},
			store: memoryStore(),
		});
		expect(flags.variant(FLAG)).toBe(FLAGS[FLAG].fallback);
	});
});
