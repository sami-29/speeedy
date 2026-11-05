import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	type Asset,
	type CacheLike,
	createKokoroWorker,
	type KokoroAssets,
	type KokoroWorkerMessage,
	memoryStore,
	threadCount,
} from "../src/index";
import { fixtureLexicon, rowVoice, stubSession } from "./helpers";

const APP = "https://speeedy.test/_app/immutable/workers/";

/** A Cache Storage cache in memory, keyed by URL. */
function memoryCache() {
	const entries = new Map<string, string>();
	const cache: CacheLike = {
		async match(url) {
			const body = entries.get(url);
			return body === undefined ? undefined : new Response(body);
		},
		async put(url, response) {
			entries.set(url, await response.text());
		},
		async delete(url) {
			return entries.delete(url);
		},
		async keys() {
			return [...entries.keys()].map((url) => ({ url }));
		},
	};
	return { cache, entries };
}

const encode = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value));

function fakeAsset(key: string, bytes: Uint8Array): [Asset, Uint8Array] {
	return [
		{
			key,
			url: `https://example.test/${key}`,
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		},
		bytes,
	];
}

function setup(
	environment = { crossOriginIsolated: true, hardwareConcurrency: 8 },
	store = memoryStore(),
	extra: Partial<Parameters<typeof createKokoroWorker>[0]> = {},
) {
	const files = {
		model: fakeAsset("model.onnx", new Uint8Array([1, 2, 3, 4])),
		voice: fakeAsset("af_msa.bin", new Uint8Array(rowVoice().buffer)),
		gold: fakeAsset("us_gold.json", encode(fixtureLexicon.gold)),
		silver: fakeAsset("us_silver.json", encode(fixtureLexicon.silver)),
	};
	const assets = Object.fromEntries(
		Object.entries(files).map(([name, [asset]]) => [name, asset]),
	) as KokoroAssets;
	const requests: string[] = [];
	const fetcher = (async (url: string) => {
		requests.push(String(url));
		if (String(url).startsWith(APP)) {
			return new Response(`runtime ${url}`, { status: 200 });
		}
		const file = Object.values(files).find(
			([asset]) => asset.url === String(url),
		);
		if (!file) return new Response("missing", { status: 404 });
		return new Response(file[1].slice(), { status: 200 });
	}) as unknown as typeof fetch;
	const posted: { message: KokoroWorkerMessage; transfer: Transferable[] }[] =
		[];
	const sessions: { bytes: Uint8Array; threads: number }[] = [];
	const worker = createKokoroWorker({
		assets,
		fetch: fetcher,
		store,
		environment,
		createSession: async (bytes, options) => {
			sessions.push({ bytes, threads: options.threads });
			return stubSession();
		},
		post: (message, transfer = []) => posted.push({ message, transfer }),
		...extra,
	});
	const last = () => posted.at(-1)?.message;
	return { worker, requests, posted, sessions, last };
}

describe("threadCount", () => {
	it("uses up to four threads, half the cores, only when cross-origin isolated", () => {
		expect(
			threadCount({ crossOriginIsolated: true, hardwareConcurrency: 8 }),
		).toBe(4);
		expect(
			threadCount({ crossOriginIsolated: true, hardwareConcurrency: 16 }),
		).toBe(4);
		expect(
			threadCount({ crossOriginIsolated: true, hardwareConcurrency: 4 }),
		).toBe(2);
		expect(
			threadCount({ crossOriginIsolated: true, hardwareConcurrency: 1 }),
		).toBe(1);
		expect(
			threadCount({ crossOriginIsolated: false, hardwareConcurrency: 8 }),
		).toBe(1);
	});
});

