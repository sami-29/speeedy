import { expect, type Page, test } from "@playwright/test";

type Sent = { event: string; properties: Record<string, unknown> };

/** Collects what the page posts to /api/e. */
async function captureEvents(page: Page): Promise<Sent[]> {
	const events: Sent[] = [];
	await page.route("**/api/e", async (route) => {
		const body = route.request().postDataJSON() as { events: Sent[] };
		events.push(...body.events);
		await route.fulfill({ status: 204 });
	});
	return events;
}

const pageviews = (events: Sent[]) =>
	events.filter((e) => e.event === "$pageview");

test.describe("$pageview", () => {
	test("is sent for the route, with no query and no hash", async ({ page }) => {
		const events = await captureEvents(page);
		await page.goto("/reader?secret=1#private");
		await expect
			.poll(() => pageviews(events).length, { timeout: 10_000 })
			.toBe(1);
		expect(pageviews(events)[0]?.properties).toMatchObject({
			route: "/reader",
		});
		expect(JSON.stringify(events)).not.toMatch(/secret|private/);
	});

	test("is sent again on a client-side navigation", async ({ page }) => {
		const events = await captureEvents(page);
		await page.goto("/reader");
		await page.getByRole("link", { name: "Library" }).click();
		await expect(page).toHaveURL(/\/library$/);
		await expect
			.poll(() => pageviews(events).map((e) => e.properties.route), {
				timeout: 10_000,
			})
			.toEqual(["/reader", "/library"]);
	});
});

test.describe("flags on startup", () => {
	test("an injected config is used and the network is not asked", async ({
		page,
	}) => {
		const events = await captureEvents(page);
		let asked = false;
		await page.route("**/api/flags", (route) => {
			asked = true;
			return route.fulfill({ status: 404 });
		});
		await page.addInitScript(() => {
			(window as unknown as Record<string, unknown>).__speeedyFlags = {
				version: 1,
				flags: { pipeline_check: { percent: 100, variant: "on" } },
			};
		});
		await page.goto("/reader");
		await expect
			.poll(() => pageviews(events).length, { timeout: 10_000 })
			.toBe(1);
		expect(pageviews(events)[0]?.properties).toMatchObject({
			route: "/reader",
			exp_pipeline_check: "on",
		});
		expect(asked).toBe(false);
	});

	test("without an injected config the Worker's config is fetched", async ({
		page,
	}) => {
		const events = await captureEvents(page);
		await page.route("**/api/flags", (route) =>
			route.fulfill({
				json: {
					version: 1,
					flags: { pipeline_check: { percent: 100, variant: "on" } },
				},
			}),
		);
		await page.goto("/reader");
		await expect
			.poll(() => pageviews(events).length, { timeout: 10_000 })
			.toBe(1);
		expect(pageviews(events)[0]?.properties).toMatchObject({
			exp_pipeline_check: "on",
		});
	});

	test("with no config the flag keeps its fallback", async ({ page }) => {
		const events = await captureEvents(page);
		await page.route("**/api/flags", (route) => route.fulfill({ status: 404 }));
		await page.goto("/reader");
		await expect
			.poll(() => pageviews(events).length, { timeout: 10_000 })
			.toBe(1);
		expect(pageviews(events)[0]?.properties).toMatchObject({
			exp_pipeline_check: "off",
		});
	});
});

test.describe("error capture", () => {
	test("an uncaught error is reported by code and frames, never its message", async ({
		page,
	}) => {
		const events = await captureEvents(page);
		await page.goto("/reader");
		// The first pageview means the app has started, handlers included.
		await expect
			.poll(() => pageviews(events).length, { timeout: 10_000 })
			.toBe(1);
		await page.evaluate(() => {
			setTimeout(() => {
				throw new Error("canary-secret-text-from-a-document");
			}, 0);
		});
		await expect
			.poll(() => events.filter((e) => e.event === "$exception").length, {
				timeout: 10_000,
			})
			.toBeGreaterThan(0);
		expect(JSON.stringify(events)).not.toContain("canary-secret-text");
	});
});
