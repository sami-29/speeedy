import { expect, type Page } from "@playwright/test";

/** The settings panel, opened from its button if it is closed. */
export async function settings(page: Page) {
	const panel = page.getByTestId("settings-panel");
	if (!(await panel.isVisible())) {
		await page.getByRole("button", { name: "Settings", exact: true }).click();
	}
	await expect(panel).toBeVisible();
	return panel;
}
