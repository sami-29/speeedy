import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WORDS = Array.from({ length: 400 }, (_, i) => `word${i + 1}`);
const TEXT = WORDS.join(" ");

/** Local calendar dates, computed in the browser so they match the app's own. */
const dateKeys = (page: Page) =>
	page.evaluate(() => {
		const key = (back: number) => {
			const day = new Date();
			day.setDate(day.getDate() - back);
			const pad = (n: number) => String(n).padStart(2, "0");
			return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
		};
		return { today: key(0), yesterday: key(1) };
	});

/**
 * Puts Sessions straight into the Library's database, as if they had been read: 6 minutes
 * today and 2 minutes on each of the three days before (a 4-day Streak), then a gap and an
 * older 5-day run (best Streak 5). Speeds go from the study band up to skim.
 */
async function seed(page: Page) {
	await page.goto("/library");
	await expect(page.getByTestId("library-empty")).toBeVisible();
	await page.evaluate(async () => {
		const open = () =>
			new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("speeedy-library");
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		const db = await open();
		const pad = (n: number) => String(n).padStart(2, "0");
		const key = (back: number) => {
			const day = new Date();
			day.setDate(day.getDate() - back);
			return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
		};
		const rows: Record<string, unknown>[] = [];
		const add = (back: number, seconds: number, wpm: number) => {
			const started = new Date();
			started.setDate(started.getDate() - back);
			started.setHours(12, 0, 0, 0);
			rows.push({
				id: `seed-${rows.length}`,
				date: key(back),
				startedAt: started.getTime() + rows.length,
				activeMs: seconds * 1000,
				wordsRead: Math.round((seconds / 60) * wpm),
				wpm,
				documentId: null,
			});
		};
		for (const back of [10, 9, 8, 7, 6]) add(back, 120, 180);
		for (const back of [3, 2, 1]) add(back, 120, 260);
		add(0, 360, 420);
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("sessions", "readwrite");
			for (const row of rows) tx.objectStore("sessions").put(row);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	});
}

test.describe("the Library line", () => {
	test("shows today's minutes, the goal and the Streak", async ({ page }) => {
		await seed(page);
		await page.goto("/library");
		await expect(page.getByTestId("library-line")).toHaveText(
			"Today 6 / 10 min · 4-day streak",
		);
	});

	test("is calm for a reader who has not read yet", async ({ page }) => {
		await page.goto("/library");
		await expect(page.getByTestId("library-line")).toHaveText(
			"Today 0 / 10 min · No streak yet",
		);
	});

	test("can be hidden, stays hidden after a reload, and comes back from /stats", async ({
		page,
	}) => {
		await seed(page);
		await page.goto("/library");
		await page.getByRole("button", { name: "Hide progress line" }).click();
		await expect(page.getByTestId("library-line")).toHaveCount(0);
		await page.reload();
		await expect(page.getByTestId("library-empty")).toBeVisible();
		await expect(page.getByTestId("library-line")).toHaveCount(0);

		await page.goto("/stats");
		const toggle = page.getByRole("checkbox", {
			name: "Show the progress line in the Library",
		});
		await expect(toggle).not.toBeChecked();
		await toggle.check();
		await page.goto("/library");
		await expect(page.getByTestId("library-line")).toBeVisible();
	});
});

test.describe("/stats", () => {
	test("shows today, the Streak with its best, and totals", async ({
		page,
	}) => {
		await seed(page);
		await page.goto("/stats");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stats.");
		await expect(page.getByTestId("stats-today-minutes")).toHaveText("6");
		await expect(page.getByTestId("stats-goal")).toHaveText("10");
		await expect(page.getByTestId("stats-current-streak")).toHaveText("4");
		await expect(page.getByTestId("stats-best-streak")).toHaveText("5");
	});

	test("draws the speed chart over the Study, Read and Skim bands", async ({
		page,
	}) => {
		await seed(page);
		await page.goto("/stats");
		const chart = page.getByTestId("speed-chart");
		await expect(chart).toBeVisible();
		for (const band of ["Study", "Read", "Skim"]) {
			await expect(chart).toContainText(band);
		}
		await expect(page.getByTestId("speed-point")).toHaveCount(9);
		await expect(page.getByTestId("session-row")).toHaveCount(9);
	});

	test("keeps the goal a past day had when the goal changes", async ({
		page,
	}) => {
		await seed(page);
		const { today, yesterday } = await dateKeys(page);
		await page.goto("/stats");
		await page.getByLabel("Daily Goal (minutes)").fill("20");
		await page.getByRole("button", { name: "Save goal" }).click();
		await expect(page.getByTestId("stats-goal")).toHaveText("20");
		await expect(page.getByTestId(`goal-${today}`)).toHaveText("20");
		await expect(page.getByTestId(`goal-${yesterday}`)).toHaveText("10");
		await page.reload();
		await expect(page.getByTestId("stats-goal")).toHaveText("20");
		await expect(page.getByTestId(`goal-${yesterday}`)).toHaveText("10");
	});

	test("says there is nothing yet when there are no Sessions", async ({
		page,
	}) => {
		await page.goto("/stats");
		await expect(page.getByTestId("stats-empty")).toBeVisible();
		await expect(page.getByTestId("speed-point")).toHaveCount(0);
	});

	for (const viewport of [
		{ name: "390px", width: 390, height: 844 },
		{ name: "desktop", width: 1280, height: 800 },
	]) {
		test(`axe passes with data at ${viewport.name}`, async ({ page }) => {
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await seed(page);
			await page.goto("/stats");
			await expect(page.getByTestId("speed-chart")).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();
			expect(results.violations).toEqual([]);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}
});

test.describe("reading", () => {
	test("leaves a Session behind that /stats lists", async ({ page }) => {
		await page.goto("/reader");
		await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page.getByTestId("word")).not.toHaveText("word1", {
			timeout: 4000,
		});
		await page.getByRole("button", { name: "New text" }).click();
		await page.goto("/stats");
		await expect(page.getByTestId("session-row")).toHaveCount(1);
		await expect(page.getByTestId("stats-today-minutes")).toHaveText("0");
	});

	test("never asks for notification permission", async ({ page }) => {
		await page.addInitScript(() => {
			const w = window as unknown as { __asked: number };
			w.__asked = 0;
			if ("Notification" in window) {
				Notification.requestPermission = () => {
					w.__asked += 1;
					return Promise.resolve("denied");
				};
			}
		});
		await seed(page);
		for (const route of ["/library", "/stats", "/reader"]) {
			await page.goto(route);
			await page.waitForLoadState("networkidle");
		}
		const asked = await page.evaluate(
			() => (window as unknown as { __asked: number }).__asked,
		);
		expect(asked).toBe(0);
	});
});
