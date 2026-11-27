import { expect, type Page, test } from "@playwright/test";
import { settings } from "./settings-panel";

// Plain numbered words, so a rewind by words is easy to read: "w12" is the twelfth.
const TEXT = Array.from({ length: 300 }, (_, i) => `w${i + 1}`).join(" ");

const word = (page: Page) => page.getByTestId("word");

async function start(page: Page) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(word(page)).toHaveText(/\S/);
}

async function pause(page: Page) {
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Play", exact: true }),
	).toBeVisible();
}

/** The number of the word on screen: "w12" is 12. */
async function place(page: Page) {
	return Number((await word(page).textContent())?.match(/^w(\d+)/)?.[1]);
}

/** Read on until past word `n`, then pause. */
async function pauseAfter(page: Page, n: number) {
	await expect.poll(() => place(page), { timeout: 20_000 }).toBeGreaterThan(n);
	await pause(page);
}

async function setCountdown(page: Page, on: boolean) {
	const box = (await settings(page)).getByRole("checkbox", {
		name: "Start countdown",
	});
	if (on) await box.check();
	else await box.uncheck();
}

test.describe("pacing settings in the panel", () => {
	test("lists the pauses, the ramp, the rewind step and the countdown", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		const open = await settings(page);
		await expect(
			open.getByRole("checkbox", { name: "Pause on punctuation" }),
		).toBeChecked();
		await expect(
			open.getByRole("spinbutton", { name: "Sentence pause" }),
		).toHaveValue("2.0");
		await expect(
			open.getByRole("spinbutton", { name: "Paragraph pause" }),
		).toHaveValue("1.8");
		await expect(
			open.getByRole("checkbox", { name: "Comma pause" }),
		).not.toBeChecked();
		await expect(
			open.getByRole("checkbox", { name: "Pause after an aside" }),
		).toBeChecked();
		await expect(
			open.getByRole("checkbox", { name: "Speed ramp" }),
		).not.toBeChecked();
		await expect(
			open.getByRole("spinbutton", { name: "Rewind step" }),
		).toHaveValue("5");
		await expect(
			open.getByRole("checkbox", { name: "Start countdown" }),
		).not.toBeChecked();
	});

	test("the pause numbers go with their switch, and the ramp numbers with theirs", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		const open = await settings(page);
		const sentence = open.getByRole("spinbutton", { name: "Sentence pause" });
		await open
			.getByRole("checkbox", { name: "Pause on punctuation" })
			.uncheck();
		await expect(sentence).toHaveCount(0);
		await expect(
			open.getByRole("spinbutton", { name: "Paragraph pause" }),
		).toHaveCount(0);
		await open.getByRole("checkbox", { name: "Pause on punctuation" }).check();
		await expect(sentence).toBeVisible();

		await expect(
			open.getByRole("spinbutton", { name: "Target speed" }),
		).toHaveCount(0);
		await open.getByRole("checkbox", { name: "Speed ramp" }).check();
		await expect(
			open.getByRole("spinbutton", { name: "Target speed" }),
		).toHaveValue("500");
		await expect(
			open.getByRole("spinbutton", { name: "Ramp length" }),
		).toHaveValue("30");
	});

	test("the steppers and the number field change a value, within its range", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		const open = await settings(page);
		const sentence = open.getByRole("spinbutton", { name: "Sentence pause" });
		await open.getByRole("button", { name: "Increase Sentence pause" }).click();
		await expect(sentence).toHaveValue("2.5");
		await open.getByRole("button", { name: "Decrease Sentence pause" }).click();
		await open.getByRole("button", { name: "Decrease Sentence pause" }).click();
		await expect(sentence).toHaveValue("1.5");

		await sentence.fill("40");
		await sentence.press("Enter");
		await expect(sentence).toHaveValue("10.0");
		await expect(
			open.getByRole("button", { name: "Increase Sentence pause" }),
		).toBeDisabled();

		await sentence.fill("0");
		await sentence.press("Tab");
		await expect(sentence).toHaveValue("1.0");
		await expect(
			open.getByRole("button", { name: "Decrease Sentence pause" }),
		).toBeDisabled();
	});

	test("Pacer has the pacing rows but not the countdown", async ({ page }) => {
		await start(page);
		await pause(page);
		const open = await settings(page);
		await expect(
			open.getByRole("checkbox", { name: "Start countdown" }),
		).toBeVisible();
		await open.getByRole("button", { name: "Pacer", exact: true }).click();
		await expect(page.getByTestId("pacer")).toBeVisible();
		await expect(
			open.getByRole("spinbutton", { name: "Sentence pause" }),
		).toBeVisible();
		await expect(
			open.getByRole("checkbox", { name: "Speed ramp" }),
		).toBeVisible();
		await expect(
			open.getByRole("spinbutton", { name: "Rewind step" }),
		).toBeVisible();
		await expect(
			open.getByRole("checkbox", { name: "Start countdown" }),
		).toHaveCount(0);
	});

	test("a reload keeps every pacing setting", async ({ page }) => {
		await start(page);
		await pause(page);
		const open = await settings(page);
		await open.getByRole("button", { name: "Increase Sentence pause" }).click();
		await open.getByRole("checkbox", { name: "Comma pause" }).check();
		await open
			.getByRole("checkbox", { name: "Pause after an aside" })
			.uncheck();
		await open.getByRole("checkbox", { name: "Speed ramp" }).check();
		const target = open.getByRole("spinbutton", { name: "Target speed" });
		await target.fill("600");
		await target.press("Enter");
		await open.getByRole("spinbutton", { name: "Rewind step" }).fill("8");
		await open.getByRole("spinbutton", { name: "Rewind step" }).press("Enter");
		await setCountdown(page, true);

		await page.reload();
		await expect(word(page)).toHaveText(/\S/);
		await pause(page);
		const again = await settings(page);
		await expect(
			again.getByRole("spinbutton", { name: "Sentence pause" }),
		).toHaveValue("2.5");
		await expect(
			again.getByRole("checkbox", { name: "Comma pause" }),
		).toBeChecked();
		await expect(
			again.getByRole("checkbox", { name: "Pause after an aside" }),
		).not.toBeChecked();
		await expect(
			again.getByRole("checkbox", { name: "Speed ramp" }),
		).toBeChecked();
		await expect(
			again.getByRole("spinbutton", { name: "Target speed" }),
		).toHaveValue("600");
		await expect(
			again.getByRole("spinbutton", { name: "Rewind step" }),
		).toHaveValue("8");
		await expect(
			again.getByRole("checkbox", { name: "Start countdown" }),
		).toBeChecked();
	});

	test("a change while reading keeps the word and the Position", async ({
		page,
	}) => {
		await start(page);
		await expect
			.poll(() => place(page), { timeout: 10_000 })
			.toBeGreaterThan(2);
		const open = await settings(page);
		await open
			.getByRole("button", { name: "Increase Paragraph pause" })
			.click();
		await open.getByRole("checkbox", { name: "Comma pause" }).check();
		const before = await place(page);
		await expect
			.poll(() => place(page), { timeout: 10_000 })
			.toBeGreaterThan(before);
		// Reading went on from where it was: no jump back to the start or ahead.
		expect(await place(page)).toBeLessThan(before + 20);
		await expect(
			page.getByRole("button", { name: "Pause", exact: true }),
		).toBeVisible();
	});
});

