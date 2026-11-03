import { PUBLIC_PAGES } from "#lib/seo/pages.ts";
import { SITE_ORIGIN } from "#lib/seo/site.ts";
import { buildSitemap } from "#lib/seo/sitemap.ts";
import type { RequestHandler } from "./$types";

export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(buildSitemap(SITE_ORIGIN, PUBLIC_PAGES), {
		headers: { "content-type": "application/xml; charset=utf-8" },
	});
