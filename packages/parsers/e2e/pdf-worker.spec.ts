import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { PDF_PRECACHE_EXCLUDE } from "../src/precache";

/**
 * pdf.js inside the parser worker, in a real browser. The build is the one the production
 * build will use (an ES module worker with code splitting), so this proves three things:
 * the library runs inside the worker with no second worker or worker URL, it is fetched
 * only when a PDF is opened, and its files can be kept out of the service worker precache.
 */
const fixtures = join(import.meta.dirname, "..", "test", "fixtures", "pdf");
const dist = join(import.meta.dirname, "dist");

const base64 = (name: string) =>
	readFileSync(join(fixtures, name)).toString("base64");

type Outcome =
	| {
			ok: true;
			document: { blocks: { kind: string; text: string }[] };
			format: string;
	  }
	| { ok: false; reason: string; message: string };

async function open(
	page: Page,
	name: string,
	fileName = name,
): Promise<Outcome> {
	return page.evaluate(
		([data, file]) => window.parseBase64(data as string, file as string),
		[base64(name), fileName],
	) as Promise<Outcome>;
}

async function ready(page: Page, requests: string[]) {
	page.on("request", (request) =>
		requests.push(new URL(request.url()).pathname),
	);
	await page.goto("/");
	await page.waitForFunction(() => window.parserReady === true);
}

test("opens a real PDF in the worker and returns its paragraphs", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await ready(page, []);
	const outcome = await open(page, "article-block-paragraphs.pdf");
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) return;
	expect(outcome.format).toBe("pdf");
	const expected = JSON.parse(
		readFileSync(
			join(
				import.meta.dirname,
				"..",
				"fixtures-src",
				"pdf",
				"article-block-paragraphs.paragraphs.json",
			),
			"utf8",
		),
	) as string[];
	expect(outcome.document.blocks.map((b) => b.text)).toEqual(expected);
	expect(errors).toEqual([]);
});

test("returns the typed errors for a scan and a locked file", async ({
	page,
}) => {
	await ready(page, []);
	expect(await open(page, "scanned-page.pdf")).toMatchObject({
		ok: false,
		reason: "scanned-pdf",
	});
	expect(await open(page, "locked-user-password.pdf")).toMatchObject({
		ok: false,
		reason: "drm",
	});
	expect(await open(page, "blank-page.pdf")).toMatchObject({
		ok: false,
		reason: "empty",
	});
});

test("keeps working after a damaged file", async ({ page }) => {
	await ready(page, []);
	const damaged = await page.evaluate(async (data) => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).slice(
			0,
			700,
		);
		let text = "";
		for (const byte of bytes) text += String.fromCharCode(byte);
		return window.parseBase64(btoa(text), "damaged.pdf");
	}, base64("paper-two-column.pdf"));
	expect((damaged as Outcome).ok).toBe(false);
	expect((await open(page, "textbook-pages.pdf")).ok).toBe(true);
});

test("fetches the PDF code only when a PDF is opened", async ({ page }) => {
	const requests: string[] = [];
	await ready(page, requests);
	const text = btoa("Plain text is not a PDF, so no PDF code is needed.");
	await page.evaluate((data) => window.parseBase64(data, "plain.txt"), text);
	expect(requests.filter((r) => /pdf/i.test(r))).toEqual([]);
	await open(page, "article-block-paragraphs.pdf");
	expect(requests.some((r) => /pdf\.worker/.test(r))).toBe(true);
});

test("names the PDF.js files so the service worker can leave them out of its precache", async () => {
	const assets = readdirSync(join(dist, "assets"));
	const pdf = assets.filter((file) =>
		PDF_PRECACHE_EXCLUDE.test(`assets/${file}`),
	);
	expect(pdf.some((file) => file.startsWith("pdf.worker"))).toBe(true);
	expect(pdf.some((file) => /^pdf-/.test(file))).toBe(true);
	const others = assets.filter((file) => !pdf.includes(file));
	for (const file of others) {
		expect(PDF_PRECACHE_EXCLUDE.test(`assets/${file}`), file).toBe(false);
	}
	// The page and the parser worker only reach the PDF code through a dynamic import.
	const entry = readFileSync(join(dist, "index.html"), "utf8");
	expect(entry).not.toMatch(/pdf/i);
	const worker = assets.find((file) => file.startsWith("worker-")) ?? "";
	const head = readFileSync(join(dist, "assets", worker), "utf8");
	expect(head).not.toMatch(/^import[^;]*pdf/m);
});
