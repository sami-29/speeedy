import { expect, test } from "@playwright/test";

test.describe("App page — intake flow", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/#/app");
	});

	test("renders the page heading", async ({ page }) => {
		await expect(
			page.locator("text=What are you reading").first(),
		).toBeVisible();
	});

	test("shows File and Text tabs", async ({ page }) => {
		await expect(page.getByRole("button", { name: "File" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
	});

	test("switching to Text tab shows the textarea", async ({ page }) => {
		await page.getByRole("button", { name: "Text" }).click();
		await expect(page.locator("speeedy-textarea, textarea")).toBeVisible();
	});

	test("Begin Reading button is disabled with no text", async ({ page }) => {
		await page.getByRole("button", { name: "Text" }).click();
		const btn = page.getByRole("button", { name: /begin reading/i });
		await expect(btn).toBeDisabled();
	});

	test("Begin Reading enables after pasting text and navigates to reader", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Text" }).click();

		const textarea = page.locator("speeedy-textarea");
		await textarea.evaluate((el) => {
			el.dispatchEvent(
				new CustomEvent("change", {
					detail: { value: "Hello world. This is a test sentence for reading." },
					bubbles: true,
					composed: true,
				}),
			);
		});

		const nativeTextarea = page.locator("textarea").first();
		if (await nativeTextarea.isVisible()) {
			await nativeTextarea.fill(
				"Hello world. This is a test sentence for reading.",
			);
		}

		const btn = page.getByRole("button", { name: /begin reading/i });
		await expect(btn).toBeEnabled({ timeout: 3000 });
		await btn.click();
		await expect(page).toHaveURL(/#\/reader/, { timeout: 5000 });
	});

	test("demo text loads via Try a demo text button", async ({ page }) => {
		await page.getByRole("button", { name: "Text" }).click();
		const demoBtn = page.getByRole("button", { name: /try a demo text/i });
		if (await demoBtn.isVisible()) {
			await demoBtn.click();
			const btn = page.getByRole("button", { name: /begin reading/i });
			await expect(btn).toBeEnabled({ timeout: 3000 });
		}
	});

	test("has links to Stats and Profile in the nav", async ({ page }) => {
		await expect(page.getByRole("button", { name: /stats/i })).toBeVisible();
		await expect(
			page.getByRole("button", { name: /profile|reader/i }).first(),
		).toBeVisible();
	});
});
