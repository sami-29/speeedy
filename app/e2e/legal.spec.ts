import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { EVENTS, eventList, PLANS } from "@speeedy/contracts";

const PAGES = [
	{
		path: "/privacy",
		title: "Privacy Policy | Speeedy",
		h1: "Privacy Policy.",
		marked: true,
	},
	{
		path: "/terms",
		title: "Terms of Service | Speeedy",
		h1: "Terms of Service.",
		marked: true,
	},
	{
		path: "/privacy/events",
		title: "Analytics Event List | Speeedy",
		h1: "Analytics events.",
		marked: false,
	},
] as const;

const htmlEscape = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/'/g, "&#39;");

const bodyText = (html: string) =>
	html
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<style[\s\S]*?<\/style>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
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
			expect(bodyText(html)).toContain(page.h1);
		});

		test("is marked as awaiting lawyer review only where it is legal text", async ({
			request,
		}) => {
			const html = await (await request.get(page.path)).text();
			if (page.marked) {
				expect(html).toContain('data-status="awaiting-lawyer-review"');
				expect(bodyText(html)).toMatch(/awaiting lawyer review/i);
			} else {
				expect(html).not.toContain("awaiting-lawyer-review");
			}
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

test.describe("the sitemap", () => {
	test("lists the three pages with absolute URLs", async ({ request }) => {
		const xml = await (await request.get("/sitemap.xml")).text();
		for (const page of PAGES) {
			expect(xml).toMatch(new RegExp(`<loc>https?://[^<]+${page.path}</loc>`));
		}
	});
});

test.describe("/privacy", () => {
	test("starts with the short version, word for word", async ({ request }) => {
		const body = bodyText(await (await request.get("/privacy")).text());
		expect(body).toContain(
			"Speeedy reads your documents on your device. Nothing you read leaves it unless you turn on a Plus feature that needs our servers, and we ask first.",
		);
	});

	test("has one processor table with one row per processor", async ({
		page,
	}) => {
		await page.goto("/privacy");
		const table = page.locator("table#processors");
		await expect(table).toHaveCount(1);
		const names = await table
			.locator("tbody tr th")
			.evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim()));
		expect(names).toEqual([
			"Cloudflare",
			"Modal",
			"PostHog",
			"Buttondown",
			"Polar",
		]);
		expect(new Set(names).size).toBe(names.length);
		await expect(page.locator("table#processors tbody tr")).toHaveCount(5);
	});

	test("says PostHog is in the US", async ({ page }) => {
		await page.goto("/privacy");
		const row = page.locator("table#processors tbody tr", {
			hasText: "PostHog",
		});
		await expect(row).toContainText(/\bUS\b|United States/);
		await expect(row).not.toContainText(/\bEU\b/);
	});

	for (const anchor of ["play", "extension"]) {
		test(`#${anchor} is a section a store listing can link to`, async ({
			page,
		}) => {
			await page.goto(`/privacy?ref=chrome-store#${anchor}`);
			const target = page.locator(`:target`);
			await expect(target).toHaveAttribute("id", anchor);
			await expect(target).toBeVisible();
			await expect(target.getByRole("heading", { level: 2 })).toBeVisible();
		});
	}

	test("the Play section links the account-deletion page", async ({ page }) => {
		await page.goto("/privacy#play");
		await expect(
			page.locator('#play a[href="/account/delete"]').first(),
		).toBeVisible();
	});

	test("the extension section says it collects nothing", async ({ page }) => {
		await page.goto("/privacy#extension");
		await expect(page.locator("#extension")).toContainText(/collects nothing/i);
	});

	test("links the published event list, which opens", async ({
		page,
		request,
	}) => {
		await page.goto("/privacy");
		const link = page.locator('main a[href="/privacy/events"]').first();
		await expect(link).toBeVisible();
		expect((await request.get("/privacy/events")).status()).toBe(200);
		await link.click();
		await expect(page).toHaveURL(/\/privacy\/events$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Analytics events.",
		);
	});

	test("links the terms", async ({ page }) => {
		await page.goto("/privacy");
		await expect(page.locator('main a[href="/terms"]').first()).toBeVisible();
	});
});

