import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Three chapters of three paragraphs of three sentences of three words. A word like `c2p3s1b`
// says where it is: chapter 2, paragraph 3, sentence 1, second word. A sentence ends on the
// word `c`. The chapter titles are single words, so a chapter starts on one Frame.
const TITLES = ["Alpha", "Beta", "Gamma"];

function makeBook(titles: readonly string[] = TITLES): string {
	return titles
		.map((title, c) => {
			const paragraphs = [1, 2, 3].map((p) =>
				[1, 2, 3]
					.map((s) => {
						const id = `c${c + 1}p${p}s${s}`;
						return `${id}a ${id}b ${id}c.`;
					})
					.join(" "),
			);
			return `# ${title}\n\n${paragraphs.join("\n\n")}`;
		})
		.join("\n\n");
}

const BOOK = makeBook();
const LAST_WORD = "c3p3s3c.";

const word = (page: Page) => page.getByTestId("word");
const progress = (page: Page) =>
	page.getByRole("slider", { name: "Reading progress" });
const chart = (page: Page) => page.getByTestId("progress-chart");

/** Opens a Markdown file in the reader, so its headings are chapters, and pauses it. */
async function openBook(page: Page, book: string = BOOK) {
	await page.goto("/reader");
	await page.getByLabel("Choose a file").setInputFiles({
		name: "book.md",
		mimeType: "text/markdown",
		buffer: Buffer.from(book),
	});
	await expect(word(page)).toHaveText(/\S/);
	await page.getByRole("button", { name: "Pause" }).click();
}

/** Takes the focus off every control, so keys go to the page. */
const focusPage = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** Puts the reader on the last word, paused, with the focus on the page. */
async function goToEnd(page: Page) {
	await progress(page).focus();
	await page.keyboard.press("End");
	await expect(word(page)).toHaveText(LAST_WORD);
	await focusPage(page);
}