describe("Kokoro worker", () => {
	it("reports what is cached and the download size without touching the network", async () => {
		const { worker, requests, last } = setup();
		await worker.handle({ type: "status" });
		expect(requests).toEqual([]);
		expect(last()).toMatchObject({
			type: "status",
			downloaded: false,
			threads: 4,
			crossOriginIsolated: true,
		});
		expect(last()).toHaveProperty("totalBytes");
	});

	it("will not download without the reader's consent", async () => {
		const { worker, requests, last } = setup();
		await worker.handle({ type: "download" } as never);
		await worker.handle({ type: "download", consent: false } as never);
		expect(requests).toEqual([]);
		expect(last()).toMatchObject({ type: "error", code: "consent-required" });
	});

	it("refuses to generate before the model is loaded", async () => {
		const { worker, last } = setup();
		await worker.handle({
			type: "generate",
			id: 1,
			sentence: "Hello.",
			voice: "af_msa",
		});
		expect(last()).toMatchObject({ type: "error", id: 1, code: "not-loaded" });
	});

	it("downloads on consent, loads the model with the thread count, then generates", async () => {
		const { worker, requests, posted, sessions, last } = setup();
		await worker.handle({ type: "download", consent: true });
		expect(requests).toHaveLength(4);
		expect(posted.some(({ message }) => message.type === "progress")).toBe(
			true,
		);
		expect(last()).toEqual({
			type: "ready",
			threads: 4,
			crossOriginIsolated: true,
		});
		expect(sessions).toEqual([
			{ bytes: new Uint8Array([1, 2, 3, 4]), threads: 4 },
		]);

		await worker.handle({
			type: "generate",
			id: 7,
			sentence: "Hello, world!",
			voice: "af_msa",
			speed: 1.2,
		});
		const { message, transfer } = posted.at(-1) ?? {};
		expect(message).toMatchObject({
			type: "result",
			id: 7,
			result: { phonemes: "həlˈO, wˈɜɹld!", speed: 1.2 },
		});
		const samples = (message as { result: { samples: Float32Array } }).result
			.samples;
		expect(transfer).toContain(samples.buffer);
	});

	it("loads from the cache on a later visit without the network", async () => {
		const store = memoryStore();
		await setup(undefined, store).worker.handle({
			type: "download",
			consent: true,
		});
		const later = setup(undefined, store);
		await later.worker.handle({ type: "status" });
		expect(later.last()).toMatchObject({ type: "status", downloaded: true });
		await later.worker.handle({ type: "load" });
		expect(later.requests).toEqual([]);
		expect(later.last()).toMatchObject({ type: "ready" });
	});

	it("will not load from an empty cache, since that would mean downloading", async () => {
		const { worker, requests, last } = setup();
		await worker.handle({ type: "load" });
		expect(requests).toEqual([]);
		expect(last()).toMatchObject({ type: "error", code: "not-downloaded" });
	});

	it("runs single-threaded when the page is not cross-origin isolated", async () => {
		const { worker, sessions, last } = setup({
			crossOriginIsolated: false,
			hardwareConcurrency: 8,
		});
		await worker.handle({ type: "download", consent: true });
		expect(last()).toEqual({
			type: "ready",
			threads: 1,
			crossOriginIsolated: false,
		});
		expect(sessions[0]?.threads).toBe(1);
	});

	it("passes generation errors back with the request id", async () => {
		const { worker, last } = setup();
		await worker.handle({ type: "download", consent: true });
		await worker.handle({
			type: "generate",
			id: 3,
			sentence: "Привет.",
			voice: "af_msa",
		});
		expect(last()).toMatchObject({ type: "error", id: 3, code: "not-english" });
	});
});

