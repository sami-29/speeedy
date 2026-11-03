import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const TITLE = "Speeedy: Free Online Speed Reader, No Account";
const DESCRIPTION =
	"Paste text or open a PDF, EPUB or DOCX and read it word by word at a pace you choose. Free, open source, no account, nothing uploaded.";
const TEXT =
	`one two three four five six seven eight nine ten eleven twelve ${"more ".repeat(60)}`.trim();

// Everything the build wrote that a crawler can fetch as a page: `index.html` is `/`,
// `foo.html` is `/foo`. The fallback page and the app routes are not public pages.
function prerenderedPublicPaths(): string[] {
	const root = join(process.cwd(), "build");
	const paths: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (entry.name === "_app") continue;
				walk(join(dir, entry.name), `${prefix}/${entry.name}`);
			} else if (entry.name.endsWith(".html")) {
				const name = entry.name.slice(0, -".html".length);
				if (name === "200") continue;
				paths.push(name === "index" ? prefix || "/" : `${prefix}/${name}`);
			}
		}
	};
	walk(root, "");
	const app = ["/reader", "/library", "/stats", "/training", "/s", "/account"];
	return paths
		.filter((p) => !app.some((a) => p === a || p.startsWith(`${a}/`)))
		.sort();
}

test.describe("front door: prerendered HTML", () => {
	test("carries the title, description, canonical and share tags without JavaScript", async ({
		request,
	}) => {
		const html = await (await request.get("/")).text();
		expect(html).toContain(`<title>${TITLE}</title>`);
		expect(html).toContain(`<meta name="description" content="${DESCRIPTION}"`);
		expect(html).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/"/);
		expect(html).toContain(`<meta property="og:title" content="${TITLE}"`);
		expect(html).toContain(
			`<meta property="og:description" content="${DESCRIPTION}"`,
		);
		expect(html).toMatch(
			/<meta property="og:image" content="https?:\/\/[^"]+\/og-image\.png"/,
		);
		expect(html).toContain('<meta property="og:image:width" content="1200"');
		expect(html).toContain('<meta property="og:image:height" content="630"');
		expect(html).toMatch(/<meta property="og:image:alt" content="[^"]+"/);
		expect(html).toContain(
			'<meta name="twitter:card" content="summary_large_image"',
		);
	});

	test("has the paste box and the Spreeder line in the HTML", async ({
		request,
	}) => {
		const html = await (await request.get("/")).text();
		expect(html).toContain("Text to read");
		expect(html).toMatch(
			/<a[^>]*href="\/spreeder-alternative"[^>]*>\s*A free, open-source alternative to Spreeder\s*<\/a>/,
		);
		expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
	});

	test("never promises a speed multiplier or the best", async ({ request }) => {
		const html = await (await request.get("/")).text();
		const body = html
			.replace(/<script[\s\S]*?<\/script>/g, "")
			.replace(/<style[\s\S]*?<\/style>/g, "")
			.replace(/<[^>]+>/g, " ");
		expect(body).not.toMatch(/\bbest\b/i);
		expect(body).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
	});

	test("links the comparison page under its route (the page itself is ticket 63)", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(
			page.getByRole("link", {
				name: "A free, open-source alternative to Spreeder",
			}),
		).toHaveAttribute("href", "/spreeder-alternative");
	});

	test("the og image is served at 1200 by 630", async ({ request }) => {
		const response = await request.get("/og-image.png");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("image/png");
		const bytes = await response.body();
		expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
			1200, 630,
		]);
	});
});