test.describe("rewind", () => {
	test("keys go back by sentence, paragraph and chapter", async ({ page }) => {
		await openBook(page);
		await goToEnd(page);

		// Sentence: to the start of this one, then the one before.
		await page.keyboard.press("ArrowLeft");
		await expect(word(page)).toHaveText("c3p3s3a");
		await page.keyboard.press("ArrowLeft");
		await expect(word(page)).toHaveText("c3p3s2a");

		// Paragraph: to the start of this one, then the one before.
		await page.keyboard.press("Shift+ArrowLeft");
		await expect(word(page)).toHaveText("c3p3s1a");
		await page.keyboard.press("Shift+ArrowLeft");
		await expect(word(page)).toHaveText("c3p2s1a");

		// Chapter: to the start of this one, then each one before, and no further than the first.
		await page.keyboard.press("c");
		await expect(word(page)).toHaveText("Gamma");
		await page.keyboard.press("c");
		await expect(word(page)).toHaveText("Beta");
		await page.keyboard.press("c");
		await expect(word(page)).toHaveText("Alpha");
		await page.keyboard.press("c");
		await expect(word(page)).toHaveText("Alpha");
	});

	test("buttons do the same", async ({ page }) => {
		await openBook(page);
		await goToEnd(page);
		const rewind = page.getByRole("group", { name: "Rewind" });
		await expect(rewind.getByRole("button")).toHaveText([
			/Sentence/,
			/Paragraph/,
			/Chapter/,
		]);

		await rewind.getByRole("button", { name: "Back one sentence" }).click();
		await expect(word(page)).toHaveText("c3p3s3a");
		await rewind.getByRole("button", { name: "Back one paragraph" }).click();
		await expect(word(page)).toHaveText("c3p3s1a");
		await rewind.getByRole("button", { name: "Back one paragraph" }).click();
		await expect(word(page)).toHaveText("c3p2s1a");
		await rewind.getByRole("button", { name: "Back one chapter" }).click();
		await expect(word(page)).toHaveText("Gamma");
		await rewind.getByRole("button", { name: "Back one chapter" }).click();
		await expect(word(page)).toHaveText("Beta");
	});

	test("are discoverable: named by the shortcut list and by the buttons' key hints", async ({
		page,
	}) => {
		await openBook(page);
		const rewind = page.getByRole("group", { name: "Rewind" });
		await expect(
			rewind.getByRole("button", { name: "Back one sentence" }),
		).toHaveAttribute("aria-keyshortcuts", "ArrowLeft");
		await expect(
			rewind.getByRole("button", { name: "Back one paragraph" }),
		).toHaveAttribute("aria-keyshortcuts", "Shift+ArrowLeft");
		await expect(
			rewind.getByRole("button", { name: "Back one chapter" }),
		).toHaveAttribute("aria-keyshortcuts", "C");

		await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
		const list = page.getByRole("list", { name: "Keyboard shortcuts" });
		await expect(list).toContainText("Back one sentence");
		await expect(list).toContainText("Back one paragraph");
		await expect(list).toContainText("Back one chapter");
	});

	test("a rewind while playing keeps playing", async ({ page }) => {
		await openBook(page);
		await page.getByRole("button", { name: "Chapters", exact: true }).click();
		await page.getByRole("button", { name: "Gamma", exact: true }).click();
		await page.getByRole("button", { name: "Play" }).click();
		await page.getByRole("button", { name: "Back one chapter" }).click();
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		await expect(word(page)).toHaveText(/^(Beta|c2|Gamma|c3)/);
		const here = (await word(page).textContent()) ?? "";
		await expect(word(page)).not.toHaveText(here, { timeout: 3000 });
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
	});

	test("a text with no headings has no chapters to go back to", async ({
		page,
	}) => {
		await openBook(page, "one two three. four five six. seven eight nine.");
		await progress(page).focus();
		await page.keyboard.press("End");
		await expect(word(page)).toHaveText("nine.");
		await expect(
			page.getByRole("button", { name: "Back one chapter" }),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Chapters", exact: true }),
		).toHaveCount(0);
		await focusPage(page);
		await page.keyboard.press("c");
		await expect(word(page)).toHaveText("nine.");
	});
});

