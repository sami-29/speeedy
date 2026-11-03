import { NEWSLETTER_PAGES, type NewsletterPage } from "@speeedy/contracts";
import { readCapped } from "./body";
import { json } from "./respond";
import { createServerEvents } from "./server-events";

/** The form sends an address, two small fields and the empty honeypot. */
const MAX_BODY_BYTES = 2048;
const MAX_EMAIL_LENGTH = 254;
/** One address, no spaces, one `@` and a dot in the domain. Buttondown does the strict check. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const ALREADY_EXISTS = /already[\s_-]*(exist|subscri)|email_already_exist/i;
/** The one answer to every accepted submission: check your inbox to confirm. */
const ACCEPTED = { ok: true };
const BUILDING_TAG = "what-im-building";
const UPSTREAM_TIMEOUT_MS = 8000;

interface Signup {
	email: string;
	building: boolean;
	page: NewsletterPage;
}

type Checked =
	| { ok: true; trapped: false; signup: Signup }
	| { ok: true; trapped: true }
	| { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The honeypot is checked first, so a bot gets the same answer however bad its other fields are. */
function check(body: unknown): Checked {
	if (!isRecord(body)) return { ok: false };
	const { website, email, building, page } = body;
	if (website !== undefined && website !== "")
		return { ok: true, trapped: true };
	if (typeof email !== "string") return { ok: false };
	const trimmed = email.trim();
	if (trimmed.length > MAX_EMAIL_LENGTH || !EMAIL.test(trimmed)) {
		return { ok: false };
	}
	if (typeof building !== "boolean") return { ok: false };
	if (!NEWSLETTER_PAGES.includes(page as NewsletterPage)) return { ok: false };
	return {
		ok: true,
		trapped: false,
		signup: { email: trimmed, building, page: page as NewsletterPage },
	};
}

type Outcome = "created" | "exists" | "failed";

/** Whether a 4xx body says the address is already on the list. Unverified wording, so loose. */
async function saysAlreadyExists(response: Response): Promise<boolean> {
	if (response.status < 400 || response.status >= 500) return false;
	try {
		return ALREADY_EXISTS.test(await response.text());
	} catch {
		return false;
	}
}

/**
 * Asks Buttondown to add the subscriber. The request is made from scratch, so nothing from
 * the reader's request travels with it. Double opt-in stays on (Buttondown's default), and
 * `unactivated` plus the `add` collision header make a returning address confirm again.
 * The reader's IP is never sent.
 */
async function subscribe(env: Env, signup: Signup): Promise<Outcome> {
	try {
		const response = await fetch(
			`${env.BUTTONDOWN_HOST.replace(/\/+$/, "")}/v1/subscribers`,
			{
				method: "POST",
				headers: {
					authorization: `Token ${env.BUTTONDOWN_API_TOKEN}`,
					"content-type": "application/json",
					"x-buttondown-collision-behavior": "add",
				},
				body: JSON.stringify({
					email_address: signup.email,
					type: "unactivated",
					...(signup.building ? { tags: [BUILDING_TAG] } : {}),
				}),
				redirect: "manual",
				signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
			},
		);
		if (response.ok) return "created";
		if (response.status === 409 || (await saysAlreadyExists(response))) {
			return "exists";
		}
		// The status says what went wrong (a bad token, say). The body can hold the address.
		console.error(`newsletter: Buttondown answered ${response.status}`);
		return "failed";
	} catch {
		return "failed";
	}
}

/**
 * POST /api/newsletter: the signup form's way to Buttondown. The Worker keeps no copy of the
 * address. The reader's IP is the rate limiter's key and nothing else: it is not stored,
 * logged, sent to Buttondown or put in an event. The response never sets a cookie.
 */
export async function handleNewsletter(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== "POST")
		return json(405, { error: "method_not_allowed" }, { allow: "POST" });

	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const { success } = await env.NEWSLETTER_LIMITER.limit({ key: ip });
	if (!success) return json(429, { error: "rate_limited" });

	if (!env.BUTTONDOWN_API_TOKEN) return json(503, { error: "not_configured" });
	if (
		!request.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("application/json")
	) {
		return json(415, { error: "unsupported_media_type" });
	}

	const text = await readCapped(request, MAX_BODY_BYTES);
	if (text === null) return json(413, { error: "too_large" });

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return json(400, { error: "invalid_json" });
	}

	const checked = check(body);
	if (!checked.ok) return json(400, { error: "invalid_request" });
	// A bot that filled the hidden field gets the answer a real reader gets.
	if (checked.trapped) return json(200, ACCEPTED);

	const outcome = await subscribe(env, checked.signup);
	if (outcome === "failed") return json(502, { error: "unavailable" });
	// An address already on the list gets the same answer as a new one, so the form cannot
	// be used to probe who subscribes. It counts as no new signup, so it sends no event.
	if (outcome === "created") {
		createServerEvents(env, ctx).capture("newsletter_signup", {
			topic: checked.signup.building ? "speeedy_building" : "speeedy",
			page: checked.signup.page,
		});
	}
	return json(200, ACCEPTED);
}
