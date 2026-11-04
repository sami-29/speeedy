import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";

const TEXT = Array.from({ length: 200 }, (_, i) => `word${i + 1}`).join(" ");

/** Load the app and wait until the service worker has precached and taken over the page. */
async function installed(page: Page, origin = "") {
	await page.goto(`${origin}/reader`);
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** The path of every request held by every cache the page's origin has. */
async function cachedPaths(page: Page): Promise<Record<string, string[]>> {
	return page.evaluate(async () => {
		const result: Record<string, string[]> = {};
		for (const name of await caches.keys()) {
			const cache = await caches.open(name);
			result[name] = (await cache.keys()).map(
				(request) => new URL(request.url).pathname,
			);
		}
		return result;
	});
}

async function readText(page: Page, text: string) {
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(page.getByTestId("word")).toHaveText(/\S/);
}

test.describe("install", () => {
	test("serves a manifest the browser accepts, and the page links it", async ({
		page,
		request,
	}) => {
		const response = await request.get("/manifest.webmanifest");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toMatch(/json/);
		await installed(page);
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
			"href",
			"/manifest.webmanifest",
		);
		const cdp = await page.context().newCDPSession(page);
		const { url, errors } = await cdp.send("Page.getAppManifest");
		expect(url).toMatch(/\/manifest\.webmanifest$/);
		expect(errors.map((e) => e.message)).toEqual([]);
		const { installabilityErrors } = await cdp.send(
			"Page.getInstallabilityErrors",
		);
		expect(installabilityErrors).toEqual([]);
	});
});

test.describe("precache", () => {
	test("holds the app shell and the parsers, and no PDF, voice or model file", async ({
		page,
	}) => {
		await installed(page);
		const caches = await cachedPaths(page);
		const names = Object.keys(caches);
		expect(names).toHaveLength(1);
		expect(names[0]).toMatch(/^speeedy-precache-/);
		const paths = caches[names[0] as string] as string[];

		for (const shell of [
			"/",
			"/reader",
			"/library",
			"/stats",
			"/training",
			"/s",
			"/account/offline",
			"/manifest.webmanifest",
			"/fonts/archivo-wdth.woff2",
			"/icons/icon-192.png",
			"/icons/icon-512.png",
			"/icons/icon-maskable-512.png",
		])
			expect(paths, shell).toContain(shell);
		expect(
			paths.some((p) => /^\/_app\/immutable\/entry\/start\./.test(p)),
		).toBe(true);
		// The parser worker (and the Timeline worker) are plain `workers/worker-<hash>.js`.
		expect(
			paths.filter((p) =>
				/^\/_app\/immutable\/workers\/worker-[\w-]{8}\.js$/.test(p),
			).length,
		).toBeGreaterThanOrEqual(2);

		expect(
			paths.filter((p) =>
				/pdf|kokoro|ort-wasm|\.wasm$|\.onnx$|\.bin$|\/workers\/(?:chunks|assets)\//i.test(
					p,
				),
			),
		).toEqual([]);
		// Public pages are not part of the offline free core.
		for (const page of ["/learn", "/pdf-speed-reader", "/reader/voice-lab"])
			expect(paths, page).not.toContain(page);
	});

	test("never touches the voice cache", async ({ page }) => {
		await page.goto("/reader");
		await page.evaluate(async () => {
			const cache = await caches.open("speeedy-kokoro-v1");
			await cache.put("/kokoro-test-file", new Response("model bytes"));
		});
		await installed(page);
		await page.reload();
		await page.evaluate(async () => navigator.serviceWorker.ready);
		const names = await page.evaluate(() => caches.keys());
		expect(names).toContain("speeedy-kokoro-v1");
	});
});

