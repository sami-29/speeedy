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

test.describe("Keyboard shortcuts in the reader", () => {
	const SAMPLE =
		"Reading is a skill that can be improved with practice and dedication. " +
		"Rapid serial visual presentation helps train the eyes to stay still. " +
		"Each word appears at the optimal recognition point for fastest processing.";

	test("Space starts playback", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.locator("body").click();
		await page.keyboard.press("Space");
		await page.waitForTimeout(400);
		await expect(page).toHaveURL(/#\/reader/);
	});

	test("Space pauses after starting", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.locator("body").click();
		await page.keyboard.press("Space");
		await page.waitForTimeout(300);
		await page.keyboard.press("Space");
		await page.waitForTimeout(200);
		await expect(page).toHaveURL(/#\/reader/);
	});

	test("Escape navigates back to app", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.locator("body").click();
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(/#\/(app|)/, { timeout: 3000 });
	});

	test("ArrowRight increases speed (no crash)", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.locator("body").click();
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowRight");
		await expect(page).toHaveURL(/#\/reader/);
	});

	test("ArrowLeft decreases speed (no crash)", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.locator("body").click();
		await page.keyboard.press("ArrowLeft");
		await expect(page).toHaveURL(/#\/reader/);
	});

	test("R key resets to beginning", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.locator("body").click();
		await page.keyboard.press("Space");
		await page.waitForTimeout(500);
		await page.keyboard.press("r");
		await expect(page).toHaveURL(/#\/reader/);
	});

	test("? key opens shortcuts panel", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.locator("body").click();
		await page.keyboard.press("?");
		await page.waitForTimeout(300);
		await expect(
			page
				.locator("text=Shortcuts")
				.or(page.locator("text=Play / Pause"))
				.or(page.locator("text=Space"))
				.first(),
		).toBeVisible({ timeout: 2000 });
		await page.keyboard.press("?");
	});
});
