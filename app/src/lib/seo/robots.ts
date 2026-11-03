/**
 * robots.txt: every crawler is welcome, AI crawlers included, and nothing is blocked. The app
 * routes stay crawlable on purpose, because a crawler has to fetch them to read their noindex.
 */
export const buildRobots = (origin: string): string =>
	`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
