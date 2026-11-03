import { readCapped } from "../body";
import { json } from "../respond";
import { type CleanEvent, validateBatch } from "./validate";

/** Far above any real batch (20 events, one with 500 characters of text). */
const MAX_BODY_BYTES = 65_536;

/**
 * Builds the PostHog batch. The request is made from scratch: nothing from the reader's
 * request is copied, so no IP, user agent, cookie or referrer can travel with it.
 */
function toPostHog(token: string, visit: string, events: CleanEvent[]): string {
	return JSON.stringify({
		api_key: token,
		batch: events.map((e) => ({
			event: e.event,
			properties: {
				...e.properties,
				schema_version: e.schemaVersion,
				distinct_id: visit,
				$process_person_profile: false,
			},
		})),
	});
}

async function forward(host: string, body: string): Promise<void> {
	try {
		await fetch(`${host.replace(/\/+$/, "")}/batch/`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
	} catch {
		// The reader's answer is already sent; a lost event is not worth an error here.
	}
}

export async function handleE(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== "POST")
		return json(405, { error: "method_not_allowed" }, { allow: "POST" });
	if (!env.POSTHOG_PROJECT_TOKEN) return json(503, { error: "not_configured" });
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

	const checked = validateBatch(body);
	if (!checked.ok) return json(400, { error: checked.reason });

	ctx.waitUntil(
		forward(
			env.POSTHOG_HOST,
			toPostHog(env.POSTHOG_PROJECT_TOKEN, checked.visit, checked.events),
		),
	);
	return json(202, { ok: true });
}
