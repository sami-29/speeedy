import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAppPath } from "../src/lib/routes.ts";
import { PUBLIC_PAGES } from "../src/lib/seo/pages.ts";
import { buildRobots } from "../src/lib/seo/robots.ts";
import { DEFAULT_SITE_ORIGIN, resolveSiteOrigin } from "../src/lib/seo/site.ts";
import { buildSitemap } from "../src/lib/seo/sitemap.ts";

// A placeholder host: nothing here may depend on a real domain resolving.
const ORIGIN = "https://example.test";

describe("site origin", () => {
	it("defaults to speeedy.app and takes an override from config", () => {
		expect(DEFAULT_SITE_ORIGIN).toBe("https://speeedy.app");
		expect(resolveSiteOrigin(undefined)).toBe(DEFAULT_SITE_ORIGIN);
		expect(resolveSiteOrigin("")).toBe(DEFAULT_SITE_ORIGIN);
		expect(resolveSiteOrigin(ORIGIN)).toBe(ORIGIN);
	});

	it("drops a trailing slash and any path", () => {
		expect(resolveSiteOrigin(`${ORIGIN}/`)).toBe(ORIGIN);
		expect(resolveSiteOrigin(`${ORIGIN}/some/path?x=1`)).toBe(ORIGIN);
	});

	it("rejects an origin that is not an absolute http or https URL", () => {
		expect(() => resolveSiteOrigin("speeedy.app")).toThrow();
		expect(() => resolveSiteOrigin("ftp://example.test")).toThrow();
	});
});

describe("robots.txt", () => {
	const robots = buildRobots(ORIGIN);
	const lines = robots.split("\n").map((line) => line.trim());

	it("allows every crawler, and blocks nothing", () => {
		expect(lines).toContain("User-agent: *");
		expect(lines).toContain("Allow: /");
		const disallows = lines.filter((line) => /^disallow:/i.test(line));
		// An empty Disallow is the same as allow-all; a path is a block.
		for (const line of disallows) expect(line).toMatch(/^disallow:\s*$/i);
	});

	it("does not single out an AI crawler", () => {
		for (const bot of [
			"GPTBot",
			"OAI-SearchBot",
			"ChatGPT-User",
			"ClaudeBot",
			"Claude-SearchBot",
			"PerplexityBot",
			"Google-Extended",
			"CCBot",
		]) {
			expect(robots).not.toContain(bot);
		}
	});

	it("points to the sitemap with an absolute URL", () => {
		expect(lines).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
	});

	it("does not block the app routes, so crawlers can read their noindex", () => {
		// The Sitemap line is left out: its own URL starts with "/s".
		const rules = lines.filter((line) => !/^sitemap:/i.test(line));
		for (const route of ["/reader", "/library", "/stats", "/training", "/s"]) {
			expect(rules.filter((line) => line.includes(route))).toEqual([]);
		}
	});
});

describe("sitemap.xml", () => {
	const pages = [
		{ path: "/", lastmod: "2026-11-03" },
		{ path: "/learn/how-to-read-faster", lastmod: "2026-10-01" },
	];
	const xml = buildSitemap(ORIGIN, pages);

	it("lists each page with an absolute URL and its own lastmod", () => {
		expect(xml).toContain(
			"<url><loc>https://example.test/</loc><lastmod>2026-11-03</lastmod></url>",
		);
		expect(xml).toContain(
			"<loc>https://example.test/learn/how-to-read-faster</loc><lastmod>2026-10-01</lastmod>",
		);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(xml).toContain(
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		);
	});

	it("refuses a lastmod that is not a real calendar date", () => {
		for (const lastmod of [
			"",
			"2026-13-01",
			"2026-02-30",
			"11/03/2026",
			"now",
		]) {
			expect(() => buildSitemap(ORIGIN, [{ path: "/", lastmod }])).toThrow();
		}
	});

	it("refuses an app route and a path that is not absolute", () => {
		expect(() =>
			buildSitemap(ORIGIN, [{ path: "/reader", lastmod: "2026-11-03" }]),
		).toThrow();
		expect(() =>
			buildSitemap(ORIGIN, [{ path: "learn", lastmod: "2026-11-03" }]),
		).toThrow();
	});

	it("escapes XML characters in a URL", () => {
		const out = buildSitemap(ORIGIN, [{ path: "/a&b", lastmod: "2026-11-03" }]);
		expect(out).toContain("/a&amp;b");
	});
});

