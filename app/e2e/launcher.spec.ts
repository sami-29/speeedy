import { expect, type Page, test } from "@playwright/test";

// The launcher extension opens /library and posts it a page. These tests are the other side of
// that: a web page opens /library and posts messages that look right, and nothing is kept.
// The extension itself is exercised by the e2e run in the extension package.

const EVIL = "http://evil.test";

const page = (overrides: Record<string, unknown> = {}) => ({
	type: "speeedy:page",
	version: 1,
	title: "Planted",
	url: "https://evil.example/planted",
	language: "en",
	document: {
		version: 1,
		blocks: [{ kind: "paragraph", text: "Planted by a web page.", spans: [] }],
	},
	...overrides,
});

/** Open /library from a page on another origin and keep posting `payloads` at it. */
async function attack(
	evil: Page,
	target: string,
	payloads: unknown[],
): Promise<unknown[]> {
	return evil.evaluate(
		async ({ target, payloads }) => {
			const heard: unknown[] = [];
			window.addEventListener("message", (event) => heard.push(event.data));
			const child = window.open(`${target}/library`, "_blank");
			if (!child) throw new Error("the page could not open Speeedy");
			// Keep posting until Speeedy has loaded and said it is ready, then for a second more,
			// so the checks that follow run against a receiver that was listening.
			const started = Date.now();
			let readyAt = 0;
			while (Date.now() - started < 30_000) {
				for (const payload of payloads) child.postMessage(payload, "*");
				if (readyAt === 0 && heard.length > 0) readyAt = Date.now();
				if (readyAt !== 0 && Date.now() - readyAt > 1000) break;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			return heard;
		},
		{ target, payloads },
	);
}

async function libraryTitles(library: Page): Promise<string[]> {
	return library.evaluate(
		() =>
			new Promise<string[]>((resolve, reject) => {
				const open = indexedDB.open("speeedy-library");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains("documents")) {
						db.close();
						resolve([]);
						return;
					}
					const all = db
						.transaction("documents")
						.objectStore("documents")
						.getAll();
					all.onsuccess = () => {
						db.close();
						resolve((all.result as { title: string }[]).map((d) => d.title));
					};
				};
			}),
	);
}

test.describe("a web page that opens /library and posts to it", () => {
	test("keeps nothing, and learns nothing but that Speeedy is ready", async ({
		context,
		baseURL,
	}) => {
		await context.route(`${EVIL}/**`, (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><p>evil</p>",
			}),
		);
		const evil = await context.newPage();
		await evil.goto(EVIL);

		const oversized = page({
			document: {
				version: 1,
				blocks: Array.from({ length: 60_000 }, () => ({
					kind: "paragraph",
					text: "x",
					spans: [],
				})),
			},
		});
		const heard = await attack(evil, baseURL as string, [
			page(),
			oversized,
			{ type: "speeedy:page" },
			"<script>alert(1)</script>",
			null,
		]);

		const library = context
			.pages()
			.find((candidate) => candidate.url().endsWith("/library"));
		expect(library).toBeDefined();
		await expect(library as Page).toHaveURL(/\/library$/);
		expect(await libraryTitles(library as Page)).toEqual([]);
		expect(heard).toEqual([{ type: "speeedy:ready", version: 1 }]);
	});

	test("cannot add to a Library that already has a document", async ({
		context,
		page: tab,
		baseURL,
	}) => {
		await tab.goto("/reader");
		await tab
			.getByRole("textbox", { name: "Text to read" })
			.fill("Mine alone.");
		await tab.getByRole("button", { name: "Start" }).click();
		await expect(tab.getByTestId("word")).toHaveText(/\S/);

		await context.route(`${EVIL}/**`, (route) =>
			route.fulfill({
				contentType: "text/html",
				body: "<!doctype html><p>evil</p>",
			}),
		);
		const evil = await context.newPage();
		await evil.goto(EVIL);
		await attack(evil, baseURL as string, [page()]);

		await tab.goto("/library");
		expect(await libraryTitles(tab)).toEqual(["Mine alone."]);
	});
});