test.describe("offline", () => {
	test("the reader reloads offline, stays isolated, and reads pasted text", async ({
		page,
		context,
	}) => {
		await installed(page);
		await context.setOffline(true);
		const response = await page.goto("/reader");
		expect(response?.status()).toBe(200);
		await expect(
			page.getByRole("heading", { level: 1, name: /./ }),
		).toBeVisible();
		// The service worker must not break the isolation the on-device voice threads need.
		expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
		expect(response?.headers()["x-robots-tag"]).toBe("noindex");
		await readText(page, TEXT);
		await expect(page.getByTestId("word")).toHaveText(/word\d+/);
	});

	test("the Library reloads offline with the documents already kept", async ({
		page,
		context,
	}) => {
		await installed(page);
		await readText(page, `Offline Title\n\n${TEXT}`);
		await context.setOffline(true);
		await page.goto("/library");
		await expect(
			page.getByRole("table", { name: "Your documents" }),
		).toBeVisible();
		await expect(
			page.getByRole("row").filter({ hasText: "Offline Title" }),
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole("row").filter({ hasText: "Offline Title" }),
		).toBeVisible();
	});

	test("the landing page and a page the shell does not hold still open offline", async ({
		page,
		context,
	}) => {
		await installed(page);
		await context.setOffline(true);
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		// Not precached: the shell is served and the client router draws the page.
		await page.goto("/learn");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	});

	test("opening a PDF offline fails with a message, not a blank page", async ({
		page,
		context,
	}) => {
		await installed(page);
		await context.setOffline(true);
		await page.goto("/reader");
		await page.locator('input[type="file"]').setInputFiles({
			name: "paper.pdf",
			mimeType: "application/pdf",
			buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"),
		});
		await expect(page.getByRole("alert")).toBeVisible();
		await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
	});
});

/**
 * A pass-through server in front of the app that can serve a "next version" of the service
 * worker: the same script with another build version. (A test cannot route the browser's own
 * update check for the worker script, so the update has to come from a real server.)
 */
