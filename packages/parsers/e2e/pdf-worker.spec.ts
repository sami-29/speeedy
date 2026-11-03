import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import { PDF_PRECACHE_EXCLUDE } from "../src/precache";
import { buildPdf } from "../test/pdf-builder";

/**
 * pdf.js inside the parser worker, in a real browser. The build is the one the production
 * build will use (an ES module worker with code splitting), so this proves four things:
 * pdf.js runs from inside the parser worker, its code is fetched only when a PDF is opened,
 * a file built to keep it busy is stopped by the time limit (which only works if pdf.js is
 * in a worker of its own that can be killed), and its files can be kept out of the service
 * worker precache.
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

async function openBase64(
	page: Page,
	data: string,
	fileName: string,
	hints?: { maxMillis?: number },
): Promise<Outcome> {
	return page.evaluate(
		([payload, file, limits]) =>
			window.parseBase64(
				payload as string,
				file as string,
				limits as { maxMillis?: number } | undefined,
			),
		[data, fileName, hints],
	) as Promise<Outcome>;
}

const open = (page: Page, name: string, fileName = name) =>
	openBase64(page, base64(name), fileName);

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

test("stops a small file that would keep pdf.js busy for minutes", async ({
	page,
}) => {
	await ready(page, []);
	// Four million drawing operators that draw nothing: about 100 KB on disk, and minutes of
	// work for pdf.js to interpret.
	const operators = new TextEncoder().encode("q Q\n");
	const stream = new Uint8Array(operators.length * 4_000_000);
	for (let i = 0; i < 4_000_000; i++)
		stream.set(operators, i * operators.length);
	const bomb = buildPdf({
		pages: [
			{
				content: {
					data: deflateSync(stream, { level: 9 }),
					filter: "FlateDecode",
				},
			},
		],
	});
	const started = Date.now();
	const outcome = await openBase64(
		page,
		Buffer.from(bomb).toString("base64"),
		"bomb.pdf",
		{ maxMillis: 3000 },
	);
	expect(outcome).toMatchObject({ ok: false, reason: "too-big" });
	expect(Date.now() - started).toBeLessThan(15_000);
	// The parser worker is still there and the next file reads normally.
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
	const pdf = assets.filter((file) => /pdf/i.test(file));
	// Every PDF.js file (the library, its worker, the worker's loader) is caught by the pattern,
	// and nothing else is.
	expect(pdf.some((file) => file.startsWith("pdf.worker"))).toBe(true);
	expect(pdf.some((file) => /^pdf-/.test(file))).toBe(true);
	for (const file of assets) {
		expect(PDF_PRECACHE_EXCLUDE.test(`assets/${file}`), file).toBe(
			pdf.includes(file),
		);
	}
	// Nothing outside the PDF files imports them up front, so they stay lazy.
	const entry = readFileSync(join(dist, "index.html"), "utf8");
	expect(entry).not.toMatch(/pdf/i);
	for (const file of assets.filter(
		(f) => !pdf.includes(f) && f.endsWith(".js"),
	)) {
		const code = readFileSync(join(dist, "assets", file), "utf8");
		expect(code, file).not.toMatch(/^import[^\n]*["']\.\/pdf/m);
		expect(code, file).not.toMatch(/^export[^\n]*from\s*["']\.\/pdf/m);
	}
});