test.describe("the progress bar", () => {
	test("is an ARIA slider that says how far, and where", async ({ page }) => {
		await openBook(page);
		const bar = progress(page);
		await expect(bar).toHaveAttribute("aria-valuemin", "0");
		await expect(bar).toHaveAttribute("aria-valuemax", "100");
		await bar.focus();
		await page.keyboard.press("End");
		await expect(bar).toHaveAttribute("aria-valuenow", "100");
		await expect(bar).toHaveAttribute("aria-valuetext", /100%.*Gamma/);
		await page.keyboard.press("Home");
		await expect(bar).toHaveAttribute("aria-valuenow", "0");
		await expect(bar).toHaveAttribute("aria-valuetext", /0%.*Alpha/);
	});

	test("seeks by keyboard: arrows 1%, Shift and Page keys 10%, Home and End", async ({
		page,
	}) => {
		await openBook(page);
		const bar = progress(page);
		await bar.focus();
		await page.keyboard.press("Home");
		await expect(word(page)).toHaveText("Alpha");
		await page.keyboard.press("ArrowRight");
		await expect(bar).toHaveAttribute("aria-valuenow", "1");
		await page.keyboard.press("ArrowUp");
		await expect(bar).toHaveAttribute("aria-valuenow", "2");
		await page.keyboard.press("Shift+ArrowRight");
		await expect(bar).toHaveAttribute("aria-valuenow", "12");
		await page.keyboard.press("PageUp");
		await expect(bar).toHaveAttribute("aria-valuenow", "22");
		await expect(word(page)).toHaveText(/^c1p/);
		await page.keyboard.press("PageUp");
		await page.keyboard.press("PageUp");
		await expect(bar).toHaveAttribute("aria-valuenow", "42");
		await expect(word(page)).toHaveText(/^c2p/);
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("PageDown");
		await expect(bar).toHaveAttribute("aria-valuenow", "31");
		await page.keyboard.press("End");
		await expect(bar).toHaveAttribute("aria-valuenow", "100");
		await expect(word(page)).toHaveText(LAST_WORD);
	});

	test("its arrows move the bar, not the sentence", async ({ page }) => {
		await openBook(page);
		await progress(page).focus();
		await page.keyboard.press("End");
		await page.keyboard.press("ArrowLeft");
		await expect(progress(page)).toHaveAttribute("aria-valuenow", "99");
		await expect(word(page)).not.toHaveText("c3p3s3a");
	});

	test("seeks by dragging, and a press on the bar jumps there", async ({
		page,
	}) => {
		await openBook(page);
		const bar = progress(page);
		await bar.scrollIntoViewIfNeeded();
		const box = (await bar.boundingBox()) as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		const y = box.y + box.height / 2;
		const at = (share: number) => box.x + box.width * share;

		await page.mouse.move(at(0.5), y);
		await page.mouse.down();
		await expect(bar).toHaveAttribute("aria-valuenow", /^(49|50|51)$/);
		await expect(word(page)).toHaveText(/^c2p/);

		await page.mouse.move(at(0.1), y, { steps: 6 });
		await expect(bar).toHaveAttribute("aria-valuenow", /^(9|10|11)$/);
		await expect(word(page)).toHaveText(/^c1p/);
		await page.mouse.up();

		// Letting go stays put, and a drag past either end stops at the end.
		await expect(word(page)).toHaveText(/^c1p/);
		await page.mouse.move(at(0.9), y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width + 120, y, { steps: 4 });
		await page.mouse.up();
		await expect(bar).toHaveAttribute("aria-valuenow", "100");
		await expect(word(page)).toHaveText(LAST_WORD);
	});

	test("the red mark follows the reading position, and the page does not scroll sideways", async ({
		page,
	}) => {
		await openBook(page);
		const mark = page.getByTestId("playhead");
		await progress(page).focus();
		await page.keyboard.press("Home");
		const start = (await mark.boundingBox()) as { x: number };
		await page.keyboard.press("End");
		await expect(word(page)).toHaveText(LAST_WORD);
		const end = (await mark.boundingBox()) as { x: number };
		expect(end.x).toBeGreaterThan(start.x + 100);
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test("a seek is kept: a refresh resumes where the reader jumped to", async ({
		page,
	}) => {
		await openBook(page);
		await page.getByRole("button", { name: "Chapters", exact: true }).click();
		await page.getByRole("button", { name: "Beta", exact: true }).click();
		await expect(word(page)).toHaveText("Beta");
		await page.reload();
		await expect(word(page)).toHaveText(/\S/);
		await page.getByRole("button", { name: "Pause" }).click();
		await expect(word(page)).toHaveText(/^(Beta|c2p)/);
	});
});

test.describe("the chapter list", () => {
	test("is a labelled list of the headings, behind a button", async ({
		page,
	}) => {
		await openBook(page);
		const toggle = page.getByRole("button", { name: "Chapters", exact: true });
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		const list = page.getByRole("list", { name: "Chapters" });
		await expect(list).toBeHidden();
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await expect(list).toBeVisible();
		await expect(list.getByRole("listitem")).toHaveCount(3);
		await expect(list.getByRole("button")).toHaveText(TITLES);
	});

	test("jumps to a chapter, and marks the chapter the reader is in", async ({
		page,
	}) => {
		await openBook(page);
		await page.getByRole("button", { name: "Chapters", exact: true }).click();
		const list = page.getByRole("list", { name: "Chapters" });
		await expect(list.getByRole("button", { name: "Alpha" })).toHaveAttribute(
			"aria-current",
			"true",
		);

		await list.getByRole("button", { name: "Beta" }).click();
		await expect(word(page)).toHaveText("Beta");
		await expect(list.getByRole("button", { name: "Beta" })).toHaveAttribute(
			"aria-current",
			"true",
		);
		await expect(
			list.getByRole("button", { name: "Alpha" }),
		).not.toHaveAttribute("aria-current", "true");
		await expect(progress(page)).toHaveAttribute("aria-valuetext", /Beta/);

		await list.getByRole("button", { name: "Gamma" }).click();
		await expect(word(page)).toHaveText("Gamma");
		// Back one chapter from the start of Gamma is Beta, and the list follows.
		await page.getByRole("button", { name: "Back one chapter" }).click();
		await expect(word(page)).toHaveText("Beta");
		await expect(list.getByRole("button", { name: "Beta" })).toHaveAttribute(
			"aria-current",
			"true",
		);
	});

	test("is keyboard operable", async ({ page }) => {
		await openBook(page);
		const toggle = page.getByRole("button", { name: "Chapters", exact: true });
		await toggle.focus();
		await page.keyboard.press("Enter");
		await page.keyboard.press("Tab");
		await page.keyboard.press("Tab");
		await page.keyboard.press("Enter");
		await expect(word(page)).toHaveText("Beta");
	});
});

test.describe("the speed chart", () => {
	test("sits over the Speed Zone bands", async ({ page }) => {
		await openBook(page);
		const bands = chart(page);
		await expect(bands.getByText("Study", { exact: true })).toBeVisible();
		await expect(bands.getByText("Read", { exact: true })).toBeVisible();
		await expect(bands.getByText("Skim", { exact: true })).toBeVisible();
	});

	test("draws the speed each stretch was read at, taller and in the Skim band when faster", async ({
		page,
	}) => {
		await openBook(page);
		await progress(page).focus();
		await page.keyboard.press("Home");
		await page.getByRole("button", { name: "Play" }).click();
		const bars = chart(page).getByTestId("trace-bar");
		await expect
			.poll(() => bars.count(), { timeout: 10_000 })
			.toBeGreaterThanOrEqual(2);
		await expect(bars.first()).toHaveAttribute("data-band", "read");
		await expect(bars.first()).toHaveAttribute("data-wpm", "250");

		await page
			.getByRole("group", { name: "Speed Zones" })
			.getByRole("button", { name: /Skim/ })
			.click();
		const fast = chart(page).locator(
			'[data-testid="trace-bar"][data-band="skim"]',
		);
		await expect(fast.first()).toBeVisible({ timeout: 10_000 });
		await expect(fast.first()).toHaveAttribute("data-wpm", "400");
		await page.getByRole("button", { name: "Pause" }).click();

		const slowBox = (await bars.first().boundingBox()) as { height: number };
		const fastBox = (await fast.first().boundingBox()) as { height: number };
		expect(fastBox.height).toBeGreaterThan(slowBox.height);
	});

	test("keeps red for the reading position: the bars are not red", async ({
		page,
	}) => {
		await openBook(page);
		await page.getByRole("button", { name: "Play" }).click();
		const bar = chart(page).getByTestId("trace-bar").first();
		await expect(bar).toBeVisible({ timeout: 10_000 });
		await page.getByRole("button", { name: "Pause" }).click();
		const colours = await page.evaluate(() => {
			const bar = document.querySelector('[data-testid="trace-bar"]');
			const mark = document.querySelector('[data-testid="playhead"]');
			return {
				bar: bar && getComputedStyle(bar).backgroundColor,
				mark: mark && getComputedStyle(mark).backgroundColor,
			};
		});
		expect(colours.bar).toBeTruthy();
		expect(colours.mark).toBeTruthy();
		expect(colours.bar).not.toBe(colours.mark);
	});
});

test.describe("motion and dimming", () => {
	test("the progress bar does not animate with reduced motion", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await openBook(page);
		const durations = await page.evaluate(() =>
			["playhead", "progress-chart"].map(
				(id) =>
					getComputedStyle(
						document.querySelector(`[data-testid="${id}"]`) as Element,
					).transitionDuration,
			),
		);
		for (const duration of durations) {
			for (const part of duration.split(",")) {
				expect(Number.parseFloat(part)).toBeLessThan(0.001);
			}
		}
	});

	test("the progress bar dims with the controls while reading", async ({
		page,
	}) => {
		await openBook(page);
		// Setting a file never touched the pointer, so the Play button still shows its
		// keyboard focus ring, and that keeps the controls lit. Take the focus off it first.
		await focusPage(page);
		await page.keyboard.press("k");
		await page.getByTestId("stage").hover();
		await expect(page.getByTestId("controls")).toHaveCSS("opacity", "0.35");
		await expect(
			page.getByTestId("controls").getByRole("slider", {
				name: "Reading progress",
			}),
		).toBeAttached();
	});
});

for (const viewport of [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
]) {
	test.describe(`axe on navigation at ${viewport.name}`, () => {
		test.beforeEach(async ({ page }) => {
			await page.setViewportSize(viewport);
		});

		const check = async (page: Page) => {
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
		};

		test("with the progress chart and the chapter list open", async ({
			page,
		}) => {
			await openBook(page);
			await page.getByRole("button", { name: "Chapters", exact: true }).click();
			await check(page);
		});

		test("with speeds drawn in the chart", async ({ page }) => {
			await openBook(page);
			await page.getByRole("button", { name: "Play" }).click();
			await expect(chart(page).getByTestId("trace-bar").first()).toBeVisible({
				timeout: 10_000,
			});
			await page.getByRole("button", { name: "Pause" }).click();
			await check(page);
		});

		test("in the Night theme", async ({ page }) => {
			await openBook(page);
			await page.getByRole("button", { name: "Night theme" }).click();
			await page.getByRole("button", { name: "Chapters", exact: true }).click();
			await check(page);
		});
	});
}

test.describe("privacy", () => {
	const CANARIES = ["Zanzibarquokka", "Marmaladexylograph", "Pterodactylwhisk"];

	test("no word of the document reaches any request while the reader navigates", async ({
		page,
	}) => {
		const seen: { url: string; body: string; headers: string }[] = [];
		page.on("request", (request) => {
			seen.push({
				url: request.url(),
				body: request.postData() ?? "",
				headers: JSON.stringify(request.headers()),
			});
		});
		await page.route("**/api/e", (route) => route.fulfill({ status: 204 }));

		await openBook(page, makeBook(CANARIES));
		// Chapter list, key seeks, a drag, every rewind, and the chart.
		await page.getByRole("button", { name: "Chapters", exact: true }).click();
		await page
			.getByRole("list", { name: "Chapters" })
			.getByRole("button", { name: CANARIES[1] as string })
			.click();
		await progress(page).focus();
		await page.keyboard.press("PageUp");
		await page.keyboard.press("End");
		const box = (await progress(page).boundingBox()) as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, {
			steps: 5,
		});
		await page.mouse.up();
		await focusPage(page);
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Shift+ArrowLeft");
		await page.keyboard.press("c");
		await page.getByRole("button", { name: "Play" }).click();
		await page.waitForTimeout(1500);
		await page.getByRole("button", { name: "Pause" }).click();
		// Leave the reader, so any queued batch is sent, then give timers time to fire.
		await page.getByRole("link", { name: "Library" }).click();
		await expect(page).toHaveURL(/\/library$/);
		await page.waitForTimeout(2800);

		const events = seen.filter((request) => request.url.endsWith("/api/e"));
		expect(events.length).toBeGreaterThan(0);
		const everything = (request: (typeof seen)[number]) =>
			`${request.url}\n${request.body}\n${request.headers}`.toLowerCase();
		for (const canary of CANARIES) {
			for (const request of seen) {
				expect(everything(request)).not.toContain(canary.toLowerCase());
			}
		}
		for (const request of events) {
			expect(request.body).not.toMatch(/\bc\d+p\d+s\d+/);
		}
	});
});