describe("Kokoro worker: Listen", () => {
	const generate = (id: number, sentence = "Hello, world!") =>
		({ type: "generate", id, sentence, voice: "af_msa" }) as const;

	it("says how long each generation took, measured in the worker", async () => {
		let time = 1000;
		const { worker, posted } = setup(undefined, undefined, {
			now: () => time,
			createSession: async () => {
				const session = stubSession();
				return {
					async run(input) {
						time += 250;
						return session.run(input);
					},
				};
			},
		});
		await worker.handle({ type: "download", consent: true });
		await worker.handle(generate(1));
		expect(posted.at(-1)?.message).toMatchObject({
			type: "result",
			id: 1,
			ms: 250,
		});
	});

	it("skips a queued generation that was cancelled, and says so with its id", async () => {
		const { worker, posted } = setup();
		await worker.handle({ type: "download", consent: true });
		const first = worker.handle(generate(1));
		const second = worker.handle(generate(2, "The cat sat."));
		const third = worker.handle(generate(3, "The mat."));
		await worker.handle({ type: "cancel", ids: [2] });
		await Promise.all([first, second, third]);
		const replies = posted
			.map(({ message }) => message)
			.filter((message) => "id" in message);
		expect(
			replies.map((message) => [message.type, "id" in message && message.id]),
		).toEqual([
			["result", 1],
			["error", 2],
			["result", 3],
		]);
		expect(replies[1]).toMatchObject({ code: "cancelled" });
	});

	it("keeps its own script and the runtime WASM with the model when the reader agrees", async () => {
		const runtime = memoryCache();
		const urls = [
			`${APP}kokoro.worker-AAAA1111.js`,
			`${APP}assets/ort-wasm-simd-threaded-BBBB2222.wasm`,
		];
		const { worker, requests } = setup(undefined, undefined, {
			runtime: { urls, cache: async () => runtime.cache },
		});
		await worker.handle({ type: "status" });
		expect(requests).toEqual([]);
		expect(runtime.entries.size).toBe(0);
		await worker.handle({ type: "download", consent: true });
		expect([...runtime.entries.keys()].sort()).toEqual([...urls].sort());
	});

	it("never fetches the runtime before consent: a refused download caches nothing", async () => {
		const runtime = memoryCache();
		const { worker, requests } = setup(undefined, undefined, {
			runtime: {
				urls: [`${APP}kokoro.worker-AAAA1111.js`],
				cache: async () => runtime.cache,
			},
		});
		await worker.handle({ type: "download", consent: false as true });
		await worker.handle({ type: "load" });
		expect(requests).toEqual([]);
		expect(runtime.entries.size).toBe(0);
	});

	it("on a later visit after an update, keeps the new runtime and drops the old, leaving the model", async () => {
		const store = memoryStore();
		const runtime = memoryCache();
		const old = `${APP}kokoro.worker-OLD11111.js`;
		await setup(undefined, store, {
			runtime: { urls: [old], cache: async () => runtime.cache },
		}).worker.handle({ type: "download", consent: true });
		runtime.entries.set("https://kokoro.invalid/model.onnx", "model");
		const fresh = `${APP}kokoro.worker-NEW22222.js`;
		const later = setup(undefined, store, {
			runtime: { urls: [fresh], cache: async () => runtime.cache },
		});
		await later.worker.handle({ type: "load" });
		expect(later.last()).toMatchObject({ type: "ready" });
		expect(runtime.entries.has(fresh)).toBe(true);
		expect(runtime.entries.has(old)).toBe(false);
		expect(runtime.entries.has("https://kokoro.invalid/model.onnx")).toBe(true);
	});

	it("does not fetch a runtime file it already keeps", async () => {
		const store = memoryStore();
		const runtime = memoryCache();
		const urls = [`${APP}kokoro.worker-AAAA1111.js`];
		await setup(undefined, store, {
			runtime: { urls, cache: async () => runtime.cache },
		}).worker.handle({ type: "download", consent: true });
		const later = setup(undefined, store, {
			runtime: { urls, cache: async () => runtime.cache },
		});
		await later.worker.handle({ type: "load" });
		expect(later.requests).toEqual([]);
	});

	it("still loads the voice when the runtime cannot be kept", async () => {
		const { worker, last } = setup(undefined, undefined, {
			runtime: {
				urls: [`${APP}kokoro.worker-AAAA1111.js`],
				cache: async () => {
					throw new Error("quota");
				},
			},
		});
		await worker.handle({ type: "download", consent: true });
		expect(last()).toMatchObject({ type: "ready" });
	});
});
