import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// 150 sentences of three words: "s7a s7b s7c." The letter gives the place inside the
// sentence and the number the sentence, so a word's place in the text is easy to read back.
const SENTENCES = Array.from(
	{ length: 150 },
	(_, i) => `s${i + 1}a s${i + 1}b s${i + 1}c.`,
).join(" ");

/** The place of a word like `s7b` in the text: sentence 7, second word is 19. */
const placeOf = (word: string): number => {
	const match = /^s(\d+)([abc])\.?$/.exec(word);
	if (!match) return -1;
	return (Number(match[1]) - 1) * 3 + "abc".indexOf(match[2] as string) + 1;
};

async function start(page: Page, text: string = SENTENCES) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(page.getByTestId("word")).toHaveText(/\S/);
}

const slider = (page: Page) =>
	page.getByRole("slider", { name: "Reading speed" });

/** Takes the focus off every control, so keys go to the page. */
const focusPage = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

const rebuilds = (page: Page) =>
	page.evaluate(() => performance.getEntriesByName("speeedy:rebuild").length);

/** Waits until the worker's rebuild has been applied after `before` rebuilds. */
const rebuiltAfter = async (page: Page, before: number) => {
	await expect
		.poll(() => rebuilds(page), { timeout: 15_000 })
		.toBeGreaterThan(before);
};

async function pause(page: Page): Promise<string> {
	await page.getByRole("button", { name: "Pause" }).click();
	return (await page.getByTestId("word").textContent()) ?? "";
}

test.describe("WPM slider", () => {
	test("is an ARIA slider that announces the speed and its Speed Zone", async ({
		page,
	}) => {
		await start(page);
		const control = slider(page);
		await expect(control).toHaveAttribute("aria-valuemin", "100");
		await expect(control).toHaveAttribute("aria-valuemax", "1600");
		await expect(control).toHaveAttribute("aria-valuenow", "250");
		await expect(control).toHaveAttribute(
			"aria-valuetext",
			/250 words per minute.*read/i,
		);
		await expect(page.getByTestId("wpm")).toHaveText("250 WPM");
	});

	test("answers the keyboard: arrows, Shift, Page keys, Home and End", async ({
		page,
	}) => {
		await start(page);
		const control = slider(page);
		await control.focus();
		await page.keyboard.press("ArrowRight");
		await expect(control).toHaveAttribute("aria-valuenow", "260");
		await page.keyboard.press("ArrowUp");
		await expect(control).toHaveAttribute("aria-valuenow", "270");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowDown");
		await expect(control).toHaveAttribute("aria-valuenow", "250");
		await page.keyboard.press("Shift+ArrowRight");
		await expect(control).toHaveAttribute("aria-valuenow", "300");
		await page.keyboard.press("PageDown");
		await expect(control).toHaveAttribute("aria-valuenow", "250");
		await page.keyboard.press("End");
		await expect(control).toHaveAttribute("aria-valuenow", "1600");
		await expect(control).toHaveAttribute("aria-valuetext", /skim/i);
		await page.keyboard.press("Home");
		await expect(control).toHaveAttribute("aria-valuenow", "100");
		await expect(control).toHaveAttribute("aria-valuetext", /study/i);
	});

	test("can be dragged sideways", async ({ page }) => {
		await start(page);
		const box = (await slider(page).boundingBox()) as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 80, y, { steps: 8 });
		await page.mouse.up();
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "350");
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 160, y, { steps: 8 });
		await page.mouse.up();
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "190");
	});

	test("has steppers for those who cannot drag", async ({ page }) => {
		await start(page);
		await page.getByRole("button", { name: "Faster" }).click();
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "260");
		await page.getByRole("button", { name: "Slower" }).click();
		await page.getByRole("button", { name: "Slower" }).click();
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "240");
	});

	test("applies from the current word: the word stays and reading goes on from it", async ({
		page,
	}) => {
		await start(page);
		await expect(page.getByTestId("word")).toHaveText(/^s[2-9]/, {
			timeout: 8000,
		});
		const paused = await pause(page);
		const place = placeOf(paused);
		expect(place).toBeGreaterThan(3);

		const before = await rebuilds(page);
		await slider(page).focus();
		await page.keyboard.press("Shift+ArrowRight");
		await page.keyboard.press("Shift+ArrowRight");
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "350");
		await rebuiltAfter(page, before);
		await expect(page.getByTestId("word")).toHaveText(paused);

		// Record every word from here on, in the page, so polling cannot miss one.
		await page.evaluate(() => {
			const seen: string[] = [];
			(window as unknown as { __seen: string[] }).__seen = seen;
			new MutationObserver(() => {
				const text =
					document.querySelector('[data-testid="word"]')?.textContent ?? "";
				if (text && text !== seen[seen.length - 1]) seen.push(text);
			}).observe(document.querySelector('[data-testid="word"]') as Node, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		});
		await page.getByRole("button", { name: "Play" }).click();
		await page.waitForTimeout(1200);
		const seen = await page.evaluate(
			() => (window as unknown as { __seen: string[] }).__seen,
		);
		const places = seen.map(placeOf);
		expect(places.length).toBeGreaterThan(3);
		expect(places[0]).toBe(place);
		for (let i = 1; i < places.length; i++) {
			expect(places[i]).toBe((places[i - 1] as number) + 1);
		}
	});

	test("reads faster while playing after the speed goes up", async ({
		page,
	}) => {
		await start(page);
		const count = () =>
			page.evaluate(
				() =>
					new Promise<number>((resolve) => {
						let words = 0;
						const target = document.querySelector(
							'[data-testid="word"]',
						) as Node;
						const observer = new MutationObserver(() => words++);
						observer.observe(target, {
							subtree: true,
							childList: true,
							characterData: true,
						});
						setTimeout(() => {
							observer.disconnect();
							resolve(words);
						}, 1500);
					}),
			);
		const slow = await count();
		const before = await rebuilds(page);
		await slider(page).focus();
		await page.keyboard.press("End");
		await rebuiltAfter(page, before);
		const fast = await count();
		expect(fast).toBeGreaterThan(slow * 3);
	});
});

