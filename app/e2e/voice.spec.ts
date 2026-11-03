import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const MODEL_HOSTS = /huggingface\.co|hf\.co|raw\.githubusercontent\.com/;
const cacheDir = join(import.meta.dirname, "../../packages/kokoro/.cache");
// Same keys as KOKORO_ASSETS in packages/kokoro/src/assets.ts.
const cached = {
	"onnx/model.onnx": "kokoro-7m/onnx/model.onnx",
	"voices/af_msa.bin": "kokoro-7m/voices/af_msa.bin",
	"us_gold.json": "misaki/us_gold.json",
	"us_silver.json": "misaki/us_silver.json",
};
const modelCached = Object.values(cached).every((key) =>
	existsSync(join(cacheDir, key)),
);

/** Answer model and lexicon requests from the local cache, so the test never downloads. */
async function serveAssetsFromCache(page: Page) {
	await page.route(MODEL_HOSTS, async (route) => {
		const url = route.request().url();
		const entry = Object.entries(cached).find(([suffix]) =>
			url.endsWith(suffix),
		);
		if (!entry) return route.abort();
		const bytes = readFileSync(join(cacheDir, entry[1]));
		const range = /^bytes=(\d+)-(\d+)$/.exec(
			route.request().headers().range ?? "",
		);
		if (!range) return route.fulfill({ status: 200, body: bytes });
		const from = Number(range[1]);
		const to = Math.min(Number(range[2]), bytes.length - 1);
		return route.fulfill({
			status: 206,
			body: bytes.subarray(from, to + 1),
			headers: {
				"Content-Range": `bytes ${from}-${to}/${bytes.length}`,
				"Access-Control-Allow-Origin": "*",
			},
		});
	});
}

test.describe("cross-origin isolation", () => {
	test("is sent on /reader and nowhere else", async ({ request }) => {
		for (const path of ["/reader", "/reader/voice-lab"]) {
			const headers = (await request.get(path)).headers();
			expect(headers["cross-origin-opener-policy"], path).toBe("same-origin");
			expect(headers["cross-origin-embedder-policy"], path).toBe(
				"credentialless",
			);
		}
		for (const path of ["/", "/library", "/s", "/account"]) {
			const headers = (await request.get(path)).headers();
			expect(headers["cross-origin-opener-policy"], path).toBeUndefined();
			expect(headers["cross-origin-embedder-policy"], path).toBeUndefined();
		}
	});

	test("makes the reader isolated, so the voice worker runs threaded WASM", async ({
		page,
	}) => {
		await page.goto("/reader/voice-lab");
		expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
		await expect(page.getByTestId("voice-isolated")).toHaveText("yes");
		const cores = await page.evaluate(() => navigator.hardwareConcurrency);
		const threads = Number(
			await page.getByTestId("voice-threads").textContent(),
		);
		expect(threads).toBe(Math.min(4, Math.ceil(cores / 2)));
		if (cores >= 3) expect(threads).toBeGreaterThan(1);
	});

	test("still works without isolation, on one thread", async ({ page }) => {
		await page.route("**/reader/voice-lab", async (route) => {
			const response = await route.fetch();
			const headers = { ...response.headers() };
			delete headers["cross-origin-opener-policy"];
			delete headers["cross-origin-embedder-policy"];
			await route.fulfill({ response, headers });
		});
		await page.goto("/reader/voice-lab");
		expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
		await expect(page.getByTestId("voice-isolated")).toHaveText("no");
		await expect(page.getByTestId("voice-threads")).toHaveText("1");
		await expect(page.getByRole("button", { name: /download/i })).toBeEnabled();
	});
});

test.describe("voice download", () => {
	test("asks before downloading and touches no model host until then", async ({
		page,
	}) => {
		const hits: string[] = [];
		page.on("request", (request) => {
			if (MODEL_HOSTS.test(request.url())) hits.push(request.url());
		});
		await page.goto("/reader/voice-lab");
		const consent = page.getByRole("button", { name: /download/i });
		await expect(consent).toContainText("37.3 MB");
		await page.waitForTimeout(500);
		expect(hits).toEqual([]);
	});
});

test.describe("real model", () => {
	test.skip(
		!modelCached,
		"needs the model in packages/kokoro/.cache (pnpm --filter @speeedy/kokoro fetch:assets)",
	);
	test("speaks a sentence with the real model and records its real-time factor", async ({
		page,
	}) => {
		test.setTimeout(180_000);
		await serveAssetsFromCache(page);
		await page.goto("/reader/voice-lab");
		await page.getByRole("button", { name: /download/i }).click();
		await expect(page.getByTestId("voice-state")).toHaveText("ready", {
			timeout: 120_000,
		});
		await page.getByRole("button", { name: /generate/i }).click();
		await expect(page.getByTestId("voice-words")).toHaveText("9", {
			timeout: 60_000,
		});
		const rtf = Number(await page.getByTestId("voice-rtf").textContent());
		expect(rtf).toBeGreaterThan(0);
		console.log(
			`Kokoro-7M RTF ${rtf.toFixed(3)} on ${await page.getByTestId("voice-threads").textContent()} threads`,
		);
		// A second visit loads from the cache, without the network.
		await page.unrouteAll();
		await page.route(MODEL_HOSTS, (route) => route.abort());
		await page.reload();
		await expect(page.getByTestId("voice-downloaded")).toHaveText("yes");
	});
});
