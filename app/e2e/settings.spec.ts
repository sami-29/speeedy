import { expect, type Page, test } from "@playwright/test";

// "s7a s7b s7c." The number is the sentence and the letter the place inside it.
const TEXT = Array.from(
	{ length: 150 },
	(_, i) => `s${i + 1}a s${i + 1}b s${i + 1}c.`,
).join(" ");

const word = (page: Page) => page.getByTestId("word");
const panel = (page: Page) => page.getByTestId("settings-panel");
const settingsButton = (page: Page) =>
	page.getByRole("button", { name: "Settings", exact: true });
// The bar's switch comes first; the panel repeats it.
const barMode = (page: Page, name: string) =>
	page
		.getByRole("group", { name: "Reading Mode" })
		.first()
		.getByRole("button", { name, exact: true });

async function start(page: Page, text = TEXT) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(word(page)).toHaveText(/\S/);
}

// A reload brings back the text that was open.
async function reload(page: Page) {
	await page.reload();
	await expect(word(page)).toHaveText(/\S/);
}

async function pause(page: Page) {
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
}

async function openSettings(page: Page) {
	await settingsButton(page).click();
	await expect(panel(page)).toBeVisible();
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

test.describe("the settings panel", () => {
	test("opens from its button, closes with Escape, and hands focus back", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		await expect(panel(page)).toBeHidden();
		await expect(settingsButton(page)).toHaveAttribute(
			"aria-expanded",
			"false",
		);

		await openSettings(page);
		await expect(settingsButton(page)).toHaveAttribute("aria-expanded", "true");
		await expect(
			panel(page).getByRole("button", { name: "Close settings" }),
		).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(panel(page)).toBeHidden();
		await expect(settingsButton(page)).toBeFocused();

		await openSettings(page);
		await panel(page).getByRole("button", { name: "Close settings" }).click();
		await expect(panel(page)).toBeHidden();
	});

	test("is a sidebar on a desktop and a sheet on a phone", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await start(page);
		await pause(page);
		await openSettings(page);
		let box = await panel(page).boundingBox();
		expect(box?.x ?? 0).toBeGreaterThan(1440 / 2);
		expect(box?.height).toBe(900);

		await page.setViewportSize({ width: 390, height: 780 });
		box = await panel(page).boundingBox();
		expect(box?.x).toBe(0);
		expect(box?.width).toBe(390);
		expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(780, 0);
		expect(await pageScroll(page)).toEqual({ down: 0, across: 0 });
	});

	test("a change applies at once, while the text plays", async ({ page }) => {
		await start(page);
		await openSettings(page);
		await expect(page.getByTestId("chunk")).toHaveText("1");
		await panel(page)
			.getByRole("button", { name: "More words per flash" })
			.click();
		await expect(page.getByTestId("chunk")).toHaveText("2");
		await expect(word(page)).toHaveText(/^\S+ \S+/, { timeout: 8000 });

		await expect(page.getByTestId("progress-chart")).toBeVisible();
		await panel(page).getByRole("checkbox", { name: "Progress bar" }).uncheck();
		await expect(page.getByTestId("progress-chart")).toBeHidden();
	});

	test("shows only the rows the open Reading Mode reads", async ({ page }) => {
		await start(page);
		await pause(page);
		await openSettings(page);
		await expect(
			panel(page).getByRole("heading", { name: "Paused view" }),
		).toBeVisible();
		await expect(
			panel(page).getByRole("group", { name: "Speed Zones" }),
		).toBeVisible();

		await panel(page)
			.getByRole("button", { name: "Listen", exact: true })
			.click();
		await expect(
			panel(page).getByRole("heading", { name: "Paused view" }),
		).toHaveCount(0);
		await expect(
			panel(page).getByRole("group", { name: "Speed Zones" }),
		).toHaveCount(0);
	});

	test("a reload keeps every setting", async ({ page }) => {
		await start(page);
		await pause(page);
		await openSettings(page);
		await panel(page)
			.getByRole("button", { name: "More words per flash" })
			.click();
		await panel(page).getByRole("checkbox", { name: "Smart speed" }).click();
		await panel(page).getByRole("radio", { name: "Its sentence" }).check();
		await panel(page).getByRole("checkbox", { name: "Progress bar" }).uncheck();
		await panel(page)
			.getByRole("checkbox", { name: "Remove citations" })
			.check();
		await panel(page)
			.getByRole("combobox", { name: "Ambient noise" })
			.selectOption({ label: "Brown noise" });
		await panel(page).getByLabel("Tick on each word").check();
		await panel(page).getByRole("button", { name: "Higher tick" }).click();
		const pitch = await panel(page).getByTestId("tick-pitch").textContent();

		await reload(page);
		await pause(page);
		await openSettings(page);
		await expect(page.getByTestId("chunk")).toHaveText("2");
		await expect(
			panel(page).getByRole("checkbox", { name: "Smart speed" }),
		).toBeChecked();
		await expect(
			panel(page).getByRole("radio", { name: "Its sentence" }),
		).toBeChecked();
		await expect(
			panel(page).getByRole("checkbox", { name: "Progress bar" }),
		).not.toBeChecked();
		await expect(
			panel(page).getByRole("checkbox", { name: "Remove citations" }),
		).toBeChecked();
		await expect(page.getByTestId("progress-chart")).toBeHidden();
		await expect(
			panel(page).getByRole("combobox", { name: "Ambient noise" }),
		).toHaveValue("brown");
		await expect(panel(page).getByLabel("Tick on each word")).toBeChecked();
		await expect(panel(page).getByTestId("tick-pitch")).toHaveText(pitch ?? "");
		await expect(panel(page).getByTestId("tick-pitch")).not.toHaveText(/1\.0/);
	});

	test("remove citations reads the next text without them", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		await openSettings(page);
		await panel(page)
			.getByRole("checkbox", { name: "Remove citations" })
			.check();
		await page.keyboard.press("Escape");

		await page.getByRole("button", { name: "New text" }).click();
		await page
			.getByRole("textbox", { name: "Text to read" })
			.fill("Water boils [1] here (Walker, 2017) today.");
		await page.getByRole("button", { name: "Start" }).click();
		await expect(word(page)).toHaveText(/\S/);
		await pause(page);
		await openSettings(page);
		await panel(page)
			.getByRole("button", { name: "Pacer", exact: true })
			.click();
		await expect(page.getByTestId("pacer")).toHaveText(
			/Water boils here today\./,
		);
	});
});

