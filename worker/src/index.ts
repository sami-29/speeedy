import { handleE } from "./e";
import { handlePlan } from "./plan";
import { notFound } from "./respond";

type Handler = (
	request: Request,
	env: Env,
	ctx: ExecutionContext,
) => Promise<Response>;

/**
 * The one Speeedy Worker. Each `/api/<name>` belongs to a module. `e` and `plan` exist so
 * far; `auth`, `billing`, `sync` and `voice` join this table as their tickets land.
 */
const modules = new Map<string, Handler>([
	["e", handleE],
	["plan", handlePlan],
]);

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const segments = new URL(request.url).pathname.split("/").filter(Boolean);
		if (segments.length !== 2 || segments[0] !== "api") return notFound();
		const handler = modules.get(segments[1]);
		return handler ? handler(request, env, ctx) : notFound();
	},
} satisfies ExportedHandler<Env>;
