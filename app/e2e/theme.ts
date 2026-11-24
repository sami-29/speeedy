import type { Page } from "@playwright/test";

/** Opens the header's Theme menu, picks a theme and/or light or dark, and closes it. */
export async function chooseTheme(
	page: Page,
	choice: {
		theme?: "Paper" | "Classic" | "Cozy";
		appearance?: "Match system" | "Light" | "Dark";
	},
): Promise<void> {
	const toggle = page.getByRole("button", { name: "Theme", exact: true });
	await toggle.click();
	if (choice.theme) {
		await page.getByRole("radio", { name: choice.theme, exact: true }).check();
	}
	if (choice.appearance) {
		await page
			.getByRole("radio", { name: choice.appearance, exact: true })
			.check();
	}
	await toggle.click();
}