test.describe("the paused view in RSVP", () => {
	test("shows the word, its sentence, or the full text", async ({ page }) => {
		await start(page);
		await expect(word(page)).toHaveText(/^s[2-9]/, { timeout: 5000 });
		await pause(page);
		const held = (await word(page).textContent()) ?? "";
		const sentenceNumber = held.match(/^s(\d+)/)?.[1];
		await expect(page.getByTestId("paused-sentence")).toHaveCount(0);

		await openSettings(page);
		await panel(page).getByRole("radio", { name: "Its sentence" }).check();
		await page.keyboard.press("Escape");
		const context = page.getByTestId("paused-sentence");
		await expect(context).toHaveText(
			`s${sentenceNumber}a s${sentenceNumber}b s${sentenceNumber}c.`,
		);
		await expect(context.locator("mark")).toHaveText(held);
		await expect(word(page)).toBeVisible();

		await openSettings(page);
		await panel(page).getByRole("radio", { name: "The full text" }).check();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("paused-text")).toBeVisible();
		await expect(word(page)).toBeHidden();

		// Play brings the word back, from where it paused.
		await page.getByRole("button", { name: "Play" }).click();
		await expect(page.getByTestId("paused-text")).toHaveCount(0);
		await expect(word(page)).toBeVisible();
		await pause(page);
		expect(
			Number((await word(page).textContent())?.match(/^s(\d+)/)?.[1]),
		).toBeGreaterThanOrEqual(Number(sentenceNumber));
	});
});