async function appWithNextVersion(target: string) {
	const state = { next: false };
	const server: Server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", target);
			const upstream = await fetch(url, { redirect: "manual" });
			const headers: Record<string, string> = {};
			upstream.headers.forEach((value, name) => {
				if (
					!["content-encoding", "content-length", "transfer-encoding"].includes(
						name,
					)
				)
					headers[name] = value;
			});
			let body = Buffer.from(await upstream.arrayBuffer());
			if (state.next && url.pathname === "/service-worker.js")
				body = Buffer.from(
					body.toString().replace(/version:`\d+`/, "version:`next`"),
				);
			response.writeHead(upstream.status, headers);
			response.end(body);
		} catch {
			response.writeHead(502);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${port}`,
		publishNextVersion: () => {
			state.next = true;
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

test.describe("update", () => {
	test("a new version waits, the reader is told in a plain line, and Update takes over", async ({
		page,
		baseURL,
	}) => {
		const app = await appWithNextVersion(baseURL as string);
		try {
			await installed(page, app.origin);
			const line = page.getByRole("status").filter({ hasText: /new version/i });
			await expect(line).toHaveCount(0);
			const precaches = () =>
				page.evaluate(async () =>
					(await caches.keys()).filter((name) =>
						name.startsWith("speeedy-precache-"),
					),
				);
			expect(await precaches()).toHaveLength(1);

			app.publishNextVersion();
			await page.evaluate(async () => {
				const registration = await navigator.serviceWorker.getRegistration();
				await registration?.update();
			});
			await expect(line).toBeVisible();
			// It is a line, not a popup.
			await expect(page.getByRole("dialog")).toHaveCount(0);
			// The new version is installed and waiting; the old one is still in charge, and
			// still has its cache, so the page open now keeps the scripts it loaded with.
			expect(
				await page.evaluate(async () => {
					const registration = await navigator.serviceWorker.getRegistration();
					return registration?.waiting !== null;
				}),
			).toBe(true);
			expect(await precaches()).toHaveLength(2);

			const reloaded = page.waitForEvent("load");
			await line.getByRole("button", { name: "Update" }).click();
			await reloaded;
			await expect(
				page.getByRole("textbox", { name: "Text to read" }),
			).toBeVisible();
			await expect(line).toHaveCount(0);
			// The old version's cache is gone and the new one serves the page.
			await expect.poll(precaches).toEqual(["speeedy-precache-next"]);
			expect(
				await page.evaluate(
					async () =>
						(await navigator.serviceWorker.getRegistration())?.waiting,
				),
			).toBeNull();
		} finally {
			await app.close();
		}
	});
});

test.describe("Web Share Target", () => {
	test("shared text becomes a Library document with its title and a local-only source URL", async ({
		page,
	}) => {
		const requests: string[] = [];
		page.on("request", (request) => requests.push(request.url()));
		const query = new URLSearchParams({
			title: "A Shared Article",
			text: `${TEXT}`,
			url: "https://news.example/story?id=7",
		});
		await page.goto(`/reader?${query}`);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		// The shared text does not stay in the address bar.
		await expect.poll(() => new URL(page.url()).search).toBe("");

		await page.goto("/library");
		await expect(
			page.getByRole("row").filter({ hasText: "A Shared Article" }),
		).toBeVisible();
		const kept = await page.evaluate(
			() =>
				new Promise<{ title: string; sourceUrl: string | null }[]>(
					(resolve, reject) => {
						const open = indexedDB.open("speeedy-library");
						open.onerror = () => reject(open.error);
						open.onsuccess = () => {
							const all = open.result
								.transaction("documents")
								.objectStore("documents")
								.getAll();
							all.onsuccess = () => resolve(all.result);
						};
					},
				),
		);
		expect(kept).toHaveLength(1);
		expect(kept[0]?.sourceUrl).toBe("https://news.example/story?id=7");
		// Nothing about the share went anywhere.
		expect(
			requests.filter(
				(url) =>
					/news\.example|word1\b/.test(url) && !url.includes("localhost"),
			),
		).toEqual([]);
	});

	test("a link with no text says so and keeps nothing", async ({ page }) => {
		const query = new URLSearchParams({
			title: "Only A Link",
			url: "https://news.example/story",
		});
		await page.goto(`/reader?${query}`);
		await expect(page.getByRole("alert")).toContainText(/link/i);
		await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
		await expect.poll(() => new URL(page.url()).search).toBe("");
		await page.goto("/library");
		await expect(
			page.getByRole("row").filter({ hasText: "Only A Link" }),
		).toHaveCount(0);
	});
});

test.describe("file handlers", () => {
	test("a file the OS launches the app with opens in the reader", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const holder: { consumer?: (params: unknown) => unknown } = {};
			Object.defineProperty(window, "launchQueue", {
				value: {
					setConsumer(fn: (params: unknown) => unknown) {
						holder.consumer = fn;
					},
				},
			});
			Object.defineProperty(window, "__launch", {
				value: (name: string, text: string) =>
					holder.consumer?.({
						files: [{ getFile: async () => new File([text], name) }],
					}),
			});
		});
		await page.goto("/reader");
		await expect(
			page.getByRole("textbox", { name: "Text to read" }),
		).toBeVisible();
		await page.evaluate(
			([name, text]) =>
				(
					window as unknown as { __launch(n: string, t: string): void }
				).__launch(name as string, text as string),
			["launched.txt", TEXT],
		);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await page.goto("/library");
		await expect(
			page.getByRole("row").filter({ hasText: "launched" }),
		).toBeVisible();
	});
});

test.describe("iOS Add to Home Screen", () => {
	test.describe("on an iPhone", () => {
		test.use({
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			hasTouch: true,
		});

		test("shows a plain line, not a popup", async ({ page }) => {
			await page.goto("/reader");
			const hint = page.getByText(/Add to Home Screen/);
			await expect(hint).toBeVisible();
			expect(await hint.evaluate((el) => el.tagName)).toBe("P");
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await expect(page.getByRole("alertdialog")).toHaveCount(0);
		});
	});

	test("is not shown on a desktop browser", async ({ page }) => {
		await page.goto("/reader");
		await expect(
			page.getByRole("textbox", { name: "Text to read" }),
		).toBeVisible();
		await expect(page.getByText(/Add to Home Screen/)).toHaveCount(0);
	});
});
