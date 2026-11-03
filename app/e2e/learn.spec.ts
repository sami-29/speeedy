import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const HUB = {
	path: "/learn",
	title: "Learn: Reading Speed, Backed by Research | Speeedy",
};
const ARTICLES = [
	{
		path: "/learn/how-to-read-faster",
		title: "How to Read Faster: What the Research Says | Speeedy",
		h1: "How to read faster.",
	},
	{
		path: "/learn/what-is-rsvp",
		title: "What Is RSVP Reading? Evidence and Limits | Speeedy",
		h1: "What is RSVP?",
	},
	{
		path: "/learn/average-reading-speed",
		title: "Average Reading Speed: 238 WPM for Non-Fiction | Speeedy",
		h1: "Average reading speed.",
	},
] as const;
const PAGES = [
	{ ...HUB, h1: "What speed reading can and can't do." },
	...ARTICLES,
];

// How the HTML writes an apostrophe in an attribute or the title.
const htmlEscape = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/'/g, "&#39;");

const bodyText = (html: string) =>
	html
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<style[\s\S]*?<\/style>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ");

for (const page of PAGES) {
	test.describe(page.path, () => {
		test("prerenders the title, a description, the canonical and the share tags", async ({
			request,
		}) => {
			const response = await request.get(page.path);
			expect(response.status()).toBe(200);
			const html = await response.text();
			expect(html).toContain(`<title>${htmlEscape(page.title)}</title>`);
			const description = /<meta name="description" content="([^"]+)"/.exec(
				html,
			)?.[1];
			expect(description).toBeTruthy();
			expect((description ?? "").length).toBeLessThanOrEqual(160);
			expect(html).toContain(
				`<meta property="og:title" content="${htmlEscape(page.title)}"`,
			);
			expect(html).toMatch(
				new RegExp(`<link rel="canonical" href="https?://[^"]+${page.path}"`),
			);
			expect(html).toContain(
				'<meta name="twitter:card" content="summary_large_image"',
			);
			expect(html).not.toMatch(/<meta[^>]*name="robots"/);
			expect(response.headers()["x-robots-tag"]).toBeUndefined();
		});

		test("has one h1 and its text in the HTML, without JavaScript", async ({
			request,
		}) => {
			const html = await (await request.get(page.path)).text();
			expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
			expect(bodyText(html)).toContain(page.h1.replace(/'/g, "'"));
			expect(html.match(/<h2[\s>]/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
		});

		test("never promises a speed multiplier or the best", async ({
			request,
		}) => {
			const body = bodyText(await (await request.get(page.path)).text());
			expect(body).not.toMatch(/\bbest\b/i);
			expect(body).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
		});

		test("fits at 390px with no sideways scrolling", async ({ page: tab }) => {
			await tab.setViewportSize({ width: 390, height: 844 });
			await tab.goto(page.path);
			await tab.evaluate(() => document.fonts.ready);
			const overflow = await tab.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});

		for (const viewport of [
			{ name: "390px", width: 390, height: 844 },
			{ name: "desktop", width: 1280, height: 800 },
		]) {
			test(`axe passes at ${viewport.name}`, async ({ page: tab }) => {
				await tab.setViewportSize({
					width: viewport.width,
					height: viewport.height,
				});
				await tab.goto(page.path);
				await tab.evaluate(() => document.fonts.ready);
				const results = await new AxeBuilder({ page: tab })
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
					.analyze();
				expect(results.violations).toEqual([]);
			});
		}
	});
}

for (const article of ARTICLES) {
	test.describe(`${article.path} citations`, () => {
		test("every claim carries a numbered source that resolves to a reference with a DOI", async ({
			page,
		}) => {
			await page.goto(article.path);
			const claims = page.locator("[data-claim]");
			expect(await claims.count()).toBeGreaterThanOrEqual(4);
			const refs = await page.$$eval("#references > li", (items) =>
				items.map((item) => ({
					id: item.id,
					doi: item.querySelector("a")?.getAttribute("href") ?? "",
					text: item.textContent ?? "",
				})),
			);
			expect(refs.length).toBeGreaterThanOrEqual(2);
			for (const ref of refs) {
				expect(ref.id).toMatch(/^ref-/);
				expect(ref.doi).toMatch(/^https:\/\/doi\.org\/10\.\d{4,9}\//);
			}
			const cites = await claims.evaluateAll((nodes) =>
				nodes.map((node) =>
					[...node.querySelectorAll("a.cite")].map((a) => ({
						href: a.getAttribute("href") ?? "",
						label: a.getAttribute("aria-label") ?? "",
					})),
				),
			);
			for (const claim of cites) {
				expect(claim.length).toBeGreaterThan(0);
				for (const cite of claim) {
					expect(refs.map((ref) => `#${ref.id}`)).toContain(cite.href);
					expect(cite.label).toMatch(/^Source \d+: /);
				}
			}
		});

		test("lists the sources in order of first use, numbered from 1", async ({
			page,
		}) => {
			await page.goto(article.path);
			const first = await page
				.locator("[data-claim] a.cite")
				.first()
				.textContent();
			expect(first?.trim()).toBe("[1]");
			const count = await page.locator("#references > li").count();
			const numbers = await page
				.locator("a.cite")
				.evaluateAll((nodes) =>
					nodes.map((n) => Number(n.textContent?.replace(/\D/g, ""))),
				);
			expect(Math.max(...numbers)).toBe(count);
			let seen = 0;
			for (const n of numbers) {
				expect(n).toBeLessThanOrEqual(seen + 1);
				seen = Math.max(seen, n);
			}
		});

		test("the source mark moves to its reference", async ({ page }) => {
			await page.goto(article.path);
			await page.locator("[data-claim] a.cite").first().click();
			await expect(page).toHaveURL(/#ref-/);
			const target = page.locator(":target");
			await expect(target).toBeVisible();
			await expect(target).toContainText(/\(\d{4}\)|\d{4}/);
		});

		test("links to the hub and the other two articles", async ({ page }) => {
			await page.goto(article.path);
			await expect(page.locator(`main a[href="/learn"]`).first()).toBeVisible();
			for (const other of ARTICLES.filter((a) => a.path !== article.path)) {
				await expect(
					page.locator(`main a[href="${other.path}"]`).first(),
				).toBeVisible();
			}
		});
	});
}

test.describe("/learn", () => {
	test("lists the three articles and each link reaches its page", async ({
		page,
	}) => {
		await page.goto("/learn");
		for (const article of ARTICLES) {
			await expect(
				page.locator(`main a[href="${article.path}"]`).first(),
			).toBeVisible();
		}
		await page.locator(`main a[href="/learn/what-is-rsvp"]`).first().click();
		await expect(page).toHaveURL(/\/learn\/what-is-rsvp$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"What is RSVP?",
		);
	});

	test("the front door links to it, so the crawl finds it", async ({
		request,
	}) => {
		const html = await (await request.get("/")).text();
		expect(html).toMatch(/href="\/learn"/);
	});

	test("is in the sitemap with its three articles", async ({ request }) => {
		const xml = await (await request.get("/sitemap.xml")).text();
		for (const path of ["/learn", ...ARTICLES.map((a) => a.path)]) {
			expect(xml).toMatch(new RegExp(`<loc>https?://[^<]+${path}</loc>`));
		}
	});
});

test.describe("/learn/what-is-rsvp content", () => {
	test("opens with the Rayner 2016 caveat in the review's own word", async ({
		request,
	}) => {
		const body = bodyText(
			await (await request.get("/learn/what-is-rsvp")).text(),
		);
		expect(body).toContain("Rayner");
		expect(body).toContain("“unlikely”");
		expect(body.indexOf("“unlikely”")).toBeLessThan(body.indexOf("Moussaoui"));
	});

	test("sends the ADHD study's limits to the ADHD page, which exists", async ({
		page,
		request,
	}) => {
		await page.goto("/learn/what-is-rsvp");
		await expect(page.getByText("initial step")).toBeVisible();
		const href = await page
			.locator('main a[href="/adhd-reading-tool"]')
			.first()
			.getAttribute("href");
		expect(href).toBe("/adhd-reading-tool");
		expect((await request.get("/adhd-reading-tool")).status()).toBe(200);
	});
});

test.describe("/learn/average-reading-speed content", () => {
	test("gives the 238 and 260 figures with their source", async ({
		request,
	}) => {
		const body = bodyText(
			await (await request.get("/learn/average-reading-speed")).text(),
		);
		expect(body).toContain("238");
		expect(body).toContain("260");
		expect(body).toContain("18,573");
		expect(body).toContain("Brysbaert");
	});

	test("shows the chart as a labelled illustration with a cited caption", async ({
		page,
	}) => {
		await page.goto("/learn/average-reading-speed");
		const figure = page.locator("figure");
		await expect(figure).toHaveCount(1);
		const chart = figure.getByRole("img");
		await expect(chart).toHaveAccessibleName(/238/);
		await expect(chart).toHaveAccessibleName(/260/);
		await expect(figure.locator("figcaption a.cite")).toHaveCount(1);
		await expect(figure.locator("figcaption")).toContainText("Brysbaert");
	});

	test("the chart fits at 390px", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/learn/average-reading-speed");
		const box = await page.locator("figure svg").boundingBox();
		expect(box).toBeTruthy();
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
	});
});

test.describe("/learn/how-to-read-faster content", () => {
	test("says what the main review concluded and what has evidence", async ({
		request,
	}) => {
		const body = bodyText(
			await (await request.get("/learn/how-to-read-faster")).text(),
		);
		expect(body).toContain("“unlikely”");
		expect(body).toContain("Language skill is at the heart of reading speed");
		expect(body).toContain("Breznitz");
	});

	test("carries none of the 1.x claims the research rejects", async ({
		request,
	}) => {
		for (const article of ARTICLES) {
			const body = bodyText(await (await request.get(article.path)).text());
			expect(body).not.toMatch(/400[–-]450|300[–-]500|\b(400|450|500)\+/);
			expect(body).not.toMatch(/bottleneck is (your )?eyes/i);
		}
	});
});
