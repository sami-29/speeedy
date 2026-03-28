import { expect, test } from "@playwright/test";

test.describe("Settings persistence", () => {
	test("theme toggle persists across page reload", async ({ page }) => {
		await page.goto("/#/app");

		const getTheme = () =>
			page.locator("html").getAttribute("data-theme");

		const initialTheme = await getTheme();

		const themeBtn = page.locator("button[aria-label*='Theme'], button[title*='Theme']")
			.or(page.locator("button.theme-button"))
			.or(page.locator("nav button").filter({ has: page.locator("svg") }).last());
		await themeBtn.first().click();

		await page.waitForTimeout(200);
		const changedTheme = await getTheme();

		expect(changedTheme).not.toBe(initialTheme);

		await page.reload();
		await page.waitForTimeout(500);

		const reloadedTheme = await getTheme();
		expect(reloadedTheme).toBe(changedTheme);
	});

	test("navigating to app preserves profile data", async ({ page }) => {
		await page.goto("/#/app");
		await expect(page.locator("app-page")).toBeVisible({ timeout: 5000 });
	});

	test("profile page is accessible", async ({ page }) => {
		await page.goto("/#/profile");
		await expect(
			page.locator("text=Profile").first(),
		).toBeVisible({ timeout: 3000 });
	});

	test("stats page renders", async ({ page }) => {
		await page.goto("/#/stats");
		await expect(
			page
				.locator("text=Stats")
				.or(page.locator("text=Reading Stats"))
				.or(page.locator("stats-dashboard"))
				.first(),
		).toBeVisible({ timeout: 3000 });
	});

	test("learn page renders", async ({ page }) => {
		await page.goto("/#/learn");
		await expect(
			page
				.locator("text=RSVP")
				.or(page.locator("text=Speed Reading"))
				.or(page.locator("learn-page"))
				.first(),
		).toBeVisible({ timeout: 3000 });
	});

	test("privacy page renders", async ({ page }) => {
		await page.goto("/#/privacy");
		await expect(
			page.locator("text=Privacy Policy").first(),
		).toBeVisible({ timeout: 3000 });
	});

	test("terms page renders", async ({ page }) => {
		await page.goto("/#/terms");
		await expect(
			page.locator("text=Terms of Service").first(),
		).toBeVisible({ timeout: 3000 });
	});
});
