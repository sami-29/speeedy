import { EMPTY_FLAG_CONFIG, parseFlagConfig } from "@speeedy/contracts";
import { json } from "./respond";

/** The KV key the owner writes the config under. */
const CONFIG_KEY = "config";

/**
 * GET /api/flags: the remote config of feature flags. The owner changes it by writing the
 * `config` key in the FLAGS_KV namespace, so a rollout or a kill switch needs no deploy.
 * The request is never read for a device, a bucket or a cookie: the same JSON goes to
 * everyone, and each device decides for itself. A missing or broken value serves the empty
 * config, which leaves every flag on its built-in fallback.
 */
export async function handleFlags(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "GET") {
		return json(405, { error: "method_not_allowed" }, { allow: "GET" });
	}
	let stored: unknown = EMPTY_FLAG_CONFIG;
	try {
		stored = await env.FLAGS_KV.get(CONFIG_KEY, "json");
	} catch {
		// Missing namespace, unreadable or not JSON: serve the empty config.
	}
	return json(200, parseFlagConfig(stored));
}
