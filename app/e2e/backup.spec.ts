import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { CANARY } from "@speeedy/contracts";

// Ticket #32: the Library's backup file, downloaded from /library and restored from it on a
// fresh browser profile. Nothing here touches a server: the file goes through the browser only.

const TEXT = `${CANARY} ${Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(" ")}`;
const VIEWPORTS = [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
];

async function paste(page: Page, text: string) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(page.getByTestId("word")).toHaveText(/\S/);
}

async function download(page: Page): Promise<{ path: string; name: string }> {
	await page.goto("/library");
	const pending = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download backup" }).click();
	const file = await pending;
	const path = await file.path();
	return { path, name: file.suggestedFilename() };
}

async function freshProfile(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	return context.newPage();
}

const status = (page: Page) => page.getByTestId("backup-status");
const rows = (page: Page, title: string) =>
	page.getByRole("row").filter({ hasText: title });

test.describe("backup file", () => {
	test("downloads one versioned JSON with the Library in it and no source address", async ({
		page,
	}) => {
		await paste(page, `Backed up notes\n\n${TEXT}`);
		await page.getByRole("button", { name: "Pause" }).click();
		const { path, name } = await download(page);
		expect(name).toMatch(/^speeedy-backup-\d{4}-\d{2}-\d{2}\.json$/);
		const raw = readFileSync(path, "utf8");
		const file = JSON.parse(raw) as {
			format: string;
			version: number;
			documents: { title: string; document: { blocks: { text: string }[] } }[];
			sessions: unknown[];
		};
		expect(file.format).toBe("speeedy-backup");
		expect(file.version).toBe(1);
		expect(file.documents.map((each) => each.title)).toContain(
			"Backed up notes",
		);
		expect(raw).toContain("word60");
		expect(raw).not.toContain("sourceUrl");
		await expect(status(page)).toContainText("Backup downloaded");
	});

	test("restores the file on a fresh browser profile, and a second restore adds nothing", async ({
		page,
		browser,
	}) => {
		await paste(page, `Carried over\n\n${TEXT}`);
		await page.getByRole("button", { name: "Pause" }).click();
		const { path } = await download(page);

		const other = await freshProfile(browser);
		await other.goto("/library");
		await expect(other.getByTestId("library-empty")).toBeVisible();
		await other.getByTestId("backup-file").setInputFiles(path);
		await expect(status(other)).toContainText("Restored");
		await expect(rows(other, "Carried over")).toHaveCount(1);

		await other.getByTestId("backup-file").setInputFiles(path);
		await expect(status(other)).toContainText("Already here: 1");
		await expect(rows(other, "Carried over")).toHaveCount(1);

		// and it opens in the reader, at its place
		await other.getByRole("button", { name: "Read Carried over" }).click();
		await expect(other.getByTestId("word")).toHaveText(/\S/);
		await other.context().close();
	});

	test("refuses a file from a newer version with a plain message and changes nothing", async ({
		page,
	}) => {
		await paste(page, `Stays put\n\n${TEXT}`);
		await page.getByRole("button", { name: "Pause" }).click();
		await page.goto("/library");
		await page.getByTestId("backup-file").setInputFiles({
			name: "from-the-future.json",
			mimeType: "application/json",
			buffer: Buffer.from(
				JSON.stringify({ format: "speeedy-backup", version: 999 }),
			),
		});
		await expect(
			page
				.getByRole("alert")
				.filter({ hasText: "Update Speeedy to open this file" }),
		).toBeVisible();
		await expect(rows(page, "Stays put")).toHaveCount(1);
	});

	for (const [label, content] of [
		["a text file", "just some words"],
		["another kind of JSON", '{"hello":"world"}'],
		[
			"a damaged backup",
			'{"format":"speeedy-backup","version":1,"documents":7}',
		],
	] as const) {
		test(`refuses ${label} in plain language and changes nothing`, async ({
			page,
		}) => {
			await page.goto("/library");
			await page.getByTestId("backup-file").setInputFiles({
				name: "odd.json",
				mimeType: "application/json",
				buffer: Buffer.from(content),
			});
			const alert = page.getByTestId("backup-status");
			await expect(alert).toContainText("Nothing was changed");
			await expect(alert).toHaveAttribute("role", "alert");
			await expect(page.getByTestId("library-empty")).toBeVisible();
		});
	}

	test("sends nothing over the network, and no text in any URL or body", async ({
		page,
		browser,
	}) => {
		const seen: string[] = [];
		const watch = (target: Page) =>
			target.on("request", (request) => {
				const url = new URL(request.url());
				if (url.protocol === "data:" || url.protocol === "blob:") return;
				seen.push(
					`${request.method()} ${request.url()} ${request.postData() ?? ""}`,
				);
			});
		watch(page);
		await paste(page, `Private notes\n\n${TEXT}`);
		await page.getByRole("button", { name: "Pause" }).click();
		const { path } = await download(page);
		const other = await freshProfile(browser);
		watch(other);
		await other.goto("/library");
		await other.getByTestId("backup-file").setInputFiles(path);
		await expect(status(other)).toContainText("Restored");
		await other.context().close();
		const marks = seen.filter((line) => line.includes(CANARY));
		expect(marks).toEqual([]);
		const posts = seen.filter(
			(line) => !line.startsWith("GET ") && !line.includes("/api/e"),
		);
		expect(posts).toEqual([]);
	});
});

test.describe("backup panel accessibility", () => {
	for (const viewport of VIEWPORTS) {
		test(`axe passes at ${viewport.name}, empty, after a restore and after a refusal`, async ({
			page,
		}) => {
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			const scan = async () => {
				const results = await new AxeBuilder({ page }).analyze();
				expect(results.violations).toEqual([]);
			};
			await page.goto("/library");
			await expect(page.getByRole("heading", { name: "Backup" })).toBeVisible();
			await scan();

			await page.getByTestId("backup-file").setInputFiles({
				name: "odd.json",
				mimeType: "application/json",
				buffer: Buffer.from("not json"),
			});
			await expect(status(page)).toContainText("Nothing was changed");
			await scan();

			await page.getByTestId("backup-file").setInputFiles({
				name: "mine.json",
				mimeType: "application/json",
				buffer: Buffer.from(
					JSON.stringify({
						format: "speeedy-backup",
						version: 1,
						exportedAt: 1_700_000_000_000,
						documents: [],
						sessions: [],
						trainingResults: [],
						dailyGoalChanges: [],
						settings: [],
					}),
				),
			});
			await expect(status(page)).toContainText("Restored");
			await scan();
			await expect(
				page.getByRole("button", { name: "Download backup" }),
			).toBeVisible();
			// no horizontal scroll at phone width
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth,
			);
			expect(overflow).toBe(false);
		});
	}
});
