import AxeBuilder from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";

const routes = [
	{ path: "/", name: "landing", ready: "marketing-page" },
	{ path: "/#/app", name: "app", ready: "app-page" },
	{ path: "/#/learn", name: "learn", ready: "learn-page" },
	{ path: "/#/stats", name: "stats", ready: "stats-dashboard" },
	{ path: "/#/profile", name: "profile", ready: "profile-page" },
	{ path: "/#/benchmark", name: "benchmark", ready: "benchmark-test" },
	{ path: "/#/donate", name: "donate", ready: "donate-page" },
	{ path: "/#/promote", name: "promote", ready: "promote-page" },
	{ path: "/#/changelog", name: "changelog", ready: "changelog-page" },
	{ path: "/#/privacy", name: "privacy", ready: "legal-page" },
	{ path: "/#/terms", name: "terms", ready: "legal-page" },
	{ path: "/#/share/e2e-a11y", name: "share", ready: "share-view" },
	{ path: "/#/reader", name: "reader", ready: "rsvp-reader" },
] as const;

/** Unhide [data-reveal] / [data-tip-item] for axe (they start at opacity 0). */
async function revealAllForA11y(page: Page): Promise<void> {
	await page.evaluate(() => {
		document.querySelectorAll<HTMLElement>("[data-reveal], [data-tip-item]").forEach((el) => {
			el.style.opacity = "1";
			el.style.transform = "none";
		});
	});
}

test.describe("a11y (axe)", () => {
	test("no serious, critical, or moderate violations on key routes", async ({ page }) => {
		for (const { path, name, ready } of routes) {
			await test.step(name, async () => {
				await page.goto(path, { waitUntil: "load" });
				await page.locator(ready).waitFor({ state: "visible", timeout: 15_000 });
				await revealAllForA11y(page);

				const results = await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag22aa"])
					.analyze();

				const severe = results.violations.filter((v) =>
					["serious", "critical", "moderate"].includes(v.impact ?? ""),
				);
				const summary =
					severe.length > 0
						? severe
								.map(
									(v) =>
										`${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.html).slice(0, 12).join("\n  ")}${v.nodes.length > 12 ? `\n  … +${v.nodes.length - 12} more` : ""}`,
								)
								.join("\n\n")
						: "";
				if (summary) console.error(summary);
				if (severe.length > 0) {
					throw new Error(
						`${severe.length} axe serious/critical/moderate violation(s) on "${name}"\n${summary}`,
					);
				}
			});
		}
	});
});
