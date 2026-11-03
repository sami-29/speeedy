import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

// 150 sentences of three words: "s7a s7b s7c." The letter gives the place inside the
// sentence and the number the sentence, so a word's place in the text is easy to read back.
const SENTENCES = Array.from(
	{ length: 150 },
	(_, i) => `s${i + 1}a s${i + 1}b s${i + 1}c.`,
).join(" ");

const FILLER = Array.from(
	{ length: 70 },
	(_, i) =>
		`<p>Filler ${i + 1}a filler ${i + 1}b filler ${i + 1}c filler ${i + 1}d.</p>`,
).join("\n");

// One block of every kind, spans of every kind, and a long tail to scroll through.
const DOCUMENT = `<!doctype html><html lang="en"><body>
<h1>Heading one</h1>
<p>Plain text with <em>emphasis words</em> and <strong>strong words</strong> and <a href="https://example.com/x">a safe link</a> in it.</p>
<h2>Heading two</h2>
<ul><li>First bullet<ul><li>Nested bullet</li></ul></li><li>Second bullet</li></ul>
<ol><li>One item</li><li>Two item</li></ol>
<blockquote><p>Quoted words here.</p></blockquote>
<pre>let x = 1;
let y = 2;</pre>
<table><tr><td>Cell one</td><td>Cell two</td></tr></table>
<figure><img src="x.png" alt="A red fox"><figcaption>Caption words.</figcaption></figure>
${FILLER}
<p>The very last words.</p>
</body></html>`;

const pane = (page: Page) => page.getByTestId("pacer");
const now = (page: Page) => pane(page).locator('[data-state="now"]');
const nowText = async (page: Page) =>
	(await now(page).allTextContents()).join("");
const word = (page: Page) => page.getByTestId("word");

async function startPasted(page: Page, text: string = SENTENCES) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(word(page)).toHaveText(/\S/);
}

/** Opens the HTML document in the reader and pauses it, then switches to Pacer. */
async function openDocument(page: Page) {
	await page.goto("/reader");
	await page.getByLabel("Choose a file").setInputFiles({
		name: "doc.html",
		mimeType: "text/html",
		buffer: Buffer.from(DOCUMENT),
	});
	await expect(word(page)).toHaveText(/\S/);
	await page.getByRole("button", { name: "Pause" }).click();
	await page.getByRole("button", { name: "Pacer" }).click();
	await expect(pane(page)).toBeVisible();
}

const focusPage = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

const modeButton = (page: Page, name: string) =>
	page
		.getByRole("group", { name: "Reading Mode" })
		.getByRole("button", { name });

/**
 * True when the first element matching `selector` is inside the pane's visible box, else
 * where it was. One call in the page, because the current word's node is replaced when the
 * reader moves to another block.
 */
const inView = (page: Page, selector: string) =>
	pane(page).evaluate((root, query) => {
		const el = root.querySelector(query);
		if (!el) return `no ${query}`;
		const box = root.getBoundingClientRect();
		const rect = el.getBoundingClientRect();
		const inside = rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
		return (
			inside ||
			`${el.textContent} at ${rect.top}-${rect.bottom} outside ${box.top}-${box.bottom}, scrollTop ${root.scrollTop}`
		);
	}, selector);

const NOW = '[data-state="now"]';

