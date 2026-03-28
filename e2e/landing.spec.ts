import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
	});

	test("renders the hero headline", async ({ page }) => {
		await expect(
			page.locator("text=light_speed").or(page.locator("text=light speed")),
		).toBeVisible();
	});

	test("shows the primary CTA — Take the speed test", async ({ page }) => {
		const cta = page
			.getByRole("link", { name: /take the speed test/i })
			.first();
		await expect(cta).toBeVisible();
		await expect(cta).toHaveAttribute("href", /#\/benchmark/);
	});

	test("shows the Open app link", async ({ page }) => {
		const link = page.getByRole("link", { name: /open.*(app|reader)/i }).first();
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute("href", /#\/app/);
	});

	test("displays navigation with GitHub link", async ({ page }) => {
		const githubLink = page.getByRole("link", { name: /github/i });
		await expect(githubLink).toBeVisible();
	});

	test("features section lists ORP alignment", async ({ page }) => {
		await expect(page.locator("text=ORP alignment")).toBeVisible();
	});

	test("stats section shows average WPM", async ({ page }) => {
		await expect(page.locator("text=238").first()).toBeVisible();
	});

	test("clicking Open app navigates to #/app", async ({ page }) => {
		const link = page
			.getByRole("link", { name: /open.*(app|reader)/i })
			.first();
		await link.click();
		await expect(page).toHaveURL(/#\/app/);
	});
});
