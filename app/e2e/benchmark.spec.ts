import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { BENCHMARK_PASSAGES } from "../src/lib/training/benchmark/passages.ts";
import { countWords } from "../src/lib/training/benchmark/score.ts";

const PATH = "/reading-speed-test";

const bodyText = (html: string) =>
	html
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<style[\s\S]*?<\/style>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ");

/**
 * Opens the page and freezes its clock once it has hydrated, so a minute of reading takes no
 * time and lasts exactly a minute. Axe needs real timers, so its test opens with `fake: false`.
 */
async function open(page: Page, { fake = true } = {}) {
	if (fake) await page.clock.install();
	await page.goto(PATH);
	await expect(page.getByTestId("benchmark")).toHaveAttribute(
		"data-ready",
		"true",
	);
	if (fake) await page.clock.pauseAt(new Date(Date.now() + 5_000));
}

/** The passage on screen, found by the first words of its text. */
async function shownPassage(page: Page) {
	const text =
		(await page.getByTestId("benchmark-passage").textContent())?.trim() ?? "";
	const found = BENCHMARK_PASSAGES.find((passage) =>
		text.startsWith(passage.text.slice(0, 40)),
	);
	if (!found) throw new Error("the passage on screen is not a built-in one");
	return found;
}

/** Reads for a minute, then answers: the first `right` questions rightly, the rest wrongly. */
async function takeTest(page: Page, right: number, minutes = 1) {
	await page.getByTestId("benchmark-start").click();
	const passage = await shownPassage(page);
	await page.clock.fastForward(minutes * 60_000);
	await page.getByTestId("benchmark-done").click();
	const questions = page.getByTestId("benchmark-question");
	await expect(questions).toHaveCount(10);
	for (let i = 0; i < 10; i++) {
		const fieldset = questions.nth(i);
		const asked = ((await fieldset.locator("legend").textContent()) ?? "")
			.replace(/^\d+\.\s*/, "")
			.trim();
		const known = passage.questions.find((q) => q.q === asked);
		if (!known) throw new Error(`unknown question: ${asked}`);
		const wanted =
			i < right
				? known.options[known.correct]
				: known.options.find((_, o) => o !== known.correct);
		await fieldset
			.locator("label", { hasText: wanted as string })
			.first()
			.click();
	}
	await page.getByTestId("benchmark-submit").click();
	return passage;
}

test.describe("/reading-speed-test prerender", () => {
	test("has its title, description, canonical and the average in the HTML", async ({
		request,
	}) => {
		const html = await (await request.get(PATH)).text();
		expect(html).toContain(
			"<title>Reading Speed Test with Comprehension, Free | Speeedy</title>",
		);
		expect(html).toContain(
			'content="Find your reading speed in WPM, then answer a few questions to check what you understood. Free, no account, and your results stay on your device."',
		);
		expect(html).toMatch(
			/<link rel="canonical" href="[^"]+\/reading-speed-test"/,
		);
		expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
		const body = bodyText(html);
		expect(body).toContain("238");
		expect(body).toContain("175 and 300");
		expect(body).toContain("rough screen");
		expect(body).toContain("Brysbaert");
		expect(html).toContain('data-testid="benchmark-start"');
	});

	test("does not put any passage or question in the HTML", async ({
		request,
	}) => {
		const html = await (await request.get(PATH)).text();
		for (const passage of BENCHMARK_PASSAGES) {
			expect(html).not.toContain(passage.text.slice(0, 40));
			expect(html).not.toContain(passage.title);
			expect(html).not.toContain(passage.questions[0]?.q ?? "no question");
		}
	});

	test("is in the sitemap and linked from the average reading speed article", async ({
		page,
		request,
	}) => {
		const sitemap = await (await request.get("/sitemap.xml")).text();
		expect(sitemap).toContain("/reading-speed-test");
		await page.goto("/learn/average-reading-speed");
		await page
			.getByRole("link", { name: "Take the reading speed test" })
			.click();
		await expect(page).toHaveURL(/\/reading-speed-test$/);
	});

	test("the 1.x #/benchmark link lands here and shows the test", async ({
		page,
	}) => {
		await page.goto("/#/benchmark");
		await expect(page).toHaveURL(/\/reading-speed-test$/);
		await expect(page.getByTestId("benchmark-start")).toBeVisible();
	});
});