test.describe("Reading Mode switch", () => {
	test("offers RSVP and Pacer, and the Pacer button switches the view", async ({
		page,
	}) => {
		await startPasted(page);
		await expect(modeButton(page, "RSVP")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(modeButton(page, "Pacer")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await modeButton(page, "Pacer").click();
		await expect(modeButton(page, "Pacer")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(pane(page)).toBeVisible();
		await expect(word(page)).toHaveCount(0);
		await modeButton(page, "RSVP").click();
		await expect(word(page)).toBeVisible();
		await expect(pane(page)).toHaveCount(0);
	});

	test("RSVP to Pacer and back keeps the Position", async ({ page }) => {
		await startPasted(page);
		await expect(word(page)).toHaveText(/^s[3-9]/, { timeout: 12_000 });
		await page.getByRole("button", { name: "Pause" }).click();
		const paused = (await word(page).textContent()) ?? "";
		await modeButton(page, "Pacer").click();
		await expect(now(page).first()).toBeVisible();
		expect(await nowText(page)).toBe(paused);
		// Paused stays paused through the switch.
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
		await modeButton(page, "RSVP").click();
		await expect(word(page)).toHaveText(paused);
	});

	test("a rewind in Pacer is the Position RSVP picks up", async ({ page }) => {
		await startPasted(page);
		await expect(word(page)).toHaveText(/^s[3-9]/, { timeout: 12_000 });
		await page.getByRole("button", { name: "Pause" }).click();
		await modeButton(page, "Pacer").click();
		await focusPage(page);
		await page.keyboard.press("ArrowLeft");
		const back = await nowText(page);
		expect(back).toMatch(/^s\d+a$/);
		await modeButton(page, "RSVP").click();
		await expect(word(page)).toHaveText(back);
	});

	test("M and Shift+M cycle through the modes", async ({ page }) => {
		await startPasted(page);
		await focusPage(page);
		await page.keyboard.press("m");
		await expect(modeButton(page, "Pacer")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.keyboard.press("m");
		await expect(modeButton(page, "RSVP")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.keyboard.press("Shift+m");
		await expect(modeButton(page, "Pacer")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("a reader who was playing keeps playing after the switch", async ({
		page,
	}) => {
		await startPasted(page);
		await modeButton(page, "Pacer").click();
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		const first = await nowText(page);
		await expect.poll(() => nowText(page)).not.toBe(first);
	});
});

test.describe("the document's shape", () => {
	test("renders each block kind in its own style", async ({ page }) => {
		await openDocument(page);
		const kinds = [
			"heading",
			"paragraph",
			"list-item",
			"quote",
			"code",
			"table-text",
			"caption",
			"image-placeholder",
		];
		for (const kind of kinds) {
			await expect(
				pane(page).locator(`[data-kind="${kind}"]`).first(),
			).toBeAttached();
		}
		const style = (kind: string, property: string) =>
			pane(page)
				.locator(`[data-kind="${kind}"]`)
				.first()
				.evaluate(
					(el, p) => getComputedStyle(el).getPropertyValue(p),
					property,
				);
		// Headings are heavier and larger than running text.
		expect(Number(await style("heading", "font-weight"))).toBeGreaterThan(
			Number(await style("paragraph", "font-weight")),
		);
		expect(
			Number.parseFloat(await style("heading", "font-size")),
		).toBeGreaterThan(Number.parseFloat(await style("paragraph", "font-size")));
		// Code is monospaced and keeps its lines.
		expect(await style("code", "font-family")).toMatch(/mono|courier/i);
		expect(await style("code", "white-space")).toMatch(/pre/);
		// A quote carries a heavy rule; the caption is the small type.
		expect(await style("quote", "border-left-width")).toBe("4px");
		expect(Number.parseFloat(await style("caption", "font-size"))).toBeLessThan(
			Number.parseFloat(await style("paragraph", "font-size")),
		);
		// Table text is set between rules.
		expect(await style("table-text", "border-bottom-width")).toBe("2px");
	});

	test("heads are real headings, one level under the reader's own", async ({
		page,
	}) => {
		await openDocument(page);
		await expect(
			pane(page).getByRole("heading", { name: "Heading one", level: 2 }),
		).toBeVisible();
		await expect(
			pane(page).getByRole("heading", { name: "Heading two", level: 3 }),
		).toBeVisible();
	});

	test("marks list items with bullets and numbers, and nests them", async ({
		page,
	}) => {
		await openDocument(page);
		const items = pane(page).locator('[data-kind="list-item"]');
		await expect(items).toHaveCount(5);
		await expect(items.nth(0)).toHaveAttribute("data-marker", "•");
		await expect(items.nth(3)).toHaveAttribute("data-marker", "1.");
		await expect(items.nth(4)).toHaveAttribute("data-marker", "2.");
		const indent = (n: number) =>
			items.nth(n).evaluate((el) => el.getBoundingClientRect().left);
		expect(await indent(1)).toBeGreaterThan(await indent(0));
		await expect(pane(page).getByRole("list")).toHaveCount(2);
		await expect(pane(page).getByRole("listitem")).toHaveCount(5);
	});

	test("marks the image place and shows its alt text", async ({ page }) => {
		await openDocument(page);
		const image = pane(page).locator('[data-kind="image-placeholder"]');
		await expect(image).toContainText("Image");
		await expect(image).toContainText("A red fox");
		await expect(image.locator("img")).toHaveCount(0);
	});

	test("emphasis, strong and links keep their own look", async ({ page }) => {
		await openDocument(page);
		const emphasis = pane(page).locator("[data-em]").first();
		await expect(emphasis).toContainText("emphasis");
		await expect(emphasis).toHaveCSS("font-style", "italic");
		const strong = pane(page).locator("[data-strong]").first();
		await expect(strong).toContainText("strong");
		expect(
			Number(await strong.evaluate((el) => getComputedStyle(el).fontWeight)),
		).toBeGreaterThan(500);
		const link = pane(page).getByRole("link", { name: "a safe link" });
		await expect(link).toHaveAttribute("href", "https://example.com/x");
		await expect(link).toHaveAttribute("rel", /noopener/);
		await expect(pane(page).locator('a[href^="javascript:"]')).toHaveCount(0);
	});
});

test.describe("the highlight", () => {
	test("sits on the engine's current word and moves as it plays", async ({
		page,
	}) => {
		await startPasted(page);
		await modeButton(page, "Pacer").click();
		await expect(now(page).first()).toBeVisible();
		const seen = new Set<string>();
		const start = Date.now();
		while (Date.now() - start < 6000 && seen.size < 4) {
			seen.add(await nowText(page));
			await page.waitForTimeout(60);
		}
		expect(seen.size).toBeGreaterThanOrEqual(4);
		for (const text of seen) expect(text).toMatch(/^s\d+[abc]\.?$/);
	});

	test("words read turn faint, the word ahead stays plain ink", async ({
		page,
	}) => {
		await startPasted(page);
		await expect(word(page)).toHaveText(/^s[3-9]/, { timeout: 12_000 });
		await modeButton(page, "Pacer").click();
		await page.getByRole("button", { name: "Pause" }).click();
		const current = now(page).first();
		const colour = (target: Locator) =>
			target.evaluate((el) => getComputedStyle(el).color);
		const read = pane(page).locator('[data-state="read"]').first();
		const ahead = pane(page).locator('[data-state="ahead"]').first();
		await expect(read).toBeAttached();
		expect(await colour(read)).not.toBe(await colour(ahead));
		// The current word has the heavy ink of text to read and nothing else vermilion.
		expect(await colour(current)).toBe(await colour(ahead));
	});

	test("vermilion marks the current word and nothing else in the text", async ({
		page,
	}) => {
		await openDocument(page);
		const red = await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--color-red")
				.trim(),
		);
		expect(red).not.toBe("");
		const offenders = await pane(page).evaluate((root, colour) => {
			const probe = document.createElement("span");
			probe.style.color = colour;
			document.body.append(probe);
			const rgb = getComputedStyle(probe).color;
			probe.remove();
			const bad: string[] = [];
			for (const el of root.querySelectorAll<HTMLElement>("*")) {
				const style = getComputedStyle(el);
				const isNow = el.getAttribute("data-state") === "now";
				const hasRed = [
					style.color,
					style.backgroundColor,
					style.boxShadow,
					style.borderLeftColor,
					style.borderTopColor,
					style.textDecorationColor,
				].some((value) => value.includes(rgb));
				if (hasRed && !isNow) bad.push(el.outerHTML.slice(0, 80));
			}
			return bad;
		}, red);
		expect(offenders).toEqual([]);
		// And the current word does carry it.
		const shadow = await now(page)
			.first()
			.evaluate((el) => getComputedStyle(el).boxShadow);
		expect(shadow).not.toBe("none");
	});

	test("keeps the current line in view while playing and after a far seek", async ({
		page,
	}) => {
		await openDocument(page);
		const slider = page.getByRole("slider", { name: "Reading speed" });
		await slider.focus();
		await page.keyboard.press("End");
		await focusPage(page);
		await page.keyboard.press("k");
		await expect
			.poll(() => pane(page).evaluate((el) => el.scrollTop), {
				timeout: 20_000,
			})
			.toBeGreaterThan(100);
		for (let i = 0; i < 5; i++) {
			expect(await inView(page, NOW)).toBe(true);
			await page.waitForTimeout(200);
		}
		await page.keyboard.press("k");
		await page.getByRole("slider", { name: "Reading progress" }).focus();
		await page.keyboard.press("End");
		await expect(now(page).first()).toContainText(/last|words\./);
		expect(await inView(page, NOW)).toBe(true);
		await page.keyboard.press("Home");
		await expect(now(page).first()).toHaveText("Heading");
		expect(await inView(page, NOW)).toBe(true);
		expect(await pane(page).evaluate((el) => el.scrollTop)).toBe(0);
	});

	test("a seek to a chapter or a rewind moves the highlight while paused", async ({
		page,
	}) => {
		await openDocument(page);
		await page.getByRole("slider", { name: "Reading progress" }).focus();
		await page.keyboard.press("End");
		const last = await nowText(page);
		await focusPage(page);
		await page.keyboard.press("ArrowLeft");
		await expect.poll(() => nowText(page)).not.toBe(last);
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
	});
});

test.describe("a very long block", () => {
	// 6 000 words in one paragraph: only the stretch around the reader is split into words.
	const LONG = Array.from({ length: 6000 }, (_, i) => `w${i + 1}`).join(" ");

	test("keeps the node count bounded and the highlight right across seeks", async ({
		page,
	}) => {
		await startPasted(page, LONG);
		await page.getByRole("button", { name: "Pause" }).click();
		await modeButton(page, "Pacer").click();
		await expect.poll(() => nowText(page)).toMatch(/^w\d+$/);
		const nodes = () =>
			pane(page).evaluate((el) => el.querySelectorAll("span").length);
		expect(await nodes()).toBeLessThan(3000);
		const progress = page.getByRole("slider", { name: "Reading progress" });
		await progress.focus();
		await page.keyboard.press("End");
		await expect.poll(() => nowText(page)).toBe("w6000");
		expect(await inView(page, NOW)).toBe(true);
		expect(await nodes()).toBeLessThan(3000);
		await page.keyboard.press("Home");
		await expect.poll(() => nowText(page)).toBe("w1");
		expect(await inView(page, NOW)).toBe(true);
		// Back by sentences walks the highlight through a renewed window.
		await page.keyboard.press("End");
		await expect.poll(() => nowText(page)).toBe("w6000");
		await page.evaluate(() => (document.activeElement as HTMLElement).blur());
		await page.keyboard.press("Shift+ArrowLeft");
		await expect.poll(() => nowText(page)).toBe("w1");
	});
});

test.describe("keyboard", () => {
	test("Space and K play and pause, the arrows rewind and change speed", async ({
		page,
	}) => {
		await startPasted(page);
		await modeButton(page, "Pacer").click();
		await focusPage(page);
		await page.keyboard.press("Space");
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
		await page.keyboard.press("k");
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		await page.keyboard.press("k");
		await page.keyboard.press("ArrowUp");
		await expect(
			page.getByRole("slider", { name: "Reading speed" }),
		).toHaveAttribute("aria-valuenow", "260");
		await expect(word(page)).toHaveCount(0);
	});

	test("the scrolling text is a labelled region the keyboard can reach", async ({
		page,
	}) => {
		await openDocument(page);
		const region = page.getByRole("region", { name: "Running text" });
		await expect(region).toHaveAttribute("tabindex", "0");
		await region.focus();
		await expect(region).toBeFocused();
	});

	test("the chapter list and the progress slider work from Pacer", async ({
		page,
	}) => {
		await openDocument(page);
		await page.getByRole("button", { name: "Chapters" }).click();
		await page.getByRole("button", { name: "Heading two" }).click();
		await expect.poll(() => nowText(page)).toBe("Heading");
		await expect(
			pane(page).getByRole("heading", { name: "Heading two" }),
		).toBeVisible();
		expect(await inView(page, '[data-kind="heading"][data-level="2"]')).toBe(
			true,
		);
	});
});

test.describe("hidden tab", () => {
	const hide = (page: Page) =>
		page.evaluate(() => {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => "hidden",
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});

	test("Pacer pauses when the tab is hidden and stays paused", async ({
		page,
	}) => {
		await startPasted(page);
		await modeButton(page, "Pacer").click();
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		await hide(page);
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
		const held = await nowText(page);
		await page.waitForTimeout(500);
		expect(await nowText(page)).toBe(held);
	});

	test("so does RSVP", async ({ page }) => {
		await startPasted(page);
		await hide(page);
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
	});
});

test.describe("reduced motion", () => {
	test("the text scrolls and the highlight moves with no animation", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await openDocument(page);
		await expect(pane(page)).toHaveCSS("scroll-behavior", "auto");
		const motion = await pane(page).evaluate((root) =>
			[root, ...root.querySelectorAll<HTMLElement>("*")].some((el) => {
				const style = getComputedStyle(el);
				return (
					style.animationName !== "none" ||
					Number.parseFloat(style.transitionDuration) > 0.001
				);
			}),
		);
		expect(motion).toBe(false);
	});

	test("without the preference the highlight still moves with no transition", async ({
		page,
	}) => {
		await openDocument(page);
		const duration = await now(page)
			.first()
			.evaluate((el) => getComputedStyle(el).transitionDuration);
		expect(Number.parseFloat(duration)).toBe(0);
	});
});

test.describe("accessibility and fit", () => {
	for (const viewport of [
		{ name: "390px", width: 390, height: 844 },
		{ name: "desktop", width: 1280, height: 800 },
	]) {
		test(`axe passes on Pacer at ${viewport.name}, and it fits`, async ({
			page,
		}) => {
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await openDocument(page);
			await page.evaluate(() => document.fonts.ready);
			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();
			expect(results.violations).toEqual([]);
			const fits = await page.evaluate(() => ({
				page: document.documentElement.scrollWidth <= window.innerWidth,
				pane:
					(document
						.querySelector('[data-testid="pacer"]')
						?.getBoundingClientRect().right ?? 0) <= window.innerWidth,
			}));
			expect(fits).toEqual({ page: true, pane: true });
		});
	}

	test("axe passes on Pacer in the Night theme while playing", async ({
		page,
	}) => {
		await openDocument(page);
		await page.getByRole("button", { name: "Night theme" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
		await page.getByRole("button", { name: "Play" }).click();
		await page.getByRole("button", { name: "Pause" }).click();
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
			.analyze();
		expect(results.violations).toEqual([]);
	});

	test("the Night theme turns the faint words and the highlight to Night values", async ({
		page,
	}) => {
		await openDocument(page);
		await page.getByRole("button", { name: "Night theme" }).click();
		await page.getByRole("slider", { name: "Reading progress" }).focus();
		await page.keyboard.press("End");
		const read = pane(page).locator('[data-state="read"]').first();
		await expect(read).toHaveCSS("color", "rgb(143, 143, 136)");
		await expect(now(page).first()).toHaveCSS("color", "rgb(236, 236, 230)");
	});
});