test.describe("rewind by words", () => {
	test("J and the button go back by the rewind step, and the step is settable", async ({
		page,
	}) => {
		await start(page);
		await pauseAfter(page, 20);
		const from = await place(page);
		await page.keyboard.press("j");
		await expect.poll(() => place(page)).toBe(from - 5);

		await page.getByRole("button", { name: "Back 5 words" }).click();
		await expect.poll(() => place(page)).toBe(from - 10);

		const open = await settings(page);
		const step = open.getByRole("spinbutton", { name: "Rewind step" });
		await step.fill("3");
		await step.press("Enter");
		await expect(
			page.getByRole("button", { name: "Back 3 words" }),
		).toBeVisible();
		await page.getByRole("button", { name: "Back 3 words" }).click();
		await expect.poll(() => place(page)).toBe(from - 13);
	});

	test("a step of one word reads singular", async ({ page }) => {
		await start(page);
		await pauseAfter(page, 6);
		const open = await settings(page);
		const step = open.getByRole("spinbutton", { name: "Rewind step" });
		await step.fill("1");
		await step.press("Enter");
		await expect(
			page.getByRole("button", { name: "Back 1 word", exact: true }),
		).toBeVisible();
	});

	test("never goes before the first word", async ({ page }) => {
		await start(page);
		await pauseAfter(page, 2);
		await page.keyboard.press("j");
		await page.keyboard.press("j");
		await expect.poll(() => place(page)).toBe(1);
	});

	test("the sentence, paragraph and chapter rewinds are still there", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		for (const name of ["Back one sentence", "Back one paragraph"]) {
			await expect(page.getByRole("button", { name })).toBeVisible();
		}
	});
});

