import type { Page, Request } from "@playwright/test";
import { DEV_EXTENSION_ID } from "@speeedy/contracts";
import {
	ARTICLE_TITLE,
	ARTICLE_URL,
	EVIL_ORIGIN,
	expect,
	test,
} from "./fixtures.ts";

/** What the toolbar button does: start the launcher for the tab with the article. */
async function launchFromArticleTab(worker: import("@playwright/test").Worker) {
	await worker.evaluate(async () => {
		const [tab] = await chrome.tabs.query({ url: "http://articles.test/*" });
		(
			globalThis as unknown as { speeedyLaunch(tab: unknown): void }
		).speeedyLaunch(tab);
	});
}

type LibraryRow = { title: string; sourceUrl: string | null; source: string };

/** The Library's documents, read straight from the page's IndexedDB. */
async function libraryRows(page: Page): Promise<LibraryRow[]> {
	return page.evaluate(
		() =>
			new Promise<LibraryRow[]>((resolve, reject) => {
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
						resolve(all.result as LibraryRow[]);
					};
					all.onerror = () => reject(all.error);
				};
			}),
	);
}

test("the extension has the development ID the app trusts", ({
	extensionId,
}) => {
	expect(extensionId).toBe(DEV_EXTENSION_ID);
});

test("a page sent from the browser opens as a Library document in a Speeedy tab", async ({
	context,
	worker,
}) => {
	const requests: Request[] = [];
	context.on("request", (request) => requests.push(request));

	const article = await context.newPage();
	await article.goto(ARTICLE_URL);

	const speeedy = context.waitForEvent("page", {
		predicate: (page) => page.url().startsWith("http://localhost"),
	});
	await launchFromArticleTab(worker);
	const tab = await speeedy;

	await expect(tab).toHaveURL(/\/reader$/);
	await expect(tab.getByTestId("word")).toHaveText(/\S/);

	// It is a Library document with its title and the address it came from.
	await tab.goto("/library");
	await expect(
		tab.getByRole("row").filter({ hasText: ARTICLE_TITLE }),
	).toHaveCount(1);
	const rows = await libraryRows(tab);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		title: ARTICLE_TITLE,
		sourceUrl: ARTICLE_URL,
		source: "own",
	});

	// The extension's relay tab closed itself once Speeedy had the page.
	await expect
		.poll(
			() =>
				context.pages().filter((p) => p.url().startsWith("chrome-extension://"))
					.length,
		)
		.toBe(0);

	// Nothing went anywhere with the page: no request carries its text or its address,
	// except loading the page itself.
	for (const request of requests) {
		const url = request.url();
		const body = request.postData() ?? "";
		if (url.startsWith(ARTICLE_URL)) continue;
		expect(url, url).not.toMatch(/articles\.test|lighthouse|staircase/i);
		expect(body, url).not.toMatch(
			/articles\.test|lighthouse|staircase|Anders/i,
		);
	}
});

test("the Speeedy tab keeps nothing when a web page posts a look-alike message", async ({
	context,
	baseURL,
}) => {
	await context.route(`${EVIL_ORIGIN}/**`, (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><p>evil</p>",
		}),
	);
	const evil = await context.newPage();
	await evil.goto(EVIL_ORIGIN);

	// This page opens Speeedy, so Speeedy's opener is a web page, and keeps posting a message
	// that is valid in every way but its origin.
	const received = await evil.evaluate(
		async ({ target }) => {
			const page = {
				type: "speeedy:page",
				version: 1,
				title: "Planted",
				url: "https://evil.example/planted",
				language: "en",
				document: {
					version: 1,
					blocks: [
						{ kind: "paragraph", text: "Planted by a web page.", spans: [] },
					],
				},
			};
			const heard: unknown[] = [];
			window.addEventListener("message", (event) => heard.push(event.data));
			const child = window.open(`${target}/library`, "_blank");
			if (!child) return { opened: false, heard };
			// Keep posting until Speeedy has loaded and said it is ready, then for a second more,
			// so the check below runs against a receiver that was listening.
			const started = Date.now();
			let readyAt = 0;
			while (Date.now() - started < 30_000) {
				child.postMessage(page, "*");
				if (readyAt === 0 && heard.length > 0) readyAt = Date.now();
				if (readyAt !== 0 && Date.now() - readyAt > 1000) break;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			return { opened: true, heard };
		},
		{ target: baseURL as string },
	);
	expect(received.opened).toBe(true);

	const library = context
		.pages()
		.find((page) => page.url().endsWith("/library"));
	expect(library).toBeDefined();
	await expect(library as Page).toHaveURL(/\/library$/);
	expect(await libraryRows(library as Page)).toEqual([]);
	// Speeedy told the page it was ready and answered nothing else: no ack, no refusal.
	expect(received.heard).toEqual([{ type: "speeedy:ready", version: 1 }]);
});
