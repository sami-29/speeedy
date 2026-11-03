import {
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { NEWSLETTER_PAGES, NEWSLETTER_TOPICS } from "@speeedy/contracts";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import { network } from "./network";

const EMAIL = "reader@example.com";
const BUTTONDOWN = "https://buttondown.test/v1/subscribers";

interface Seen {
	headers: Record<string, string>;
	text: string;
	// biome-ignore lint/suspicious/noExplicitAny: the fake endpoint stores whatever arrives
	body: any;
}

let buttondown: Seen[];
// biome-ignore lint/suspicious/noExplicitAny: the fake endpoint stores whatever arrives
let posthog: any[];
let buttondownReply: () => Response;
let counter = 0;

beforeEach(() => {
	buttondown = [];
	posthog = [];
	buttondownReply = () => HttpResponse.json({ id: "sub_1" }, { status: 201 });
	network.use(
		http.post(BUTTONDOWN, async ({ request }) => {
			const text = await request.text();
			buttondown.push({
				headers: Object.fromEntries(request.headers),
				text,
				body: JSON.parse(text),
			});
			return buttondownReply();
		}),
		http.post("https://posthog.test/batch/", async ({ request }) => {
			const gzipped = request.headers.get("content-encoding") === "gzip";
			const body =
				gzipped && request.body
					? request.body.pipeThrough(new DecompressionStream("gzip"))
					: request.body;
			posthog.push(await new Response(body).json());
			return HttpResponse.json({ status: 1 });
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

/** Each call comes from a fresh IP unless a test names one, so the limiter stays out of the way. */
function signup(
	body: unknown = { email: EMAIL, building: false, page: "home" },
	headers: Record<string, string> = {},
	bindings = env,
) {
	counter += 1;
	return call(
		new Request("https://speeedy.app/api/newsletter", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"cf-connecting-ip": `203.0.113.${counter % 250}`,
				...headers,
			},
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
		bindings,
	);
}

function sentEvents() {
	return posthog.flatMap((p) => p.batch);
}

describe("POST /api/newsletter: the Buttondown call", () => {
	it("subscribes the address once, with the secret token, and answers 202", async () => {
		const response = await signup();

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ ok: true });
		expect(buttondown).toHaveLength(1);
		expect(buttondown[0].headers.authorization).toBe("Token bd_test_token");
		expect(buttondown[0].headers["content-type"]).toContain("application/json");
	});

	it("leaves double opt-in on and makes a returning address confirm again", async () => {
		await signup();

		expect(buttondown[0].body).toEqual({
			email_address: EMAIL,
			type: "unactivated",
		});
		expect(buttondown[0].headers["x-buttondown-collision-behavior"]).toBe(
			"add",
		);
	});

	it("adds the What I'm building tag only when the box is ticked", async () => {
		await signup({ email: EMAIL, building: true, page: "home" });

		expect(buttondown[0].body).toEqual({
			email_address: EMAIL,
			type: "unactivated",
			tags: ["what-im-building"],
		});
	});

	it("trims the address", async () => {
		await signup({ email: `  ${EMAIL} `, building: false, page: "home" });

		expect(buttondown[0].body.email_address).toBe(EMAIL);
	});

	it("never sends the reader's IP, a user agent, a cookie or type regular", async () => {
		await signup(undefined, {
			"cf-connecting-ip": "198.51.100.77",
			"x-forwarded-for": "198.51.100.77",
			"user-agent": "ReaderBrowser/1.0",
			cookie: "session=abc",
			referer: "https://speeedy.app/",
		});

		const [seen] = buttondown;
		expect(seen.text).not.toContain("198.51.100.77");
		expect(seen.text).not.toContain("ip_address");
		expect(seen.text).not.toContain("regular");
		for (const name of [
			"cookie",
			"cf-connecting-ip",
			"x-forwarded-for",
			"x-real-ip",
			"referer",
		]) {
			expect(seen.headers[name], name).toBeUndefined();
		}
		expect(seen.headers["user-agent"] ?? "").not.toContain("ReaderBrowser");
	});

	it("sets no cookie on the reader, even if Buttondown sends one", async () => {
		buttondownReply = () =>
			HttpResponse.json(
				{ id: "sub_1" },
				{ status: 201, headers: { "set-cookie": "fingerprint=abc; Path=/" } },
			);

		const response = await signup();

		expect(response.status).toBe(202);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
});

describe("POST /api/newsletter: input", () => {
	for (const email of [
		"",
		"   ",
		"nope",
		"a@b",
		"a b@example.com",
		"@example.com",
		"reader@",
		`${"a".repeat(250)}@example.com`,
		42,
		null,
	]) {
		it(`rejects the address ${JSON.stringify(email).slice(0, 20)} with 400 and no call`, async () => {
			const response = await signup({ email, building: false, page: "home" });

			expect(response.status).toBe(400);
			expect(buttondown).toHaveLength(0);
			expect(sentEvents()).toHaveLength(0);
		});
	}

	it("rejects a missing or unknown page, and a building value that is not a boolean", async () => {
		for (const body of [
			{ email: EMAIL, building: false },
			{ email: EMAIL, building: false, page: "/reader" },
			{ email: EMAIL, building: "yes", page: "home" },
			{ email: EMAIL, page: "home" },
			[],
			"just a string",
		]) {
			const response = await signup(body);
			expect(response.status, JSON.stringify(body)).toBe(400);
		}
		expect(buttondown).toHaveLength(0);
	});

	it("accepts every page in the contracts enum", async () => {
		for (const page of NEWSLETTER_PAGES) {
			const response = await signup({ email: EMAIL, building: false, page });
			expect(response.status, page).toBe(202);
		}
	});

	it("rejects bad JSON, other media types and big bodies", async () => {
		expect((await signup("{not json")).status).toBe(400);
		expect(
			(
				await signup(`email=${EMAIL}`, {
					"content-type": "application/x-www-form-urlencoded",
				})
			).status,
		).toBe(415);
		const big = await signup({
			email: EMAIL,
			building: false,
			page: "home",
			website: "x".repeat(5000),
		});
		expect(big.status).toBe(413);
		expect(buttondown).toHaveLength(0);
	});

	it("answers other methods with 405 and an Allow header", async () => {
		const response = await call(
			new Request("https://speeedy.app/api/newsletter"),
		);
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
	});
});

describe("POST /api/newsletter: honeypot", () => {
	it("answers a filled honeypot exactly like a success and calls nobody", async () => {
		const real = await signup();
		const trapped = await signup({
			email: EMAIL,
			building: false,
			page: "home",
			website: "https://spam.example",
		});

		expect(trapped.status).toBe(real.status);
		expect(await trapped.text()).toBe(await real.text());
		expect(buttondown).toHaveLength(1);
		expect(sentEvents()).toHaveLength(1);
	});

	it("accepts an empty honeypot", async () => {
		const response = await signup({
			email: EMAIL,
			building: false,
			page: "home",
			website: "",
		});
		expect(response.status).toBe(202);
		expect(buttondown).toHaveLength(1);
	});
});

describe("POST /api/newsletter: rate limit", () => {
	it("answers 429 once an IP passes the limit, and calls nobody for those requests", async () => {
		const ip = { "cf-connecting-ip": "192.0.2.50" };
		const statuses: number[] = [];
		for (let i = 0; i < 8; i++) {
			statuses.push((await signup(undefined, ip)).status);
		}

		expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
		expect(statuses.slice(5)).toEqual([429, 429, 429]);
		expect(buttondown).toHaveLength(5);
	});

	it("limits each IP on its own", async () => {
		for (let i = 0; i < 6; i++) {
			await signup(undefined, { "cf-connecting-ip": "192.0.2.60" });
		}
		const other = await signup(undefined, { "cf-connecting-ip": "192.0.2.61" });

		expect(other.status).toBe(202);
	});

	it("does not keep or pass on the IP", async () => {
		const ip = "192.0.2.70";
		const response = await signup(undefined, { "cf-connecting-ip": ip });

		expect(await response.text()).not.toContain(ip);
		expect(JSON.stringify(posthog)).not.toContain(ip);
		expect(buttondown[0].text).not.toContain(ip);
	});
});

describe("POST /api/newsletter: Buttondown failures", () => {
	it("answers a generic 502 for a Buttondown 5xx and sends no event", async () => {
		buttondownReply = () =>
			HttpResponse.json({ detail: "secret upstream detail" }, { status: 503 });

		const response = await signup();

		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain("secret upstream detail");
		expect(sentEvents()).toHaveLength(0);
	});

	it("answers 502 for a Buttondown 4xx (a bad token, a blocked address) and for a network error", async () => {
		buttondownReply = () => HttpResponse.json({}, { status: 401 });
		expect((await signup()).status).toBe(502);
		buttondownReply = () => HttpResponse.error();
		expect((await signup()).status).toBe(502);
		expect(sentEvents()).toHaveLength(0);
	});

	it("answers 503 and calls nobody when the token is not configured", async () => {
		const response = await signup(undefined, {}, {
			...env,
			BUTTONDOWN_API_TOKEN: "",
		} as typeof env);

		expect(response.status).toBe(503);
		expect(buttondown).toHaveLength(0);
	});
});

describe("POST /api/newsletter: the newsletter_signup event", () => {
	it("is a server event with only topic and page", async () => {
		await signup({ email: EMAIL, building: false, page: "support" });
		await signup({ email: EMAIL, building: true, page: "home" });

		const sent = sentEvents();
		expect(sent.map((e) => e.event)).toEqual([
			"newsletter_signup",
			"newsletter_signup",
		]);
		expect(sent[0].properties).toMatchObject({
			topic: "speeedy",
			page: "support",
			$process_person_profile: false,
		});
		expect(sent[1].properties).toMatchObject({
			topic: "speeedy_building",
			page: "home",
		});
		for (const topic of sent.map((e) => e.properties.topic)) {
			expect(NEWSLETTER_TOPICS).toContain(topic);
		}
	});

	it("never carries the address", async () => {
		await signup();

		expect(JSON.stringify(posthog)).not.toContain("example.com");
		expect(JSON.stringify(posthog)).not.toContain("reader");
	});
});