test.describe("the Benchmark", () => {
	test("shows no passage until Start, then reads, asks ten questions and gives WPM and a score", async ({
		page,
	}) => {
		await open(page);
		await expect(page.getByTestId("benchmark-passage")).toHaveCount(0);
		await page.getByTestId("benchmark-start").click();
		await expect(page.getByTestId("benchmark-passage")).toBeVisible();
		await expect(page.getByTestId("benchmark-question")).toHaveCount(0);
		const passage = await shownPassage(page);
		await page.clock.fastForward(60_000);
		await page.getByTestId("benchmark-done").click();
		await expect(page.getByTestId("benchmark-passage")).toHaveCount(0);
		await expect(page.getByTestId("benchmark-submit")).toBeDisabled();
		await expect(page.getByTestId("benchmark-progress")).toHaveText(
			"0 of 10 answered",
		);
		const questions = page.getByTestId("benchmark-question");
		for (let i = 0; i < 10; i++) {
			await questions.nth(i).locator("input").first().check();
		}
		await expect(page.getByTestId("benchmark-progress")).toHaveText(
			"10 of 10 answered",
		);
		await expect(page.getByTestId("benchmark-submit")).toBeEnabled();
		await page.getByTestId("benchmark-submit").click();
		await expect(page.getByTestId("benchmark-wpm")).toHaveText(
			String(countWords(passage.text)),
		);
		await expect(page.getByTestId("benchmark-comprehension")).toBeVisible();
	});

	test("starts the timer on the press of Start, not on arrival", async ({
		page,
	}) => {
		await open(page);
		await page.clock.fastForward(5 * 60_000);
		const passage = await takeTest(page, 10);
		await expect(page.getByTestId("benchmark-wpm")).toHaveText(
			String(countWords(passage.text)),
		);
	});

	test("scores comprehension from the right answers, wherever the options are shown", async ({
		page,
	}) => {
		await open(page);
		await takeTest(page, 7);
		await expect(page.getByTestId("benchmark-comprehension")).toHaveText("70");
		await expect(page.getByTestId("benchmark-correct")).toHaveText(
			"7 of 10 right",
		);
		await expect(page.getByTestId("benchmark-standing")).toContainText(
			"175 to 300 WPM",
		);
	});

	test("saves each result as a Training result and shows the trend", async ({
		page,
	}) => {
		await open(page);
		await expect(page.getByTestId("benchmark-empty")).toBeVisible();
		const first = await takeTest(page, 8, 1);
		await expect(page.getByTestId("benchmark-saved")).toBeVisible();
		await expect(page.getByTestId("benchmark-row")).toHaveCount(1);
		await expect(page.getByTestId("benchmark-count")).toHaveText(
			"Tests on this device: 1",
		);

		await page.getByTestId("benchmark-again").click();
		await takeTest(page, 5, 2);
		await expect(page.getByTestId("benchmark-saved")).toBeVisible();
		await expect(page.getByTestId("benchmark-row")).toHaveCount(2);
		await expect(page.getByTestId("speed-point")).toHaveCount(2);
		// Newest first: the second test took twice as long, so it is the slower one.
		const rows = page.getByTestId("benchmark-row");
		const firstWpm = countWords(first.text);
		await expect(rows.nth(1)).toContainText(`${firstWpm}`);
		await expect(rows.nth(1)).toContainText("80%");
		await expect(rows.nth(0)).toContainText("50%");

		const stored = await page.evaluate(
			() =>
				new Promise<{ kind: string; scores: Record<string, number> }[]>(
					(resolve, reject) => {
						const open = indexedDB.open("speeedy-library");
						open.onerror = () => reject(open.error);
						open.onsuccess = () => {
							const all = open.result
								.transaction("trainingResults")
								.objectStore("trainingResults")
								.getAll();
							all.onsuccess = () => resolve(all.result);
							all.onerror = () => reject(all.error);
						};
					},
				),
		);
		expect(stored.map((each) => each.kind)).toEqual(["benchmark", "benchmark"]);
		expect(stored.map((each) => each.scores.comprehension).sort()).toEqual([
			50, 80,
		]);

		// The trend survives a reload: it is on the device, not in the page.
		await page.reload();
		await expect(page.getByTestId("benchmark-row")).toHaveCount(2);
	});

	test("sends no passage, answer or result to analytics", async ({ page }) => {
		const bodies: string[] = [];
		await page.route("**/api/**", async (route) => {
			bodies.push(route.request().postData() ?? "");
			await route.fulfill({ status: 204 });
		});
		await open(page);
		await takeTest(page, 7);
		await expect(page.getByTestId("benchmark-saved")).toBeVisible();
		const sent = bodies.join("\n");
		expect(sent).not.toMatch(/benchmark|comprehension|wpm|Challenger|sleep/i);
	});

	test("moves focus to each step's heading", async ({ page }) => {
		await open(page);
		await page.getByTestId("benchmark-start").click();
		await expect(
			page.getByRole("heading", { name: "Read the passage." }),
		).toBeFocused();
		await page.getByTestId("benchmark-done").click();
		await expect(
			page.getByRole("heading", { name: "Questions." }),
		).toBeFocused();
	});
});

test.describe("the Benchmark's page", () => {
	for (const width of [390, 1280]) {
		test(`passes axe and fits at ${width}px in every step`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 844 });
			await open(page, { fake: false });
			const check = async (label: string) => {
				const results = await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
					.analyze();
				expect(results.violations, label).toEqual([]);
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				expect(overflow, `${label} overflows`).toBeLessThanOrEqual(0);
			};
			await page.evaluate(() => document.fonts.ready);
			await check("intro");
			await page.getByTestId("benchmark-start").click();
			await check("reading");
			await page.getByTestId("benchmark-done").click();
			await check("questions");
			const questions = page.getByTestId("benchmark-question");
			for (let i = 0; i < 10; i++) {
				await questions.nth(i).locator("input").first().check();
			}
			await check("questions answered");
			await page.getByTestId("benchmark-submit").click();
			await expect(page.getByTestId("benchmark-saved")).toBeVisible();
			await check("results");
		});
	}
});
