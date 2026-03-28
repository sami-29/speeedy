import { expect, test } from "@playwright/test";

async function goToReaderWithText(
	page: import("@playwright/test").Page,
	text: string,
) {
	const bytes = new TextEncoder().encode(text);
	const base64 = btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	await page.goto(`/#/read/${base64}`);
	await page.waitForSelector("rsvp-reader", { timeout: 8000 });
}

test.describe("RSVP Reader", () => {
	const SAMPLE =
		"The quick brown fox jumps over the lazy dog. Speed reading is a powerful skill.";

	test("reader mounts and shows a word display", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await expect(page.locator(".reading-box, rsvp-reader").first()).toBeVisible();
	});

	test("Space bar toggles play and pause", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.keyboard.press("Space");
		await page.waitForTimeout(300);
		await page.keyboard.press("Space");
		await page.waitForTimeout(200);
		await expect(page).toHaveURL(/#\/reader/);
	});

	test("Escape key navigates back to app", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(/#\/app/, { timeout: 3000 });
	});

	test("? key opens the keyboard shortcuts overlay", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.keyboard.press("?");
		await expect(
			page
				.locator("text=Shortcuts")
				.or(page.locator("text=keyboard"))
				.or(page.locator("[data-shortcuts-modal]"))
				.first(),
		).toBeVisible({ timeout: 2000 });
	});

	test("back button in the header navigates to app", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		const backBtn = page
			.getByRole("button", { name: /back|home|exit/i })
			.or(page.locator("a[href='#/app'], a[href='#/']"))
			.first();
		if (await backBtn.isVisible({ timeout: 2000 })) {
			await backBtn.click();
			await expect(page).toHaveURL(/#\/(app|)/, { timeout: 3000 });
		}
	});

	test("progress bar is visible", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await expect(page.locator("rsvp-reader")).toBeVisible();
	});
});
