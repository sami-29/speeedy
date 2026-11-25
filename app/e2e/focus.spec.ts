import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// "s7a s7b s7c." The number is the sentence and the letter the place inside it.
const TEXT = Array.from(
	{ length: 150 },
	(_, i) => `s${i + 1}a s${i + 1}b s${i + 1}c.`,
).join(" ");

const word = (page: Page) => page.getByTestId("word");
const controls = (page: Page) => page.getByTestId("controls");
const modeButton = (page: Page, name: string) =>
	page
		.getByRole("group", { name: "Reading Mode" })
		.getByRole("button", { name, exact: true });

async function start(page: Page) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(word(page)).toHaveText(/\S/);
}

async function pause(page: Page) {
	await page.getByRole("button", { name: "Pause" }).click();
	await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
}

/** Only the reading surface is on screen: no header, controls or mode switch. */
async function expectFocused(page: Page) {
	await expect(page.locator("html")).toHaveAttribute("data-focus", "on");
	await expect(page.locator("header")).toBeHidden();
	await expect(controls(page)).toBeHidden();
	await expect(page.getByRole("group", { name: "Reading Mode" })).toBeHidden();
	await expect(page.getByTestId("wpm")).toBeHidden();
	await expect(page.getByRole("button", { name: /Back one/ })).toHaveCount(0);
}

async function expectChrome(page: Page) {
	await expect(page.locator("html")).not.toHaveAttribute("data-focus", "on");
	await expect(page.locator("header")).toBeVisible();
	await expect(controls(page)).toBeVisible();
	await expect(page.getByRole("group", { name: "Reading Mode" })).toBeVisible();
}

async function pageScroll(page: Page) {
	return page.evaluate(() => ({
		down:
			document.documentElement.scrollHeight -
			document.documentElement.clientHeight,
		across:
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	}));
}

test.describe("focus state", () => {
	test("the button, F and Escape enter and leave it; only the word stays", async ({
		page,
	}) => {
		await start(page);
		await pause(page);

		await page.getByRole("button", { name: "Focus", exact: true }).click();
		await expectFocused(page);
		await expect(word(page)).toBeVisible();

		await page.keyboard.press("Escape");
		await expectChrome(page);

		await page.keyboard.press("f");
		await expectFocused(page);
		await page.keyboard.press("F");
		await expectChrome(page);
	});

	test("Pause and a tap bring the controls back; a tap does not pause", async ({
		page,
	}) => {
		await start(page);
		await page.keyboard.press("f");
		await expectFocused(page);
		await page.keyboard.press(" ");
		await expectChrome(page);
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

		await page.keyboard.press(" ");
		await page.keyboard.press("f");
		await expectFocused(page);
		await page.mouse.click(10, 10);
		await expectChrome(page);
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
	});

	test("Play enters it when the reader turns that on, and the choice is remembered", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		const choice = page.getByRole("checkbox", {
			name: "Focus when I press Play",
		});
		await expect(choice).not.toBeChecked();
		await choice.check();

		await page.getByRole("button", { name: "Play" }).click();
		await expectFocused(page);
		await page.keyboard.press(" ");
		await expectChrome(page);

		// A reload reopens the text and plays it, straight into focus.
		await page.reload();
		await expectFocused(page);
		await page.keyboard.press("Escape");
		await expect(choice).toBeChecked();

		await choice.uncheck();
		await pause(page);
		await page.getByRole("button", { name: "Play" }).click();
		await expectChrome(page);
	});

	for (const width of [320, 390, 1440]) {
		test(`no page scroll in focus at ${width}px, in every Reading Mode`, async ({
			page,
		}) => {
			await page.setViewportSize({
				width,
				height: width < 800 ? 640 : 900,
			});
			await start(page);
			await pause(page);
			const surfaces = [
				["RSVP", word(page)],
				["Pacer", page.getByTestId("pacer")],
				["Listen", page.getByTestId("listen")],
			] as const;
			for (const [mode, surface] of surfaces) {
				await modeButton(page, mode).click();
				await expect(surface).toBeVisible();
				await page.keyboard.press("f");
				await expectFocused(page);
				await expect(surface).toBeInViewport({ ratio: 1 });
				expect(await pageScroll(page), mode).toEqual({ down: 0, across: 0 });
				await page.keyboard.press("Escape");
				await expectChrome(page);
			}
		});
	}

	test("entering or leaving focus never moves the Position", async ({
		page,
	}) => {
		await start(page);
		await expect(word(page)).toHaveText(/^s[3-9]/, { timeout: 5000 });
		await pause(page);
		const held = await word(page).textContent();

		await page.keyboard.press("f");
		await expectFocused(page);
		await expect(word(page)).toHaveText(held ?? "");
		await page.keyboard.press("Escape");
		await expectChrome(page);
		await expect(word(page)).toHaveText(held ?? "");

		// The Pacer page grows to the whole screen in focus; the word it marks stays the same.
		await modeButton(page, "Pacer").click();
		const now = page.getByTestId("pacer").locator('[data-state="now"]');
		await expect(now).toHaveCount(1);
		const marked = await now.textContent();
		await page.keyboard.press("f");
		await expectFocused(page);
		await expect(now).toHaveText(marked ?? "");
		await page.mouse.click(10, 10);
		await expectChrome(page);
		await expect(now).toHaveText(marked ?? "");
	});

	test("keyboard and screen-reader users can leave it and reach every control", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		await page.keyboard.press("f");
		await expectFocused(page);
		await expect(
			page.getByRole("status").filter({ hasText: /Escape/ }),
		).toHaveText(/Only the words are on screen/);

		const leave = page.getByRole("button", { name: "Show the controls" });
		// Tab past the skip link to the one control left; it shows once it has focus.
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press("Tab");
			if (await leave.evaluate((el) => el === document.activeElement)) break;
		}
		await expect(leave).toBeFocused();
		await expect(leave).toBeInViewport();
		expect(
			await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
		).toHaveProperty("violations", []);

		await page.keyboard.press("Enter");
		await expectChrome(page);
		await expect(page.getByRole("button", { name: "Play" })).toBeFocused();
	});
});
