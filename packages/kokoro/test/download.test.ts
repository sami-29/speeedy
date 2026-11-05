import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	type Asset,
	assetStatus,
	cacheStore,
	downloadAsset,
	IntegrityError,
	KOKORO_ASSETS,
	memoryStore,
	TOTAL_DOWNLOAD_BYTES,
} from "../src/index";

const body = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 251);
const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

const asset: Asset = {
	key: "test/asset.bin",
	url: "https://example.test/asset.bin",
	bytes: body.length,
	sha256: sha256(body),
};

type Plan = {
	status?: number;
	ignoreRange?: boolean;
	fail?: (n: number, range: string) => "throw" | "short" | undefined;
};

/** A fake server for `body` that honours Range requests and logs what it was asked. */
function server(plan: Plan = {}, content = body) {
	const requests: string[] = [];
	const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
		const range = new Headers(init?.headers).get("Range") ?? "";
		requests.push(range);
		const failure = plan.fail?.(requests.length, range);
		if (failure === "throw") throw new TypeError("network dropped");
		if (plan.status) return new Response("nope", { status: plan.status });
		const match = /^bytes=(\d+)-(\d+)$/.exec(range);
		if (!match || plan.ignoreRange) {
			return new Response(content.slice(), { status: 200 });
		}
		const from = Number(match[1]);
		const to = Math.min(Number(match[2]), content.length - 1);
		let part = content.slice(from, to + 1);
		if (failure === "short") part = part.slice(0, part.length - 10);
		expect(String(url)).toBe(asset.url);
		return new Response(part, {
			status: 206,
			headers: { "Content-Range": `bytes ${from}-${to}/${content.length}` },
		});
	};
	return { fetch: fetcher as typeof fetch, requests };
}

describe("downloadAsset", () => {
	it("fetches the asset in Range parts and returns the verified bytes", async () => {
		const { fetch, requests } = server();
		const bytes = await downloadAsset(asset, {
			fetch,
			store: memoryStore(),
			partSize: 256,
		});
		expect(bytes).toEqual(body);
		expect(requests).toEqual([
			"bytes=0-255",
			"bytes=256-511",
			"bytes=512-767",
			"bytes=768-999",
		]);
	});

	it("retries only the part that failed when the connection drops mid-download", async () => {
		const { fetch, requests } = server({
			fail: (n) => (n === 3 ? "throw" : n === 5 ? "short" : undefined),
		});
		const bytes = await downloadAsset(asset, {
			fetch,
			store: memoryStore(),
			partSize: 256,
			retryDelayMs: 0,
		});
		expect(bytes).toEqual(body);
		expect(requests).toEqual([
			"bytes=0-255",
			"bytes=256-511",
			"bytes=512-767",
			"bytes=512-767",
			"bytes=768-999",
			"bytes=768-999",
		]);
	});

	it("resumes from the stored parts after giving up, without fetching them again", async () => {
		const store = memoryStore();
		const broken = server({
			fail: (_n, range) => (range === "bytes=512-767" ? "throw" : undefined),
		});
		await expect(
			downloadAsset(asset, {
				fetch: broken.fetch,
				store,
				partSize: 256,
				retries: 2,
				retryDelayMs: 0,
			}),
		).rejects.toThrow();
		expect(broken.requests.filter((r) => r === "bytes=512-767")).toHaveLength(
			3,
		);
		const { fetch, requests } = server();
		expect(await downloadAsset(asset, { fetch, store, partSize: 256 })).toEqual(
			body,
		);
		expect(requests).toEqual(["bytes=512-767", "bytes=768-999"]);
	});

	it("accepts a server that ignores Range and sends the whole file", async () => {
		const { fetch } = server({ ignoreRange: true });
		expect(
			await downloadAsset(asset, {
				fetch,
				store: memoryStore(),
				partSize: 256,
			}),
		).toEqual(body);
	});

	it("rejects bytes whose sha256 does not match and keeps nothing of them", async () => {
		const tampered = body.slice();
		tampered[600] = (tampered[600] ?? 0) ^ 1;
		const store = memoryStore();
		const { fetch } = server({}, tampered);
		await expect(
			downloadAsset(asset, { fetch, store, partSize: 256 }),
		).rejects.toBeInstanceOf(IntegrityError);
		expect(await store.keys()).toEqual([]);
		expect((await assetStatus([asset], store))[asset.key]).toBe(false);
	});

	it("fails after the retries on an HTTP error", async () => {
		const { fetch, requests } = server({ status: 404 });
		await expect(
			downloadAsset(asset, {
				fetch,
				store: memoryStore(),
				partSize: 256,
				retries: 1,
				retryDelayMs: 0,
			}),
		).rejects.toThrow(/404/);
		expect(requests).toHaveLength(2);
	});

	it("serves a cached asset offline, with no network at all", async () => {
		const store = memoryStore();
		await downloadAsset(asset, { fetch: server().fetch, store, partSize: 256 });
		const offline = (() => {
			throw new Error("offline");
		}) as unknown as typeof fetch;
		expect(await downloadAsset(asset, { fetch: offline, store })).toEqual(body);
		expect(await assetStatus([asset], store)).toEqual({ [asset.key]: true });
	});

	it("reports progress that only grows and ends at the asset size", async () => {
		const seen: number[] = [];
		await downloadAsset(asset, {
			fetch: server({ fail: (n) => (n === 2 ? "throw" : undefined) }).fetch,
			store: memoryStore(),
			partSize: 256,
			retryDelayMs: 0,
			onProgress: (loaded) => seen.push(loaded),
		});
		expect(seen.at(-1)).toBe(1000);
		expect([...seen].sort((a, b) => a - b)).toEqual(seen);
	});

	it("stops when aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			downloadAsset(asset, {
				fetch: server().fetch,
				store: memoryStore(),
				signal: controller.signal,
			}),
		).rejects.toThrow(/abort/i);
	});
});