test.describe("/terms", () => {
	test("keeps the Free Pledge and the consent rule outside the change clause", async ({
		page,
	}) => {
		await page.goto("/terms");
		const pledge = page.locator("section#free-pledge");
		const consent = page.locator("section#consent");
		const changes = page.locator("section#changes");
		await expect(pledge).toHaveCount(1);
		await expect(consent).toHaveCount(1);
		await expect(changes).toHaveCount(1);
		const nested = await page.evaluate(() => {
			const get = (id: string) => document.getElementById(id);
			const pledge = get("free-pledge");
			const consent = get("consent");
			const changes = get("changes");
			return {
				pledgeInChanges: !!pledge && !!changes?.contains(pledge),
				consentInChanges: !!consent && !!changes?.contains(consent),
				changesInPledge: !!pledge && !!changes && pledge.contains(changes),
				pledgeFirst: !!(
					pledge &&
					changes &&
					pledge.compareDocumentPosition(changes) &
						Node.DOCUMENT_POSITION_FOLLOWING
				),
			};
		});
		expect(nested).toEqual({
			pledgeInChanges: false,
			consentInChanges: false,
			changesInPledge: false,
			pledgeFirst: true,
		});
		await expect(pledge).toContainText(
			"outside the clause that lets these Terms change",
		);
	});

	test("shows the Plus prices and limits from the plan data", async ({
		request,
	}) => {
		const body = bodyText(await (await request.get("/terms")).text());
		const prices = PLANS.plus.prices.polar;
		const dollars = (cents: number) => `$${cents / 100}`;
		expect(body).toContain(dollars(prices.monthly.usdCents));
		expect(body).toContain(`${dollars(prices.annual.usdCents)} a year`);
		expect(body).toContain(dollars(prices.annualLaunch.usdCents));
		expect(body).toContain(`${PLANS.plus.limits.voiceHoursPerMonth} hours`);
	});

	test("has a section for Plus, the 14-day refund and 18+", async ({
		page,
	}) => {
		await page.goto("/terms");
		await expect(page.locator("section#plus")).toContainText(/14 days/);
		await expect(page.locator("section#accounts")).toContainText(/18 or over/);
		await expect(page.locator("section#law")).toContainText(/Delaware/);
	});

	test("links the privacy policy", async ({ page }) => {
		await page.goto("/terms");
		await expect(page.locator('main a[href="/privacy"]').first()).toBeVisible();
	});
});

test.describe("/privacy/events", () => {
	test("lists every registered event and the $exception shape, in registry order", async ({
		page,
	}) => {
		await page.goto("/privacy/events");
		const names = await page
			.locator("main section[data-event] h2")
			.evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim()));
		expect(names).toEqual([...Object.keys(EVENTS), "$exception"]);
	});

	test("lists every property of every registered event", async ({ page }) => {
		await page.goto("/privacy/events");
		for (const row of eventList(EVENTS)) {
			const section = page.locator(`section[data-event="${row.name}"]`);
			const props = await section
				.locator("tbody tr th")
				.evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim()));
			expect(props, row.name).toEqual(row.props.map((p) => p.name));
		}
	});

	test("shows the pageview routes, its own among them", async ({ page }) => {
		await page.goto("/privacy/events");
		const section = page.locator('section[data-event="$pageview"]');
		await expect(section).toContainText("/privacy/events");
		await expect(section).toContainText("/terms");
	});

	test("links back to the policy", async ({ page }) => {
		await page.goto("/privacy/events");
		await expect(page.locator('main a[href="/privacy"]').first()).toBeVisible();
	});

	test("sends one pageview with its own route and nothing else", async ({
		page,
	}: {
		page: Page;
	}) => {
		const events: { event: string; properties: Record<string, unknown> }[] = [];
		await page.route("**/api/e", async (route) => {
			const body = route.request().postDataJSON() as {
				events: typeof events;
			};
			events.push(...body.events);
			await route.fulfill({ status: 204 });
		});
		await page.goto("/privacy/events?x=secret#hash");
		await expect
			.poll(() => events.filter((e) => e.event === "$pageview").length, {
				timeout: 10_000,
			})
			.toBe(1);
		expect(events[0]?.properties).toMatchObject({ route: "/privacy/events" });
		expect(JSON.stringify(events)).not.toMatch(/secret|hash/);
	});
});
