import { expect, type Page, test } from "@playwright/test";

const EMAIL = "canary.reader@example.com";
const ENDPOINT = "**/api/newsletter";

/** Replaces the Worker, which does not run under `vite preview`. */
async function fakeWorker(page: Page, status = 202) {
	const bodies: unknown[] = [];
	await page.route(ENDPOINT, async (route) => {
		bodies.push(route.request().postDataJSON());
		await route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify(status === 202 ? { ok: true } : { error: "x" }),
		});
	});
	return bodies;
}

const form = (page: Page) => page.getByRole("form", { name: "Newsletter" });

test.describe("where the form appears", () => {
	for (const route of ["/", "/library", "/stats", "/account"]) {
		test(`${route} has one compact form in the footer`, async ({ page }) => {
			await page.goto(route);
			await expect(form(page)).toHaveCount(1);
			await expect(page.locator("footer").getByRole("form")).toHaveCount(1);
		});
	}

	for (const route of ["/reader", "/training", "/s"]) {
		test(`${route}, a reading surface, has no form`, async ({ page }) => {
			await page.goto(route);
			await expect(page.getByRole("form", { name: "Newsletter" })).toHaveCount(
				0,
			);
			await expect(page.getByLabel("Email address")).toHaveCount(0);
		});
	}

	test("is never a popup, a dialog or a modal", async ({ page }) => {
		await page.goto("/");
		await page.waitForTimeout(500);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.locator("[aria-modal]")).toHaveCount(0);
	});
});

test.describe("the form", () => {
	test("says how often it writes and that nothing tracks", async ({ page }) => {
		await page.goto("/");
		const text = ((await form(page).textContent()) ?? "").toLowerCase();
		expect(text).toContain("about once a month, never more");
		expect(text).toContain("no tracking pixels, no tracked links");
		expect(text).toContain("confirm");
	});

	test("has Speeedy as the subscription and an unticked What I'm building box", async ({
		page,
	}) => {
		await page.goto("/");
		const boxes = form(page).getByRole("checkbox");
		await expect(boxes).toHaveCount(1);
		await expect(
			form(page).getByRole("checkbox", { name: /What I.m building/ }),
		).not.toBeChecked();
	});

	test("posts the address to the same-origin Worker and asks the reader to confirm", async ({
		page,
		context,
	}) => {
		const bodies = await fakeWorker(page);
		const outside: string[] = [];
		page.on("request", (r) => {
			if (!r.url().startsWith("http://localhost")) outside.push(r.url());
		});
		await page.goto("/");

		await form(page).getByLabel("Email address").fill(EMAIL);
		await form(page).getByRole("button", { name: "Subscribe" }).click();

		await expect(form(page).getByRole("status")).toContainText(/confirm/i);
		expect(bodies).toEqual([
			{ email: EMAIL, building: false, page: "home", website: "" },
		]);
		expect(outside).toEqual([]);
		expect(await context.cookies()).toEqual([]);
	});

	test("sends building: true when the box is ticked", async ({ page }) => {
		const bodies = await fakeWorker(page);
		await page.goto("/library");

		await form(page).getByLabel("Email address").fill(EMAIL);
		await form(page)
			.getByRole("checkbox", { name: /What I.m building/ })
			.check();
		await form(page).getByRole("button", { name: "Subscribe" }).click();

		await expect(form(page).getByRole("status")).toBeVisible();
		expect(bodies).toEqual([
			{ email: EMAIL, building: true, page: "library", website: "" },
		]);
	});

	test("never puts the address in a URL or a header", async ({ page }) => {
		await fakeWorker(page);
		const seen: { url: string; headers: string }[] = [];
		page.on("request", (r) =>
			seen.push({ url: r.url(), headers: JSON.stringify(r.headers()) }),
		);
		await page.goto("/");
		await form(page).getByLabel("Email address").fill(EMAIL);
		await form(page).getByRole("button", { name: "Subscribe" }).click();
		await expect(form(page).getByRole("status")).toBeVisible();

		for (const r of seen) {
			expect(r.url, r.url).not.toContain("canary");
			expect(r.url, r.url).not.toContain("example.com");
			expect(r.headers).not.toContain("canary");
		}
		expect(page.url()).not.toContain("canary");
	});

	test("does not send a malformed address", async ({ page }) => {
		const bodies = await fakeWorker(page);
		await page.goto("/");

		await form(page).getByLabel("Email address").fill("not-an-address");
		await form(page).getByRole("button", { name: "Subscribe" }).click();

		expect(bodies).toEqual([]);
		await expect(form(page).getByRole("status")).toHaveCount(0);
	});

	test("hides the honeypot from readers, keyboards and screen readers", async ({
		page,
	}) => {
		await page.goto("/");
		const trap = form(page).locator('input[name="website"]');
		await expect(trap).toHaveCount(1);
		await expect(trap).toHaveValue("");
		await expect(trap).toHaveAttribute("tabindex", "-1");
		await expect(trap).toHaveAttribute("autocomplete", "off");
		expect(
			await trap.evaluate((el) => !!el.closest('[aria-hidden="true"]')),
		).toBe(true);
		await expect(trap).not.toBeInViewport();
	});

	test("shows an error and keeps the address when the Worker fails", async ({
		page,
	}) => {
		await fakeWorker(page, 502);
		await page.goto("/");

		await form(page).getByLabel("Email address").fill(EMAIL);
		await form(page).getByRole("button", { name: "Subscribe" }).click();

		await expect(form(page).getByRole("alert")).toContainText(/try again/i);
		await expect(form(page).getByLabel("Email address")).toHaveValue(EMAIL);
		await expect(
			form(page).getByRole("button", { name: "Subscribe" }),
		).toBeEnabled();
	});

	test("tells the reader to wait when rate limited", async ({ page }) => {
		await fakeWorker(page, 429);
		await page.goto("/");

		await form(page).getByLabel("Email address").fill(EMAIL);
		await form(page).getByRole("button", { name: "Subscribe" }).click();

		await expect(form(page).getByRole("alert")).toContainText(/minute/i);
	});

	test("fits at 390px with no horizontal scroll", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await form(page).scrollIntoViewIfNeeded();
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