describe("Kokoro assets", () => {
	it("pins the model, voice and lexicon to fixed revisions with their sha256", () => {
		expect(KOKORO_ASSETS.model.url).toBe(
			"https://huggingface.co/mrfakename/Kokoro-7M-Distill-ONNX/resolve/2b3cb7963716406d0596568588ea360da6b168ce/onnx/model.onnx",
		);
		expect(KOKORO_ASSETS.model.sha256).toBe(
			"14b6a25d57a05ebf28893f421af4086dd56f86f70ef0f2b74c7539515aeab041",
		);
		expect(KOKORO_ASSETS.voice.sha256).toBe(
			"129d447a7c9bdce1d5b6cb5ecb789bbfd9f427b7775131a97dfa5638583b3b92",
		);
		for (const pinned of Object.values(KOKORO_ASSETS)) {
			expect(pinned.url).toMatch(/\/[0-9a-f]{40}\//);
			expect(pinned.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
		expect(TOTAL_DOWNLOAD_BYTES).toBe(
			30_649_897 + 522_240 + 3_000_469 + 3_099_517,
		);
	});
});

describe("cacheStore", () => {
	it("lists only the voice's own files when the cache also keeps its runtime", async () => {
		const entries = new Map<string, Response>();
		const store = cacheStore(async () => ({
			async match(url: string) {
				return entries.get(url);
			},
			async put(url: string, response: Response) {
				entries.set(url, response);
			},
			async delete(url: string) {
				return entries.delete(url);
			},
			async keys() {
				return [...entries.keys()].map((url) => ({ url }));
			},
		}));
		await store.put("model.onnx", new Uint8Array([1]));
		entries.set(
			"https://speeedy.test/_app/immutable/workers/kokoro.worker-AAAA1111.js",
			new Response("x"),
		);
		expect(await store.keys()).toEqual(["model.onnx"]);
	});
});
