import { planSnapshot } from "@speeedy/contracts";
import { json } from "./respond";

/**
 * GET /api/plan: the current Account's features and limits. Sessions do not exist yet
 * (#46, #48), so every request has no Account and gets the free plan. Once they do, read
 * the session here and pass the Account's entitlement row to `planSnapshot`.
 */
export async function handlePlan(request: Request): Promise<Response> {
	if (request.method !== "GET") {
		return json(405, { error: "method_not_allowed" }, { allow: "GET" });
	}
	return json(200, planSnapshot(null));
}
