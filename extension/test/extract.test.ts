// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blockText, validateLauncherPage } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import { extractPage } from "../src/extract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
	readFileSync(join(here, "fixtures", name), "utf8");

const load = (html: string) =>
	new DOMParser().parseFromString(html, "text/html");

const ARTICLE_URL = "https://harbour.example/2026/staircase?utm_source=feed";

const allText = (blocks: Parameters<typeof blockText>[0][]) =>
	blocks.map(blockText).join("\n");

describe("extractPage on an article", () => {
	it("keeps the article's text and drops the page furniture", async () => {
		const result = await extractPage({
			dom: load(fixture("article.html")),
			url: ARTICLE_URL,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const text = allText(result.page.document.blocks);
		expect(text).toContain("climbed the same two hundred and four steps");
		expect(text).toContain("A staircase is only a long sentence");
		expect(text).toContain("What the steps taught him");
		for (const furniture of [
			"Subscribe to our newsletter",
			"BUY NOW",
			"COMMENTSPAM",
			"Cookie settings",
			"TRACKINGSCRIPT",
		]) {
			expect(text, furniture).not.toContain(furniture);
		}
	});

	it("carries the title, the language and the page's address", async () => {
		const result = await extractPage({
			dom: load(fixture("article.html")),
			url: ARTICLE_URL,
		});
		expect(result.ok && result.page).toMatchObject({
			type: "speeedy:page",
			version: 1,
			title: "The lighthouse keeper's staircase",
			language: "en",
			url: ARTICLE_URL,
		});
	});

	it("builds a message the receiving side accepts", async () => {
		const result = await extractPage({
			dom: load(fixture("article.html")),
			url: ARTICLE_URL,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(validateLauncherPage(result.page).ok).toBe(true);
	});

	it("leaves the live page untouched", async () => {
		const dom = load(fixture("article.html"));
		const before = dom.documentElement.outerHTML;
		await extractPage({ dom, url: ARTICLE_URL });
		expect(dom.documentElement.outerHTML).toBe(before);
	});

	it("keeps a link as a link span with an absolute address", async () => {
		const result = await extractPage({
			dom: load(fixture("article.html")),
			url: ARTICLE_URL,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const hrefs = result.page.document.blocks.flatMap((block) =>
			"spans" in block
				? block.spans.flatMap((span) =>
						span.kind === "link" ? [span.href] : [],
					)
				: [],
		);
		expect(hrefs).toContain("https://museum.example/notebooks");
		expect(hrefs.every((href) => /^https?:\/\//.test(href))).toBe(true);
	});
});

describe("extractPage on pages that are not articles", () => {
	it("falls back to the page's text when Readability finds no article", async () => {
		const html = `<!doctype html><html lang="de"><head><title>Status</title></head>
<body><div>Alle Systeme laufen. Letzte Prüfung vor zwei Minuten.</div></body></html>`;
		const result = await extractPage({
			dom: load(html),
			url: "https://status.example/",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(allText(result.page.document.blocks)).toContain(
			"Alle Systeme laufen",
		);
		expect(result.page.title).toBe("Status");
		expect(result.page.language).toBe("de");
	});

	it("says there is nothing to read on an empty page", async () => {
		const result = await extractPage({
			dom: load(
				"<!doctype html><html><head><title>x</title></head><body></body></html>",
			),
			url: "https://blank.example/",
		});
		expect(result).toEqual({ ok: false, reason: "empty" });
	});

	it.each([
		"chrome://newtab/",
		"chrome-extension://abc/page.html",
		"file:///home/me/notes.html",
		"about:blank",
		"data:text/html,<p>hi</p>",
		"javascript:void(0)",
		"",
	])("refuses %j, which is not a web page", async (url) => {
		const result = await extractPage({
			dom: load(fixture("article.html")),
			url,
		});
		expect(result).toEqual({ ok: false, reason: "not-web-page" });
	});
});

describe("extractPage limits", () => {
	it("refuses a page whose article is over the block cap instead of cutting it short", async () => {
		const result = await extractPage(
			{ dom: load(fixture("article.html")), url: ARTICLE_URL },
			{ limits: { blocks: 3 } },
		);
		expect(result).toEqual({ ok: false, reason: "too-big" });
	});

	it("refuses a page whose article is over the text cap", async () => {
		const result = await extractPage(
			{ dom: load(fixture("article.html")), url: ARTICLE_URL },
			{ limits: { characters: 200 } },
		);
		expect(result).toEqual({ ok: false, reason: "too-big" });
	});

	it("clips a title to the cap rather than failing the page", async () => {
		const long = Array.from({ length: 120 }, () => "stairs").join(" ");
		const html = fixture("article.html").replace(
			/<title>.*<\/title>/,
			`<title>${long}</title>`,
		);
		const result = await extractPage({ dom: load(html), url: ARTICLE_URL });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.page.title.length).toBeLessThanOrEqual(300);
	});
});