test.describe("Speed Zones", () => {
	test("are labelled study, read and skim, and the current one is marked", async ({
		page,
	}) => {
		await start(page);
		const zones = page.getByRole("group", { name: "Speed Zones" });
		await expect(zones.getByRole("button")).toHaveText([
			/Study/,
			/Read/,
			/Skim/,
		]);
		await expect(zones.getByRole("button", { name: /Read/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(zones.getByRole("button", { name: /Skim/ })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("picking one sets a speed inside it, and high speeds say skimming", async ({
		page,
	}) => {
		await start(page);
		const zones = page.getByRole("group", { name: "Speed Zones" });
		await zones.getByRole("button", { name: /Skim/ }).click();
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "400");
		await expect(zones.getByRole("button", { name: /Skim/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(page.getByTestId("zone-note")).toContainText(/skimming/i);
		await zones.getByRole("button", { name: /Study/ }).click();
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "180");
		await expect(page.getByTestId("zone-note")).not.toContainText(/skimming/i);
	});

	test("follow the slider", async ({ page }) => {
		await start(page);
		await slider(page).focus();
		await page.keyboard.press("End");
		await expect(
			page
				.getByRole("group", { name: "Speed Zones" })
				.getByRole("button", { name: /Skim/ }),
		).toHaveAttribute("aria-pressed", "true");
	});

	test("never promise a multiplier", async ({ page }) => {
		await start(page);
		const text = (await page.getByTestId("controls").textContent()) ?? "";
		expect(text).not.toMatch(/\d\s?x\b|×|faster than|best/i);
	});
});

test.describe("settings", () => {
	test("chunk size shows several words in one flash", async ({ page }) => {
		await start(page);
		const group = page.getByRole("group", { name: "Reading settings" });
		await expect(page.getByTestId("chunk")).toHaveText("1");
		const before = await rebuilds(page);
		await group.getByRole("button", { name: "More words per flash" }).click();
		await expect(page.getByTestId("chunk")).toHaveText("2");
		await rebuiltAfter(page, before);
		await pause(page);
		await expect(page.getByTestId("word")).toHaveText(/^\S+ \S+/);
		await group.getByRole("button", { name: "Fewer words per flash" }).click();
		await expect(page.getByTestId("chunk")).toHaveText("1");
	});

	test("smart speed, punctuation pauses and speed ramp are switches that rebuild", async ({
		page,
	}) => {
		await start(page);
		const group = page.getByRole("group", { name: "Reading settings" });
		for (const [name, checked] of [
			["Smart speed", false],
			["Pause on punctuation", true],
			["Speed ramp", false],
		] as const) {
			const box = group.getByRole("checkbox", { name });
			if (checked) await expect(box).toBeChecked();
			else await expect(box).not.toBeChecked();
			const before = await rebuilds(page);
			await box.click();
			if (checked) await expect(box).not.toBeChecked();
			else await expect(box).toBeChecked();
			await rebuiltAfter(page, before);
		}
	});

	test("keep playing while they change", async ({ page }) => {
		await start(page);
		const before = await rebuilds(page);
		await page
			.getByRole("group", { name: "Reading settings" })
			.getByRole("checkbox", { name: "Smart speed" })
			.click();
		await rebuiltAfter(page, before);
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
	});
});

test.describe("keyboard", () => {
	test("Space and K play and pause when no control has focus", async ({
		page,
	}) => {
		await start(page);
		await focusPage(page);
		await page.keyboard.press("Space");
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
		await page.keyboard.press("k");
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
	});

	test("ArrowLeft goes back to the start of the sentence, then the one before", async ({
		page,
	}) => {
		await start(page);
		await expect(page.getByTestId("word")).toHaveText(/^s[3-9]/, {
			timeout: 12_000,
		});
		const paused = await pause(page);
		await focusPage(page);
		await page.keyboard.press("ArrowLeft");
		const first = (await page.getByTestId("word").textContent()) ?? "";
		expect(first).toMatch(/^s\d+a$/);
		expect(placeOf(first)).toBeLessThanOrEqual(placeOf(paused));
		await page.keyboard.press("ArrowLeft");
		const second = (await page.getByTestId("word").textContent()) ?? "";
		expect(placeOf(second)).toBe(placeOf(first) - 3);
	});

	test("the Back button does what ArrowLeft does", async ({ page }) => {
		await start(page);
		await expect(page.getByTestId("word")).toHaveText(/^s[3-9]/, {
			timeout: 12_000,
		});
		await pause(page);
		await page.getByRole("button", { name: "Back one sentence" }).click();
		await expect(page.getByTestId("word")).toHaveText(/^s\d+a$/);
	});

	test("ArrowUp and ArrowDown change the speed, Shift by 50", async ({
		page,
	}) => {
		await start(page);
		await focusPage(page);
		await page.keyboard.press("ArrowUp");
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "260");
		await page.keyboard.press("Shift+ArrowUp");
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "310");
		await page.keyboard.press("ArrowDown");
		await expect(slider(page)).toHaveAttribute("aria-valuenow", "300");
	});

	test("M keeps the only Reading Mode and the mode switch shows it", async ({
		page,
	}) => {
		await start(page);
		await focusPage(page);
		await page.keyboard.press("m");
		const modes = page.getByRole("group", { name: "Reading Mode" });
		await expect(modes.getByRole("button", { name: "RSVP" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
	});

	test("the shortcuts are listed behind a visible button, and ? opens them", async ({
		page,
	}) => {
		await start(page);
		const button = page.getByRole("button", { name: "Keyboard shortcuts" });
		await expect(button).toHaveAttribute("aria-expanded", "false");
		await expect(
			page.getByRole("list", { name: "Keyboard shortcuts" }),
		).toBeHidden();
		await button.click();
		await expect(button).toHaveAttribute("aria-expanded", "true");
		const list = page.getByRole("list", { name: "Keyboard shortcuts" });
		await expect(list).toBeVisible();
		for (const label of ["Space", "←", "↑", "↓", "M"]) {
			await expect(list).toContainText(label);
		}
		await button.click();
		await expect(list).toBeHidden();
		await focusPage(page);
		await page.keyboard.press("Shift+?");
		await expect(list).toBeVisible();
	});

	test("typing in the text field is not a shortcut", async ({ page }) => {
		await page.goto("/reader");
		const field = page.getByRole("textbox", { name: "Text to read" });
		await field.fill("");
		await field.pressSequentially("k m ? ");
		await expect(field).toHaveValue("k m ? ");
		await expect(page.getByTestId("word")).toHaveCount(0);
	});
});

test.describe("dimming", () => {
	test("controls and header drop to 35% while playing and come back on hover or focus", async ({
		page,
	}) => {
		await start(page);
		const controls = page.getByTestId("controls");
		await page.getByTestId("stage").hover();
		await expect(controls).toHaveCSS("opacity", "0.35");
		await expect(page.locator("header")).toHaveCSS("opacity", "0.35");

		await controls.getByRole("slider").hover();
		await expect(controls).toHaveCSS("opacity", "1");

		await page.getByTestId("stage").hover();
		await expect(controls).toHaveCSS("opacity", "0.35");
		await page.keyboard.press("Tab");
		await expect(controls).toHaveCSS("opacity", "1");
	});

	test("controls return when the reader pauses", async ({ page }) => {
		await start(page);
		await page.getByTestId("stage").hover();
		await expect(page.getByTestId("controls")).toHaveCSS("opacity", "0.35");
		await page.keyboard.press("k");
		await expect(page.getByTestId("controls")).toHaveCSS("opacity", "1");
		await expect(page.locator("header")).toHaveCSS("opacity", "1");
	});

	test("a key press brings them back for a moment", async ({ page }) => {
		await start(page);
		await page.getByTestId("stage").hover();
		await expect(page.getByTestId("controls")).toHaveCSS("opacity", "0.35");
		await focusPage(page);
		await page.keyboard.press("ArrowUp");
		await expect(page.getByTestId("controls")).toHaveCSS("opacity", "1");
	});

	test("do not animate with reduced motion", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await start(page);
		const duration = await page
			.getByTestId("controls")
			.evaluate((el) => getComputedStyle(el).transitionDuration);
		for (const part of duration.split(",")) {
			expect(Number.parseFloat(part)).toBeLessThan(0.001);
		}
	});
});

for (const viewport of [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
]) {
	test.describe(`axe on the reader at ${viewport.name}`, () => {
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

		test("with the controls, paused", async ({ page }) => {
			await start(page);
			await pause(page);
			await check(page);
		});

		test("with the shortcuts open and a Skim speed", async ({ page }) => {
			await start(page);
			await pause(page);
			await page.getByRole("button", { name: /Skim/ }).click();
			await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
			await check(page);
		});

		test("in the Night theme", async ({ page }) => {
			await start(page);
			await pause(page);
			await page.getByRole("button", { name: "Night theme" }).click();
			await check(page);
		});
	});
}

test.describe("Paper and Night", () => {
	test("the theme switch is in the reader and keeps working while reading", async ({
		page,
	}) => {
		await start(page);
		await page.getByRole("button", { name: "Night theme" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
		await page.getByRole("button", { name: "Paper theme" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
	});
});

test.describe("privacy", () => {
	const CANARIES = [
		"zanzibarquokka",
		"marmaladexylograph",
		"pterodactylwhisk",
		"gryphonfjord",
	];
	const TEXT = Array.from(
		{ length: 60 },
		(_, i) =>
			`The ${CANARIES[i % 4]} met the ${CANARIES[(i + 1) % 4]} near gate ${i}.`,
	).join(" ");

	test("no word of the document reaches /api/e or any other request", async ({
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

		await start(page, TEXT);
		// Read, change every kind of setting, and seek.
		await page.waitForTimeout(800);
		await slider(page).focus();
		await page.keyboard.press("Shift+ArrowRight");
		await page
			.getByRole("group", { name: "Speed Zones" })
			.getByRole("button", { name: /Skim/ })
			.click();
		const group = page.getByRole("group", { name: "Reading settings" });
		await group.getByRole("button", { name: "More words per flash" }).click();
		await group.getByRole("checkbox", { name: "Smart speed" }).click();
		await group.getByRole("checkbox", { name: "Speed ramp" }).click();
		await group.getByRole("checkbox", { name: "Pause on punctuation" }).click();
		await page.waitForTimeout(600);
		await focusPage(page);
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Shift+ArrowLeft");
		await page.getByRole("button", { name: "Back one sentence" }).click();
		await page.keyboard.press("k");
		// Leave the reader, so any queued batch is sent, then give timers time to fire.
		await page.getByRole("link", { name: "Library" }).click();
		await expect(page).toHaveURL(/\/library$/);
		await page.waitForTimeout(2800);

		const events = seen.filter((request) => request.url.endsWith("/api/e"));
		expect(events.length).toBeGreaterThan(0);
		const everything = (request: (typeof seen)[number]) =>
			`${request.url}\n${request.body}\n${request.headers}`.toLowerCase();
		for (const canary of CANARIES) {
			for (const request of events) {
				expect(everything(request)).not.toContain(canary);
			}
			// No other request carries the text either, on any host.
			for (const request of seen) {
				expect(everything(request)).not.toContain(canary);
			}
		}
		for (const request of events) {
			expect(request.body).not.toMatch(/\bgate \d+\b/);
		}
	});
});

test.describe("rebuilds run off the main thread", () => {
	test.setTimeout(90_000);

	test("a settings change on 100 000 words causes no long task, and the reader keeps its word", async ({
		page,
	}) => {
		const words: string[] = [];
		for (let i = 0; i < 100_000; i++) {
			words.push(`w${i + 1}${i % 12 === 11 ? "." : ""}`);
		}
		await page.goto("/reader");
		await page
			.getByRole("textbox", { name: "Text to read" })
			.fill(words.join(" "));
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page.getByTestId("word")).toHaveText(/^w\d+/, {
			timeout: 60_000,
		});

		await page.evaluate(() => {
			const longTasks: number[] = [];
			(window as unknown as { __long: number[] }).__long = longTasks;
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) longTasks.push(entry.duration);
			}).observe({ entryTypes: ["longtask"] });
		});
		const before = await rebuilds(page);
		await slider(page).focus();
		await page.keyboard.press("Shift+ArrowRight");
		await page.keyboard.press("Shift+ArrowRight");
		await rebuiltAfter(page, before);
		await page.waitForTimeout(500);

		const result = await page.evaluate(() => ({
			longTasks: (window as unknown as { __long: number[] }).__long,
			rebuild: performance
				.getEntriesByName("speeedy:rebuild")
				.map((entry) => Math.round(entry.duration)),
		}));
		test.info().annotations.push({
			type: "rebuild latency ms (100k words)",
			description: JSON.stringify(result),
		});
		expect(Math.max(0, ...result.longTasks)).toBeLessThan(100);
		await expect(page.getByTestId("word")).toHaveText(/^w\d+/);
	});
});