test.describe("presets", () => {
	test("save, apply, rename and delete, kept across a reload", async ({
		page,
	}) => {
		await start(page);
		await pause(page);
		await openSettings(page);
		const presets = panel(page);

		await presets.getByRole("button", { name: "More words per flash" }).click();
		await expect(page.getByTestId("chunk")).toHaveText("2");
		await presets.getByRole("textbox", { name: "Preset name" }).fill("Pairs");
		await presets
			.getByRole("button", { name: "Save current settings" })
			.click();
		await expect(presets.getByTestId("presets")).toContainText("Pairs");

		// A blank name is refused.
		await presets
			.getByRole("button", { name: "Save current settings" })
			.click();
		await expect(presets.getByRole("alert")).toHaveText(
			"Give the preset a name.",
		);

		await presets
			.getByRole("button", { name: "Fewer words per flash" })
			.click();
		await expect(page.getByTestId("chunk")).toHaveText("1");
		await presets.getByRole("button", { name: "Apply Pairs" }).click();
		await expect(page.getByTestId("chunk")).toHaveText("2");

		// A rename onto another preset's name is refused.
		await presets.getByRole("textbox", { name: "Preset name" }).fill("Single");
		await presets
			.getByRole("button", { name: "Save current settings" })
			.click();
		await presets.getByRole("button", { name: "Rename Single" }).click();
		await presets.getByRole("textbox", { name: "Rename Single" }).fill("pairs");
		await presets.getByRole("button", { name: "Save name" }).click();
		await expect(presets.getByRole("alert")).toHaveText(
			"Another preset has that name.",
		);
		// The refused rename stays open for another try; leave it and remove the preset.
		await presets.getByRole("button", { name: "Cancel" }).click();
		await presets.getByRole("button", { name: "Delete Single" }).click();

		await presets.getByRole("button", { name: "Rename Pairs" }).click();
		await presets
			.getByRole("textbox", { name: "Rename Pairs" })
			.fill("Two words");
		await presets.getByRole("button", { name: "Save name" }).click();
		await expect(presets.getByTestId("presets")).toContainText("Two words");
		await expect(presets.getByTestId("presets")).not.toContainText("Pairs");

		await reload(page);
		await pause(page);
		await openSettings(page);
		await expect(panel(page).getByTestId("presets")).toContainText("Two words");
		await panel(page).getByRole("button", { name: "Delete Two words" }).click();
		await expect(panel(page).getByTestId("presets")).toHaveCount(0);

		await reload(page);
		await pause(page);
		await openSettings(page);
		await expect(panel(page).getByTestId("presets")).toHaveCount(0);
	});

	test("a preset carries the Reading Mode and the sound", async ({ page }) => {
		await start(page);
		await pause(page);
		await openSettings(page);
		await panel(page).getByLabel("Tick on each word").check();
		await panel(page)
			.getByRole("textbox", { name: "Preset name" })
			.fill("Tick");
		await panel(page)
			.getByRole("button", { name: "Save current settings" })
			.click();

		await panel(page).getByLabel("Tick on each word").uncheck();
		await panel(page)
			.getByRole("button", { name: "Pacer", exact: true })
			.click();
		await expect(page.getByTestId("pacer")).toBeVisible();

		await panel(page).getByRole("button", { name: "Apply Tick" }).click();
		await expect(word(page)).toBeVisible();
		await expect(panel(page).getByLabel("Tick on each word")).toBeChecked();
	});
});

test.describe("no page scroll with the panel closed", () => {
	for (const width of [320, 390, 1440]) {
		test(`at ${width}px, in every Reading Mode`, async ({ page }) => {
			await page.setViewportSize({ width, height: width < 800 ? 640 : 900 });
			await start(page);
			await pause(page);
			for (const [mode, surface] of [
				["RSVP", word(page)],
				["Pacer", page.getByTestId("pacer")],
				["Listen", page.getByTestId("listen")],
			] as const) {
				await barMode(page, mode).click();
				await expect(surface).toBeVisible();
				await openSettings(page);
				await page.keyboard.press("Escape");
				await expect(panel(page)).toBeHidden();
				expect(await pageScroll(page), mode).toEqual({ down: 0, across: 0 });
				await page.keyboard.press("f");
				await expect(page.locator("html")).toHaveAttribute("data-focus", "on");
				await expect(surface).toBeInViewport({ ratio: 1 });
				expect(await pageScroll(page), mode).toEqual({ down: 0, across: 0 });
				await page.keyboard.press("Escape");
			}
		});
	}
});
