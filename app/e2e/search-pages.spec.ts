import { expect, test } from "@playwright/test";

const TEXT =
	`one two three four five six seven eight nine ten eleven twelve ${"more ".repeat(60)}`.trim();

const PAGES = [
	{
		path: "/pdf-speed-reader",
		title: "PDF Speed Reader, Free Online, No Upload | Speeedy",
		description:
			"Open a PDF and speed read it word by word or with a guided highlight. The file never leaves your device. Free, no account, works offline.",
		wpm: "250 WPM",
	},
	{
		path: "/epub-speed-reader",
		title: "EPUB Speed Reader, Free in Your Browser | Speeedy",
		description:
			"Open a DRM-free EPUB and read it with RSVP, Pacer or Listen, picking up where you left off. Free, no account, the book stays on your device.",
		wpm: "250 WPM",
	},
	{
		path: "/adhd-reading-tool",
		title: "ADHD Reading Tool: One Word at a Time | Speeedy",
		description:
			"Read one word at a time in a fixed spot, at a steady pace. A small 2025 study found this helped students with ADHD at about 200 WPM. Free, no account.",
		wpm: "220 WPM",
	},
	{
		path: "/text-to-speech-reader",
		title: "Free Text to Speech Reader with Word Highlight | Speeedy",
		description:
			"Hear your text read aloud while each word lights up as it's spoken. The built-in voice runs on your device, offline, after a one-time 31 MB download.",
		wpm: "250 WPM",
	},
	{
		path: "/spreeder-alternative",
		title: "Free Spreeder Alternative, Open Source | Speeedy",
		description: undefined,
		wpm: "250 WPM",
	},
] as const;

// How the HTML writes an apostrophe in an attribute or the title.
const htmlEscape = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/'/g, "&#39;");

const bodyText = (html: string) =>
	html
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<style[\s\S]*?<\/style>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ");

for (const page of PAGES) {
	test.describe(`${page.path}`, () => {
		test("prerenders the title, a description, the canonical and the share tags", async ({
			request,
		}) => {
			const response = await request.get(page.path);
			expect(response.status()).toBe(200);
			const html = await response.text();
			expect(html).toContain(`<title>${htmlEscape(page.title)}</title>`);
			const description = /<meta name="description" content="([^"]+)"/.exec(
				html,
			)?.[1];
			expect(description).toBeTruthy();
			expect((description ?? "").length).toBeLessThanOrEqual(160);
			if (page.description) expect(description).toBe(page.description);
			expect(html).toContain(
				`<meta property="og:title" content="${htmlEscape(page.title)}"`,
			);
			expect(html).toMatch(
				new RegExp(`<link rel="canonical" href="https?://[^"]+${page.path}"`),
			);
			expect(html).toContain(
				'<meta name="twitter:card" content="summary_large_image"',
			);
			expect(html).not.toMatch(/<meta[^>]*name="robots"/);
			expect(response.headers()["x-robots-tag"]).toBeUndefined();
		});

		test("has one h1, the paste box and its own sections in the HTML", async ({
			request,
		}) => {
			const html = await (await request.get(page.path)).text();
			expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
			expect(html).toContain("Text to read");
			expect(html).toContain('data-testid="paste-box"');
			expect(html.match(/<h2[\s>]/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
		});

		test("never promises a speed multiplier or the best", async ({
			request,
		}) => {
			const body = bodyText(await (await request.get(page.path)).text());
			expect(body).not.toMatch(/\bbest\b/i);
			expect(body).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
		});

		test("fits at 390px with no sideways scrolling", async ({ page: tab }) => {
			await tab.setViewportSize({ width: 390, height: 844 });
			await tab.goto(page.path);
			await tab.evaluate(() => document.fonts.ready);
			const overflow = await tab.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});

		test("paste, Start opens the reader and reads the text", async ({
			page: tab,
		}) => {
			await tab.goto(page.path);
			await tab.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
			await tab.getByRole("button", { name: "Start" }).click();
			await expect(tab).toHaveURL(/\/reader$/);
			await expect(tab.getByTestId("word")).toHaveText(/\S/);
			await expect(tab.getByTestId("wpm")).toHaveText(page.wpm);
		});

		test("Start with nothing pasted says so and stays on the page", async ({
			page: tab,
		}) => {
			await tab.goto(page.path);
			await tab.getByRole("button", { name: "Start" }).click();
			await expect(tab.getByRole("alert")).toHaveText("Paste some text first.");
			await expect(tab).toHaveURL(new RegExp(`${page.path}$`));
		});

		test("choosing a file opens the reader with it", async ({ page: tab }) => {
			await tab.goto(page.path);
			await tab.locator('input[type="file"]').setInputFiles({
				name: "note.txt",
				mimeType: "text/plain",
				buffer: Buffer.from(TEXT),
			});
			await expect(tab).toHaveURL(/\/reader$/);
			// Reading starts at once, so on a loaded machine the first word may be gone.
			await expect(tab.getByTestId("word")).toHaveText(
				/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|more)$/,
			);
			await expect(tab.getByTestId("wpm")).toHaveText(page.wpm);
		});
	});
}

