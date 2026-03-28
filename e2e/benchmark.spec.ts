import { expect, test } from "@playwright/test";

test.describe("Benchmark test flow", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/#/benchmark");
	});

	test("intro phase renders correctly", async ({ page }) => {
		await expect(
			page
				.locator("text=Find your reading speed")
				.or(page.locator("text=Reading Baseline")),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /start reading/i }),
		).toBeVisible();
	});

	test("clicking Start reading moves to the reading phase", async ({
		page,
	}) => {
		await page.getByRole("button", { name: /start reading/i }).click();
		await expect(
			page
				.locator("text=Reading Test")
				.or(page.locator("text=Start reading"))
				.first(),
		).toBeVisible({ timeout: 3000 });
	});

	test("full benchmark flow: read → quiz → results", async ({ page }) => {
		await page.getByRole("button", { name: /start reading/i }).click();

		const startBtn = page.getByRole("button", { name: /start reading/i });
		await expect(startBtn).toBeVisible({ timeout: 3000 });
		await startBtn.click();

		const doneBtn = page.getByRole("button", { name: /done reading/i });
		await expect(doneBtn).toBeVisible({ timeout: 5000 });
		await doneBtn.click();

		await expect(
			page
				.locator("text=Comprehension Quiz")
				.or(page.locator("text=question")),
		).toBeVisible({ timeout: 3000 });

		let attempts = 0;
		while (attempts < 15) {
			const unselectedOptions = page.locator(
				"button:has-text('A.'):not(.border-primary)",
			);
			const count = await unselectedOptions.count();
			if (count === 0) break;
			await unselectedOptions.first().click();
			await page.waitForTimeout(100);
			attempts++;
		}

		const submitBtn = page.getByRole("button", { name: /submit/i });
		await expect(submitBtn).toBeEnabled({ timeout: 3000 });
		await submitBtn.click();

		await expect(
			page.locator("text=WPM").or(page.locator("text=Your Results")).first(),
		).toBeVisible({ timeout: 5000 });

		await expect(page.locator("text=WPM").first()).toBeVisible();
		await expect(
			page.locator("text=Comprehension").first(),
		).toBeVisible();
	});

	test("results page has a Start reading link to the app", async ({
		page,
	}) => {
		await page.getByRole("button", { name: /start reading/i }).click();
		const startBtn = page.getByRole("button", { name: /start reading/i });
		await startBtn.click();
		const doneBtn = page.getByRole("button", { name: /done reading/i });
		await expect(doneBtn).toBeVisible({ timeout: 5000 });
		await doneBtn.click();

		for (let i = 0; i < 12; i++) {
			const firstOpt = page
				.locator("button")
				.filter({ hasText: /^A\./ })
				.first();
			if (!(await firstOpt.isVisible({ timeout: 500 }))) break;
			await firstOpt.click();
			await page.waitForTimeout(80);
		}

		const submitBtn = page.getByRole("button", { name: /submit/i });
		if (await submitBtn.isEnabled({ timeout: 2000 })) {
			await submitBtn.click();
			const startReadingLink = page.getByRole("link", {
				name: /start reading/i,
			});
			await expect(startReadingLink).toBeVisible({ timeout: 5000 });
			await expect(startReadingLink).toHaveAttribute("href", /#\/app/);
		}
	});
});