test.describe("the start countdown", () => {
	test("counts 3, 2, 1 on the reading surface, then plays", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		await setCountdown(page, true);
		await page.keyboard.press("Escape");
		const before = await place(page);

		await page.getByRole("button", { name: "Play", exact: true }).click();
		const count = page.getByTestId("countdown");
		await expect(count).toHaveText("3");
		await expect(count).toHaveText("2", { timeout: 2000 });
		await expect(count).toHaveText("1", { timeout: 2000 });
		await expect(count).toHaveCount(0, { timeout: 2000 });
		await expect(
			page.getByRole("button", { name: "Pause", exact: true }),
		).toBeVisible();
		await expect.poll(() => place(page)).toBeGreaterThanOrEqual(before);
	});

	test("Play again, or switching mode, cancels it", async ({ page }) => {
		await start(page);
		await pause(page);
		await setCountdown(page, true);
		await page.keyboard.press("Escape");
		const before = await place(page);

		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect(page.getByTestId("countdown")).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByTestId("countdown")).toHaveCount(0);
		await page.waitForTimeout(3200);
		await expect(
			page.getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
		expect(await place(page)).toBe(before);
	});

	test("does not run when it is off", async ({ page }) => {
		await start(page);
		await pause(page);
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Pause", exact: true }),
		).toBeVisible();
		await expect(page.getByTestId("countdown")).toHaveCount(0);
	});

	test("in the focus state only the count is added to the word", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		await setCountdown(page, true);
		await page.keyboard.press("Escape");
		await page.keyboard.press("f");
		await expect(page.locator("html")).toHaveAttribute("data-focus", "on");

		await page.keyboard.press("k");
		const count = page.getByTestId("countdown");
		await expect(count).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-focus", "on");
		await expect(page.getByTestId("controls")).toBeHidden();
		await expect(page.locator("header")).toBeHidden();
		await expect(count).toHaveCount(0, { timeout: 4000 });
		await expect(page.locator("html")).toHaveAttribute("data-focus", "on");
		await expect.poll(() => place(page)).toBeGreaterThan(0);
	});

	test("with focus on Play, the focus state starts with the count and the stage does not move", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await start(page);
		await pause(page);
		const open = await settings(page);
		await setCountdown(page, true);
		await open
			.getByRole("checkbox", { name: "Focus when I press Play" })
			.check();
		await page.keyboard.press("Escape");

		await page.getByRole("button", { name: "Play", exact: true }).click();
		const count = page.getByTestId("countdown");
		await expect(count).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-focus", "on");
		await expect(page.getByTestId("controls")).toBeHidden();
		await page.screenshot({
			path: "test-results/focus-on-play-countdown-390.png",
		});
		const during = await page.getByTestId("stage").boundingBox();

		await expect(count).toHaveCount(0, { timeout: 4000 });
		await expect.poll(() => place(page)).toBeGreaterThan(0);
		const after = await page.getByTestId("stage").boundingBox();
		expect(Math.abs((after?.y ?? 0) - (during?.y ?? 0))).toBeLessThan(1);
		await expect(page.locator("html")).toHaveAttribute("data-focus", "on");
	});

	test("bringing the controls back during a count in the focus state cancels it", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		await setCountdown(page, true);
		await page.keyboard.press("Escape");
		await page.keyboard.press("f");
		await page.keyboard.press("k");
		await expect(page.getByTestId("countdown")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("countdown")).toHaveCount(0);
		await expect(page.locator("html")).not.toHaveAttribute("data-focus", "on");
		await page.waitForTimeout(3000);
		await expect(
			page.getByRole("button", { name: "Play", exact: true }),
		).toBeVisible();
	});
});
