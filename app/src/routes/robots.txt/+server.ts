import { buildRobots } from "#lib/seo/robots.ts";
import { SITE_ORIGIN } from "#lib/seo/site.ts";
import type { RequestHandler } from "./$types";

export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(buildRobots(SITE_ORIGIN), {
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