test.describe("/pdf-speed-reader content", () => {
	test("says what parses and what to do with a scan", async ({ request }) => {
		const body = bodyText(
			await (await request.get("/pdf-speed-reader")).text(),
		);
		expect(body).toContain(
			"This PDF is a scan: it holds pictures of pages, not text. Paste the text instead.",
		);
		expect(body).toContain("OCR");
		expect(body).toContain("100 MB");
	});
});

test.describe("/adhd-reading-tool content", () => {
	test("names the study's limits next to the claim", async ({ request }) => {
		const body = bodyText(
			await (await request.get("/adhd-reading-tool")).text(),
		);
		expect(body).toContain("Moussaoui");
		expect(body).toContain("38");
		expect(body).toContain("initial step");
		expect(body).toMatch(/about 200 (WPM|words per minute)/);
		expect(body).toMatch(/220 (WPM|words per minute)/);
		expect(body).not.toMatch(/bionic|font|overlay/i);
	});

	test("the preset starts the reader at 220 WPM, and the speed can still change", async ({
		page,
	}) => {
		await page.goto("/adhd-reading-tool");
		await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page.getByTestId("wpm")).toHaveText("220 WPM");
		await page.getByRole("button", { name: "Faster" }).click();
		await expect(page.getByTestId("wpm")).toHaveText("230 WPM");
	});

	test("the front door still starts at 250 WPM after a preset visit", async ({
		page,
	}) => {
		await page.goto("/adhd-reading-tool");
		await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page.getByTestId("wpm")).toHaveText("220 WPM");
		await page.goto("/");
		await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page.getByTestId("wpm")).toHaveText("250 WPM");
	});
});

test.describe("/text-to-speech-reader content", () => {
	test("explains the download and the browser-voice fallback", async ({
		request,
	}) => {
		const body = bodyText(
			await (await request.get("/text-to-speech-reader")).text(),
		);
		expect(body).toContain("31 MB");
		expect(body).toMatch(/fallback/i);
		expect(body).toMatch(/sentence/i);
	});
});

test.describe("/spreeder-alternative content", () => {
	test("prints the checked-on date and states no price", async ({
		request,
	}) => {
		const body = bodyText(
			await (await request.get("/spreeder-alternative")).text(),
		);
		expect(body).toMatch(/checked on 21 October 2026/i);
		expect(body).toContain("200 words");
		expect(body).not.toMatch(/[$£€]\s?\d/);
	});

	test("the front door's Spreeder line now reaches a real page", async ({
		page,
	}) => {
		await page.goto("/");
		await page
			.getByRole("link", {
				name: "A free, open-source alternative to Spreeder",
			})
			.click();
		await expect(page).toHaveURL(/\/spreeder-alternative$/);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	});

	test("links Spreeder's own pages", async ({ request }) => {
		const html = await (await request.get("/spreeder-alternative")).text();
		expect(html).toMatch(/href="https:\/\/www\.spreeder\.com\/app\.html"/);
	});
});