describe("public pages registry", () => {
	const today = new Date().toISOString().slice(0, 10);

	it("holds the front door, each path once, none of them an app route", () => {
		const paths = PUBLIC_PAGES.map((page) => page.path);
		expect(paths).toContain("/");
		expect(new Set(paths).size).toBe(paths.length);
		for (const path of paths) {
			expect(path.startsWith("/")).toBe(true);
			expect(isAppPath(path)).toBe(false);
		}
	});

	it("gives every page a real lastmod, not in the future", () => {
		for (const page of PUBLIC_PAGES) {
			expect(page.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(page.lastmod <= today).toBe(true);
		}
		expect(() => buildSitemap(ORIGIN, PUBLIC_PAGES)).not.toThrow();
	});
});

describe("front door copy", () => {
	const messages = JSON.parse(
		readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"),
	) as Record<string, string>;

	it("uses the title and description from wayfinder ticket 34", () => {
		expect(messages.home_title).toBe(
			"Speeedy: Free Online Speed Reader, No Account",
		);
		expect(messages.home_description).toBe(
			"Paste text or open a PDF, EPUB or DOCX and read it word by word at a pace you choose. Free, open source, no account, nothing uploaded.",
		);
	});

	it("keeps the title within 60 characters and the description within 155", () => {
		expect((messages.home_title ?? "").length).toBeLessThanOrEqual(60);
		expect((messages.home_description ?? "").length).toBeLessThanOrEqual(155);
	});

	it("has the one Spreeder line, word for word", () => {
		expect(messages.home_alternative).toBe(
			"A free, open-source alternative to Spreeder",
		);
	});

	it("follows the copy rules: no 'best', no speed multipliers", () => {
		for (const [key, value] of Object.entries(messages)) {
			if (!key.startsWith("home_")) continue;
			expect(value, key).not.toMatch(/\bbest\b/i);
			expect(value, key).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
			expect(value, key).not.toMatch(/\b(double|triple|twice)\b/i);
		}
	});
});

describe("og image", () => {
	it("is 1200 by 630", () => {
		const bytes = readFileSync(
			new URL("../static/og-image.png", import.meta.url),
		);
		expect(bytes.subarray(1, 4).toString()).toBe("PNG");
		expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
			1200, 630,
		]);
	});
});

// Cloudflare Pages `_headers`: a path or host pattern on its own line, then indented headers.
function headerRules(): { pattern: string; headers: string[] }[] {
	const rules: { pattern: string; headers: string[] }[] = [];
	const text = readFileSync(
		new URL("../static/_headers", import.meta.url),
		"utf8",
	);
	for (const raw of text.split("\n")) {
		if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
		if (/^\s/.test(raw)) rules.at(-1)?.headers.push(raw.trim());
		else rules.push({ pattern: raw.trim(), headers: [] });
	}
	return rules;
}

const matches = (pattern: string, url: string): boolean => {
	// A path pattern matches the path only; a host pattern matches the full URL.
	const target = pattern.startsWith("/") ? new URL(url).pathname : url;
	const source = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${source}$`).test(target);
};

const noindexFor = (url: string): boolean =>
	headerRules().some(
		(rule) =>
			matches(rule.pattern, url) &&
			rule.headers.some((header) => /^x-robots-tag:.*noindex/i.test(header)),
	);

describe("noindex headers", () => {
	it("covers every app route", () => {
		for (const path of [
			"/reader",
			"/library",
			"/stats",
			"/training",
			"/s",
			"/account/sign-in",
		]) {
			expect(noindexFor(`https://example.test${path}`), path).toBe(true);
		}
	});

	it("covers every Pages preview host and no public route", () => {
		expect(noindexFor("https://feature-x.speeedy.pages.dev/")).toBe(true);
		expect(
			noindexFor("https://abc123.speeedy.pages.dev/pdf-speed-reader"),
		).toBe(true);
		for (const path of ["/", "/sitemap.xml", "/robots.txt", "/learn"]) {
			expect(noindexFor(`https://speeedy.app${path}`), path).toBe(false);
			expect(noindexFor(`https://speeedy.pages.dev${path}`), path).toBe(false);
		}
	});
});
