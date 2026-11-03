import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
	"/",
	"/pdf-speed-reader",
	"/epub-speed-reader",
	"/adhd-reading-tool",
	"/text-to-speech-reader",
	"/spreeder-alternative",
	"/learn",
	"/learn/how-to-read-faster",
	"/learn/what-is-rsvp",
	"/learn/average-reading-speed",
	"/reader",
	"/library",
	"/stats",
	"/training",
	"/s",
	"/account",
];
const viewports = [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
];

for (const viewport of viewports) {
	for (const route of routes) {
		test(`axe passes on ${route} at ${viewport.name}`, async ({ page }) => {
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await page.goto(route);
			await page.evaluate(() => document.fonts.ready);
			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();
			expect(results.violations).toEqual([]);
		});
	}
}

test("axe passes on the Night theme", async ({ page }) => {
	await page.goto("/reader");
	await page.getByRole("button", { name: "Night theme" }).click();
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations).toEqual([]);
});
