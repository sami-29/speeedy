/**
 * The Kokoro worker's logic, free of any worker global so it can be tested in Node. The
 * worker downloads only after the reader's explicit consent, loads only from what is already
 * cached, and runs one generation at a time.
 */
import { formatBytes, type KokoroAssets, TOTAL_DOWNLOAD_BYTES } from "./assets";
import {
	ASSET_BASE,
	type AssetStore,
	assetStatus,
	type CacheLike,
	downloadAsset,
	type Fetch,
} from "./download";
import {
	createGenerator,
	type GenerateOptions,
	type GenerateResult,
	type Generator,
	KokoroError,
	type KokoroErrorCode,
	type KokoroSession,
	voicePack,
} from "./generate";
import { Lexicon } from "./lexicon";

export type Environment = {
	crossOriginIsolated: boolean;
	hardwareConcurrency: number;
};

/** WASM threads need SharedArrayBuffer, so more than one only when cross-origin isolated. */
export function threadCount({
	crossOriginIsolated,
	hardwareConcurrency,
}: Environment): number {
	if (!crossOriginIsolated) return 1;
	return Math.max(1, Math.min(4, Math.ceil((hardwareConcurrency || 1) / 2)));
}

export type KokoroWorkerRequest =
	| { type: "status" }
	| { type: "download"; consent: true }
	| { type: "load" }
	| ({ type: "generate"; id: number; sentence: string } & GenerateOptions)
	/** Drop these generations if they have not started. */
	| { type: "cancel"; ids: readonly number[] };

export type KokoroWorkerMessage =
	| {
			type: "status";
			downloaded: boolean;
			totalBytes: number;
			totalLabel: string;
			threads: number;
			crossOriginIsolated: boolean;
	  }
	| { type: "progress"; loaded: number; totalBytes: number }
	| { type: "ready"; threads: number; crossOriginIsolated: boolean }
	/** `ms`: how long the generation took, measured in the worker. */
	| { type: "result"; id: number; result: GenerateResult; ms: number }
	| {
			type: "error";
			id?: number;
			code: KokoroErrorCode | "failed";
			message: string;
	  };

export type KokoroWorkerOptions = {
	assets: KokoroAssets;
	fetch: Fetch;
	store: AssetStore;
	environment: Environment;
	createSession: (
		model: Uint8Array,
		options: { threads: number },
	) => Promise<KokoroSession>;
	post: (message: KokoroWorkerMessage, transfer?: Transferable[]) => void;
	/** Defaults to `performance.now`. */
	now?: () => number;
	/**
	 * The voice's own code (this worker's script and the runtime's WASM), kept in the model's
	 * cache so the voice works offline without the app's precache holding 15 MB nobody asked
	 * for. Fetched when the reader agrees to the download, and topped up on each later load.
	 */
	runtime?: { urls: readonly string[]; cache: () => Promise<CacheLike> };
};

const offline: Fetch = async () => {
	throw new KokoroError("not-downloaded");
};

export function createKokoroWorker(options: KokoroWorkerOptions) {
	const { assets, store, environment, post } = options;
	const threads = threadCount(environment);
	const { crossOriginIsolated } = environment;
	const list = Object.values(assets);
	const totalBytes = list.reduce((sum, asset) => sum + asset.bytes, 0);
	let generator: Generator | null = null;
	let queue: Promise<unknown> = Promise.resolve();
	const cancelled = new Set<number>();
	const now = options.now ?? (() => performance.now());

	/**
	 * Keep the runtime files, fetching only those not kept yet, and drop runtime files of
	 * older builds. The model's own entries are left alone. Best effort: the voice works
	 * online without them.
	 */
	async function keepRuntime() {
		const runtime = options.runtime;
		if (!runtime) return;
		try {
			const cache = await runtime.cache();
			const wanted = new Set(runtime.urls);
			for (const url of wanted) {
				if (await cache.match(url)) continue;
				const response = await options.fetch(url);
				if (response.ok) await cache.put(url, response);
			}
			for (const { url } of await cache.keys()) {
				if (!url.startsWith(ASSET_BASE) && !wanted.has(url)) {
					await cache.delete(url);
				}
			}
		} catch {
			// Out of quota, or offline: the voice still runs from the network copy.
		}
	}

	const fail = (
		error: unknown,
		fallback: KokoroErrorCode | "failed",
		id?: number,
	) => {
		const code = error instanceof KokoroError ? error.code : fallback;
		const message = error instanceof Error ? error.message : String(error);
		post({ type: "error", ...(id === undefined ? {} : { id }), code, message });
	};

	async function downloaded(): Promise<boolean> {
		const status = await assetStatus(list, store);
		return list.every((asset) => status[asset.key]);
	}

	async function load(fetch: Fetch, onProgress?: (loaded: number) => void) {
		const bytes: Partial<Record<keyof KokoroAssets, Uint8Array>> = {};
		let done = 0;
		for (const [name, asset] of Object.entries(assets) as [
			keyof KokoroAssets,
			KokoroAssets[keyof KokoroAssets],
		][]) {
			bytes[name] = await downloadAsset(asset, {
				fetch,
				store,
				onProgress: (loaded) => onProgress?.(done + loaded),
			});
			done += asset.bytes;
		}
		const decode = (data: Uint8Array | undefined) =>
			JSON.parse(new TextDecoder().decode(data));
		const lexicon = new Lexicon({
			gold: decode(bytes.gold),
			silver: decode(bytes.silver),
		});
		const session = await options.createSession(bytes.model as Uint8Array, {
			threads,
		});
		generator = createGenerator({
			session,
			voices: { af_msa: voicePack(bytes.voice as Uint8Array) },
			lexicon,
		});
		post({ type: "ready", threads, crossOriginIsolated });
	}

	async function handle(request: KokoroWorkerRequest): Promise<void> {
		switch (request.type) {
			case "status":
				post({
					type: "status",
					downloaded: await downloaded(),
					totalBytes,
					totalLabel: formatBytes(totalBytes || TOTAL_DOWNLOAD_BYTES),
					threads,
					crossOriginIsolated,
				});
				return;
			case "download":
				if (request.consent !== true) {
					fail(
						new KokoroError(
							"consent-required",
							"the reader has not agreed to the download",
						),
						"consent-required",
					);
					return;
				}
				try {
					let last = -1;
					await load(options.fetch, (loaded) => {
						if (loaded <= last) return;
						last = loaded;
						post({ type: "progress", loaded, totalBytes });
					});
				} catch (error) {
					fail(error, "download-failed");
					return;
				}
				await keepRuntime();
				return;
			case "load":
				try {
					if (!(await downloaded())) throw new KokoroError("not-downloaded");
					await load(offline);
				} catch (error) {
					fail(error, "not-downloaded");
					return;
				}
				await keepRuntime();
				return;
			case "cancel":
				for (const id of request.ids) cancelled.add(id);
				return;
			case "generate": {
				const { id, sentence, ...generateOptions } = request;
				const run = queue.then(async () => {
					if (cancelled.delete(id)) throw new KokoroError("cancelled");
					if (!generator) throw new KokoroError("not-loaded");
					const started = now();
					const result = await generator.generate(sentence, generateOptions);
					return { result, ms: now() - started };
				});
				queue = run.catch(() => undefined);
				try {
					const { result, ms } = await run;
					post({ type: "result", id, result, ms }, [
						result.samples.buffer as ArrayBuffer,
					]);
				} catch (error) {
					fail(error, "failed", id);
				}
				return;
			}
		}
	}

	return { handle };
}
