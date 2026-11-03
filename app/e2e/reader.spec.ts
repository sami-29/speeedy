import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Long enough that a slow runner cannot reach the end before a test pauses.
const TEXT =
	`one two three four five six seven eight nine ten eleven twelve ${"more ".repeat(60)}`.trim();
const WORDS = TEXT.split(" ");

async function start(page: Page, text: string) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
}

test.describe("paste to read", () => {
	test("paste, Start, read at 250 WPM, pause on a word", async ({ page }) => {
		await start(page, TEXT);
		const word = page.getByTestId("word");
		await expect(word).toHaveText(/\S/);
		await expect(page.getByTestId("wpm")).toHaveText("250 WPM");

		// Playwright polls, so wait for any later word rather than one exact word.
		await expect(word).toHaveText(/^(three|four|five|six|seven|eight)$/, {
			timeout: 4000,
		});
		await page.getByRole("button", { name: "Pause" }).click();
		const paused = (await word.textContent()) ?? "";
		expect(WORDS.indexOf(paused)).toBeGreaterThanOrEqual(2);

		// Paused means paused: the word holds still.
		await page.waitForTimeout(700);
		await expect(word).toHaveText(paused);

		await page.getByRole("button", { name: "Play" }).click();
		await expect(word).not.toHaveText(paused, { timeout: 2000 });
	});

	test("words arrive in order, none skipped, from the first", async ({
		page,
	}) => {
		// Recorded in the page from before Start, so polling cannot miss a word.
		await page.addInitScript(() => {
			const seen: string[] = [];
			(window as unknown as { __words: string[] }).__words = seen;
			new MutationObserver(() => {
				const text =
					document.querySelector('[data-testid="word"]')?.textContent ?? "";
				if (text && text !== seen[seen.length - 1]) seen.push(text);
			}).observe(document, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		});
		await start(page, TEXT);
		await page.waitForTimeout(1000);
		const seen = await page.evaluate(
			() => (window as unknown as { __words: string[] }).__words,
		);
		expect(seen.slice(0, 3)).toEqual(["one", "two", "three"]);
	});

	test("Start with nothing pasted asks for text and stays on the panel", async ({
		page,
	}) => {
		await page.goto("/reader");
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page.getByRole("alert")).toContainText("Paste some text");
		await expect(page.getByTestId("word")).toHaveCount(0);
	});

	test("Space on the focused Pause button pauses and plays", async ({
		page,
	}) => {
		await start(page, TEXT);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await expect(page.getByRole("button", { name: "Pause" })).toBeFocused();
		await page.keyboard.press("Space");
		await expect(page.getByRole("button", { name: "Play" })).toBeFocused();
	});
});

test.describe("drop to read", () => {
	test("dropping a TXT opens it and plays", async ({ page }) => {
		await page.goto("/reader");
		const data = await page.evaluateHandle(() => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(["alpha beta gamma delta epsilon zeta"], "notes.txt", {
					type: "text/plain",
				}),
			);
			return transfer;
		});
		await page.getByTestId("start-panel").dispatchEvent("drop", {
			dataTransfer: data,
		});
		await expect(page.getByTestId("word")).toHaveText("alpha");
		await expect(page.getByTestId("word")).toHaveText("beta", {
			timeout: 3000,
		});
	});

	test("choosing a TXT with the file picker does the same", async ({
		page,
	}) => {
		await page.goto("/reader");
		await page.getByLabel("Choose a file").setInputFiles({
			name: "notes.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("alpha beta gamma delta"),
		});
		await expect(page.getByTestId("word")).toHaveText("alpha");
	});
});

test.describe("the word", () => {
	test("sits on the red axis at 35% with its ORP letter aligned", async ({
		page,
	}) => {
		await start(page, "extraordinarily");
		const word = page.getByTestId("word");
		await expect(word).toHaveText("extraordinarily");
		const pivot = word.locator('[data-part="pivot"]');
		await expect(pivot).toHaveText(/^\S$/);
		const stage = (await page.getByTestId("stage").boundingBox()) as {
			x: number;
			width: number;
		};
		const box = (await pivot.boundingBox()) as { x: number; width: number };
		const axisCentre = stage.x + stage.width * 0.35 + 1.5;
		expect(Math.abs(box.x + box.width / 2 - axisCentre)).toBeLessThanOrEqual(
			1.5,
		);
	});

	test("the page axis is 3px at 35% on desktop", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await start(page, "extraordinarily");
		const axis = await page.evaluate(() => {
			const main = document.querySelector("main") as HTMLElement;
			const style = getComputedStyle(main, "::before");
			return {
				left: Number.parseFloat(style.left),
				width: Number.parseFloat(style.width),
				main: main.getBoundingClientRect().width,
			};
		});
		expect(axis.width).toBe(3);
		expect(Math.abs(axis.left - axis.main * 0.35)).toBeLessThanOrEqual(1);
	});

	test("cuts between words: no fade, no slide", async ({ page }) => {
		await start(page, TEXT);
		const word = page.getByTestId("word");
		await expect(word).toHaveText(/\S/);
		const motion = await word.evaluate((el) => {
			const out: { transition: string; animation: string; opacity: string }[] =
				[];
			for (
				let node: Element | null = el;
				node && node.tagName !== "BODY";
				node = node.parentElement
			) {
				const style = getComputedStyle(node);
				out.push({
					transition: style.transitionDuration,
					animation: style.animationName,
					opacity: style.opacity,
				});
			}
			return out;
		});
		for (const m of motion) {
			expect(m).toEqual({ transition: "0s", animation: "none", opacity: "1" });
		}
	});

	test("playing writes only the word element", async ({ page }) => {
		await start(page, TEXT);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		const result = await page.evaluate(
			() =>
				new Promise<{ outside: number; inside: number }>((resolve) => {
					const word = document.querySelector('[data-testid="word"]') as Node;
					// The progress chart is the one other thing that moves while reading: its red
					// mark and bars are written straight from the same frame events, too.
					const chart = document.querySelector(
						'[data-testid="progress-chart"]',
					) as Node;
					let outside = 0;
					let inside = 0;
					const observer = new MutationObserver((records) => {
						for (const record of records) {
							if (word.contains(record.target)) inside++;
							else if (!chart.contains(record.target)) outside++;
						}
					});
					observer.observe(document.querySelector("main") as Node, {
						subtree: true,
						childList: true,
						characterData: true,
						attributes: true,
					});
					setTimeout(() => {
						observer.disconnect();
						resolve({ outside, inside });
					}, 900);
				}),
		);
		expect(result.inside).toBeGreaterThan(0);
		expect(result.outside).toBe(0);
	});
});

test.describe("off the main thread", () => {
	test("parsing and the first Timeline run in workers", async ({ page }) => {
		let workers = 0;
		page.on("worker", () => workers++);
		await start(page, TEXT);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		expect(workers).toBeGreaterThanOrEqual(2);
	});
});

for (const viewport of [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
]) {
	test(`axe passes on a paused reader at ${viewport.name}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await start(page, TEXT);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await page.getByRole("button", { name: "Pause" }).click();
		await page.evaluate(() => document.fonts.ready);
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
			.analyze();
		expect(results.violations).toEqual([]);
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
}
