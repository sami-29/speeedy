import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { EVENTS, serverEvents, validExamples } from "@speeedy/contracts";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { createServerEvents } from "../src/server-events";
import { network } from "./network";

// biome-ignore lint/suspicious/noExplicitAny: the fake endpoint stores whatever arrives
let captured: any[];
let headers: Record<string, string>;

beforeEach(() => {
	captured = [];
	headers = {};
	network.use(
		http.post("https://posthog.test/batch/", async ({ request }) => {
			headers = Object.fromEntries(request.headers);
			captured.push(await request.json());
			return HttpResponse.json({ status: 1 });
		}),
	);
});

const example = validExamples(EVENTS).find((e) => e.origin === "server");

function theExample() {
	if (!example) throw new Error("the registry has no server event");
	return example;
}

async function requestWith<T>(
	run: (events: ReturnType<typeof createServerEvents>) => T,
) {
	const ctx = createExecutionContext();
	const events = createServerEvents(env, ctx);
	const result = run(events);
	await waitOnExecutionContext(ctx);
	return { events, result };
}

function sentEvents() {
	return captured.flatMap((c) => c.batch);
}

describe("server events through posthog-node", () => {
	it("has a registered server event to send", () => {
		expect(serverEvents(EVENTS)[theExample().event]).toBeDefined();
	});

	it("sends a registered event with the project token and no person profile", async () => {
		const ex = theExample();
		const { result } = await requestWith((e) =>
			e.capture(ex.event as never, ex.properties as never),
		);

		expect(result).toBe(true);
		expect(captured[0].api_key).toBe("phc_test_token");
		const [sent] = sentEvents();
		expect(sent.event).toBe(ex.event);
		expect(sent.properties).toMatchObject({
			...ex.properties,
			$process_person_profile: false,
		});
	});

	it("uses a random id per request and never an account id", async () => {
		const ex = theExample();
		const first = await requestWith((e) =>
			e.capture(ex.event as never, ex.properties as never),
		);
		const second = await requestWith((e) =>
			e.capture(ex.event as never, ex.properties as never),
		);

		const ids = sentEvents().map((e) => e.distinct_id);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(ids[0]).toBe(first.events.id);
		expect(ids[1]).toBe(second.events.id);
		expect(ids[0]).not.toBe(ids[1]);
	});

	it("keeps one id for the events of a single request", async () => {
		const ex = theExample();
		await requestWith((e) => {
			e.capture(ex.event as never, ex.properties as never);
			e.capture(ex.event as never, ex.properties as never);
		});
		const ids = new Set(sentEvents().map((e) => e.distinct_id));
		expect(ids.size).toBe(1);
	});

	it("sends nothing for an unregistered event, a client event or a bad value", async () => {
		const ex = theExample();
		const { result } = await requestWith((e) => [
			e.capture("not_registered" as never, {} as never),
			e.capture("$pageview" as never, { route: "/" } as never),
			e.capture(ex.event as never, { interval: "free text" } as never),
		]);
		expect(result).toEqual([false, false, false]);
		expect(captured).toHaveLength(0);
	});

	it("sends no cookie, referrer or IP header", async () => {
		const ex = theExample();
		await requestWith((e) =>
			e.capture(ex.event as never, ex.properties as never),
		);
		for (const name of [
			"cookie",
			"cf-connecting-ip",
			"x-forwarded-for",
			"x-real-ip",
			"referer",
		]) {
			expect(headers[name], name).toBeUndefined();
		}
	});
});
