import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WORDS = Array.from({ length: 400 }, (_, i) => `word${i + 1}`);
const TEXT = WORDS.join(" ");

async function paste(page: Page, text: string) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(page.getByTestId("word")).toHaveText(/\S/);
}

const rowFor = (page: Page, title: string) =>
	page.getByRole("row").filter({ hasText: title });

test.describe("resume", () => {
	test("a refresh on /reader resumes the document at its Position", async ({
		page,
	}) => {
		await paste(page, TEXT);
		await expect(page.getByTestId("word")).not.toHaveText("word1", {
			timeout: 4000,
		});
		await page.getByRole("button", { name: "Pause" }).click();
		const paused = (await page.getByTestId("word").textContent()) ?? "";
		const index = WORDS.indexOf(paused);
		expect(index).toBeGreaterThan(0);

		await page.reload();
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		const resumed = (await page.getByTestId("word").textContent()) ?? "";
		expect(WORDS.indexOf(resumed)).toBeGreaterThanOrEqual(index);
		expect(WORDS.indexOf(resumed)).toBeLessThan(index + 8);
	});

	test("pasting text adds it to the Library with its progress", async ({
		page,
	}) => {
		await paste(page, `Heading words\n\n${TEXT}`);
		await page.getByRole("button", { name: "Pause" }).click();
		await page.goto("/library");
		const row = rowFor(page, "Heading words");
		await expect(row).toHaveCount(1);
		await expect(row).toContainText("%");
	});

	test("New text clears the current document, so a refresh shows the panel", async ({
		page,
	}) => {
		await paste(page, TEXT);
		await page.getByRole("button", { name: "New text" }).click();
		await page.reload();
		await expect(page.getByTestId("start-panel")).toBeVisible();
		await expect(page.getByTestId("word")).toHaveCount(0);
	});
});

test.describe("the Library", () => {
	test("shows sample documents to a first-time reader and opens one as a demo", async ({
		page,
	}) => {
		await page.goto("/library");
		await expect(page.getByTestId("library-empty")).toBeVisible();
		const sample = page.getByRole("button", { name: /^Read sample:/ }).first();
		await expect(sample).toBeVisible();
		await sample.click();
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await expect(page.getByTestId("reader-source")).toHaveAttribute(
			"data-source",
			"demo",
		);
	});

	test("pasting in the panel adds the document and opens the reader", async ({
		page,
	}) => {
		await page.goto("/library");
		await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
		await page.getByRole("button", { name: "Add and read" }).click();
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("word1");
	});

	test("renames a document", async ({ page }) => {
		await paste(page, `Old name\n\n${TEXT}`);
		await page.goto("/library");
		await page.getByRole("button", { name: "Edit Old name" }).click();
		await page.getByRole("textbox", { name: "Title" }).fill("Brand new name");
		await page.getByRole("button", { name: "Save" }).click();
		await expect(rowFor(page, "Brand new name")).toHaveCount(1);
		await page.reload();
		await expect(rowFor(page, "Brand new name")).toHaveCount(1);
	});

	test("delete shows Undo for five seconds, and Undo brings the document back", async ({
		page,
	}) => {
		await paste(page, `Doomed one\n\n${TEXT}`);
		await page.goto("/library");
		await expect(rowFor(page, "Doomed one")).toHaveCount(1);
		await page.getByRole("button", { name: "Delete Doomed one" }).click();
		await expect(rowFor(page, "Doomed one")).toHaveCount(0);
		const undo = page.getByRole("button", { name: "Undo" });
		await expect(undo).toBeVisible();
		await undo.click();
		await expect(rowFor(page, "Doomed one")).toHaveCount(1);
	});

	test("the Undo goes away after five seconds and the delete stays", async ({
		page,
	}) => {
		await paste(page, `Gone for good\n\n${TEXT}`);
		await page.goto("/library");
		await page.getByRole("button", { name: "Delete Gone for good" }).click();
		const undo = page.getByRole("button", { name: "Undo" });
		await expect(undo).toBeVisible();
		await expect(undo).toBeHidden({ timeout: 8000 });
		await page.reload();
		await expect(rowFor(page, "Gone for good")).toHaveCount(0);
	});

	test("overrides a document's language", async ({ page }) => {
		await paste(page, `Mots\n\n${TEXT}`);
		await page.goto("/library");
		await page.getByRole("button", { name: "Edit Mots" }).click();
		await page.getByRole("combobox", { name: "Language" }).selectOption("fr");
		await page.getByRole("button", { name: "Save" }).click();
		// Save closes the form only once the write has committed. Reloading before then aborts it.
		await expect(page.getByRole("button", { name: "Save" })).toBeHidden();
		await page.reload();
		await page.getByRole("button", { name: "Edit Mots" }).click();
		await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue(
			"fr",
		);
	});

	test("titles and contents never leave the page", async ({ page }) => {
		const seen: string[] = [];
		page.on("request", (request) => {
			seen.push(`${request.url()} ${request.postData() ?? ""}`);
		});
		await paste(page, `Zebrafish canary title\n\ncanarycontentword ${TEXT}`);
		await page.getByRole("button", { name: "Pause" }).click();
		await page.goto("/library");
		await page
			.getByRole("button", { name: "Edit Zebrafish canary title" })
			.click();
		await page
			.getByRole("textbox", { name: "Title" })
			.fill("Quokka renamed canary");
		await page.getByRole("button", { name: "Save" }).click();
		await expect(page.getByText("Quokka renamed canary")).toBeVisible();
		await page.waitForTimeout(500);
		const everything = seen.join("\n").toLowerCase();
		for (const canary of ["zebrafish", "canarycontentword", "quokka"]) {
			expect(everything).not.toContain(canary);
		}
	});
});

for (const viewport of [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
]) {
	test(`axe passes on the Library at ${viewport.name}`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await paste(page, `Axe title\n\n${TEXT}`);
		await page.getByRole("button", { name: "Pause" }).click();
		await page.goto("/library");
		await expect(rowFor(page, "Axe title")).toHaveCount(1);
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
	});
}