test.describe("paste or drop box", () => {
	test("paste, Start opens the reader and reads the text", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await expect(page.getByTestId("wpm")).toHaveText("250 WPM");
		await expect(page.getByTestId("word")).toHaveText(/^(two|three|four)$/, {
			timeout: 4000,
		});
	});

	test("Start with nothing pasted says so and stays on the page", async ({
		page,
	}) => {
		await page.goto("/");
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page.getByRole("alert")).toHaveText("Paste some text first.");
		await expect(page).toHaveURL(/\/$/);
	});

	test("choosing a file opens the reader with it", async ({ page }) => {
		await page.goto("/");
		await page.locator('input[type="file"]').setInputFiles({
			name: "note.txt",
			mimeType: "text/plain",
			buffer: Buffer.from(TEXT),
		});
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("one");
	});

	test("dropping a file on the box opens the reader with it", async ({
		page,
	}) => {
		await page.goto("/");
		const box = page.getByTestId("paste-box");
		const data = await page.evaluateHandle((text) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File([text], "dropped.txt", { type: "text/plain" }));
			return transfer;
		}, TEXT);
		await box.dispatchEvent("dragover", { dataTransfer: data });
		await box.dispatchEvent("drop", { dataTransfer: data });
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("one");
	});

	test("a file the reader cannot open gets a message there, not a crash", async ({
		page,
	}) => {
		await page.goto("/");
		await page.locator('input[type="file"]').setInputFiles({
			name: "book.xyz",
			mimeType: "application/octet-stream",
			buffer: Buffer.from([0, 1, 2, 3, 4, 5]),
		});
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByRole("alert")).toBeVisible();
	});

	test("the text never goes into the URL or a request", async ({ page }) => {
		const secret = "kumquat-marmalade-zebra";
		const urls: string[] = [];
		page.on("request", (r) => urls.push(`${r.url()} ${r.postData() ?? ""}`));
		await page.goto("/");
		await page.getByRole("textbox", { name: "Text to read" }).fill(secret);
		await page.getByRole("button", { name: "Start" }).click();
		await expect(page).toHaveURL(/\/reader$/);
		expect(urls.filter((u) => u.includes(secret))).toEqual([]);
	});
});

test.describe("robots.txt", () => {
	test("allows every crawler and points to the sitemap", async ({ request }) => {
		const response = await request.get("/robots.txt");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("text/plain");
		const text = await response.text();
		expect(text).toMatch(/^User-agent: \*$/m);
		expect(text).toMatch(/^Allow: \/$/m);
		expect(text).not.toMatch(/^Disallow:\s*\S/m);
		expect(text).toMatch(/^Sitemap: https?:\/\/[^\s]+\/sitemap\.xml$/m);
		expect(response.headers()["x-robots-tag"]).toBeUndefined();
	});
});

test.describe("sitemap.xml", () => {
	test("lists absolute URLs on the configured origin, with real lastmod dates", async ({
		request,
	}) => {
		const robots = await (await request.get("/robots.txt")).text();
		const origin = new URL(
			(/^Sitemap: (\S+)$/m.exec(robots) as RegExpExecArray)[1] as string,
		).origin;

		const response = await request.get("/sitemap.xml");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("xml");
		const xml = await response.text();
		const entries = [
			...xml.matchAll(
				/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g,
			),
		];
		expect(entries.length).toBeGreaterThan(0);
		const today = new Date().toISOString().slice(0, 10);
		for (const [, loc, lastmod] of entries) {
			expect(new URL(loc as string).origin).toBe(origin);
			expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(Number.isNaN(Date.parse(lastmod as string))).toBe(false);
			expect((lastmod as string) <= today).toBe(true);
		}
	});

	test("lists exactly the prerendered public routes, each of which loads", async ({
		request,
	}) => {
		const xml = await (await request.get("/sitemap.xml")).text();
		const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
			.map((m) => new URL(m[1] as string).pathname)
			.sort();
		expect(paths).toEqual(prerenderedPublicPaths());
		for (const path of paths) {
			expect((await request.get(path)).status(), path).toBe(200);
		}
	});

	test("leaves out the app routes", async ({ request }) => {
		const xml = await (await request.get("/sitemap.xml")).text();
		for (const route of ["/reader", "/library", "/stats", "/training", "/s"]) {
			expect(xml).not.toContain(`${route}</loc>`);
		}
		expect((await request.get("/sitemap.xml")).headers()["x-robots-tag"]).toBe(
			undefined,
		);
	});
});

test.describe("indexing", () => {
	test("public routes carry no noindex, in the HTML or a header", async ({
		request,
	}) => {
		for (const path of ["/", "/robots.txt", "/sitemap.xml", "/og-image.png"]) {
			const response = await request.get(path);
			expect(response.headers()["x-robots-tag"], path).toBeUndefined();
			if (path === "/") {
				expect(await response.text()).not.toMatch(
					/<meta[^>]*name="robots"[^>]*>/,
				);
			}
		}
	});

	test("the app routes still say noindex", async ({ request }) => {
		for (const path of ["/reader", "/library", "/stats", "/training", "/s"]) {
			expect(await (await request.get(path)).text(), path).toMatch(
				/<meta[^>]*name="robots"[^>]*content="noindex"/,
			);
		}
	});
});
