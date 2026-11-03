import { isAppPath } from "../routes.ts";
import type { PublicPage } from "./pages.ts";

const escapeXml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");

/** True for a real calendar day written YYYY-MM-DD (so not 2026-02-30). */
function isCalendarDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The sitemap: absolute URLs on the given origin, each with its own lastmod. */
export function buildSitemap(origin: string, pages: PublicPage[]): string {
	const urls = pages.map(({ path, lastmod }) => {
		if (!path.startsWith("/")) {
			throw new Error(`Sitemap path must start with a slash: "${path}"`);
		}
		if (isAppPath(path)) {
			throw new Error(`App routes are not in the sitemap: "${path}"`);
		}
		if (!isCalendarDate(lastmod)) {
			throw new Error(
				`Sitemap lastmod for "${path}" is not a date: "${lastmod}"`,
			);
		}
		return `<url><loc>${escapeXml(`${origin}${path}`)}</loc><lastmod>${lastmod}</lastmod></url>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
