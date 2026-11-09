/**
 * Chunked, resumable, verified downloads. An asset is fetched in Range parts; each part is
 * stored as it lands, so a dropped connection costs one part and a reload resumes where it
 * stopped. The joined bytes must match the pinned sha256 before they are kept.
 */

export type Asset = { key: string; url: string; bytes: number; sha256: string };

/** Where downloaded bytes live: Cache Storage in the browser, a Map in tests. */
export type AssetStore = {
	get(key: string): Promise<Uint8Array | undefined>;
	put(key: string, bytes: Uint8Array): Promise<void>;
	delete(key: string): Promise<void>;
	keys(): Promise<string[]>;
};

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type DownloadOptions = {
	fetch: Fetch;
	store: AssetStore;
	/** Bytes per Range request. */
	partSize?: number;
	/** Extra attempts per part before giving up. */
	retries?: number;
	retryDelayMs?: number;
	onProgress?: (loaded: number) => void;
	signal?: AbortSignal;
};

export class IntegrityError extends Error {
	constructor(key: string, actual: string) {
		super(`${key}: sha256 ${actual} does not match the pinned hash`);
		this.name = "IntegrityError";
	}
}

class PartError extends Error {}

const DEFAULT_PART_SIZE = 4 * 1024 * 1024;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		bytes as Uint8Array<ArrayBuffer>,
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export function memoryStore(): AssetStore {
	const map = new Map<string, Uint8Array>();
	return {
		async get(key) {
			return map.get(key)?.slice();
		},
		async put(key, bytes) {
			map.set(key, bytes.slice());
		},
		async delete(key) {
			map.delete(key);
		},
		async keys() {
			return [...map.keys()];
		},
	};
}

export type CacheLike = {
	match(request: string): Promise<Response | undefined>;
	put(request: string, response: Response): Promise<void>;
	delete(request: string): Promise<boolean>;
	keys(): Promise<readonly { url: string }[]>;
};

/** Where the voice's files sit in its Cache Storage cache. Anything else there is not an asset. */
export const ASSET_BASE = "https://kokoro.invalid/";

/** An AssetStore over a Cache Storage cache, which keeps the files for offline use. */
export function cacheStore(open: () => Promise<CacheLike>): AssetStore {
	const base = ASSET_BASE;
	return {
		async get(key) {
			const response = await (await open()).match(base + key);
			return response
				? new Uint8Array(await response.arrayBuffer())
				: undefined;
		},
		async put(key, bytes) {
			await (await open()).put(
				base + key,
				new Response(bytes as Uint8Array<ArrayBuffer>),
			);
		},
		async delete(key) {
			await (await open()).delete(base + key);
		},
		async keys() {
			const requests = await (await open()).keys();
			return requests
				.filter((r) => r.url.startsWith(base))
				.map((r) => r.url.slice(base.length));
		},
	};
}

const partKey = (asset: Asset, partSize: number, index: number) =>
	`${asset.key}.parts/${asset.sha256.slice(0, 16)}-${partSize}/${index}`;

/** Which assets are already downloaded and complete. */
export async function assetStatus(
	assets: readonly Asset[],
	store: AssetStore,
): Promise<Record<string, boolean>> {
	const keys = new Set(await store.keys());
	return Object.fromEntries(
		assets.map((asset) => [asset.key, keys.has(asset.key)]),
	);
}

const wait = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (ms <= 0) return resolve();
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(signal.reason);
		});
	});

/** Return the asset's verified bytes, from the store or downloaded into it. */
export async function downloadAsset(
	asset: Asset,
	options: DownloadOptions,
): Promise<Uint8Array> {
	const { fetch, store, signal, onProgress } = options;
	const partSize = options.partSize ?? DEFAULT_PART_SIZE;
	const retries = options.retries ?? 3;
	const retryDelayMs = options.retryDelayMs ?? 500;
	signal?.throwIfAborted();

	const cached = await store.get(asset.key);
	if (cached) {
		if (
			cached.byteLength === asset.bytes &&
			(await sha256Hex(cached)) === asset.sha256
		) {
			onProgress?.(asset.bytes);
			return cached;
		}
		await store.delete(asset.key);
	}

	const count = Math.max(1, Math.ceil(asset.bytes / partSize));
	const parts: (Uint8Array | undefined)[] = [];
	let loaded = 0;
	for (let index = 0; index < count; index++) {
		const part = await store.get(partKey(asset, partSize, index));
		parts.push(part);
		loaded += part?.byteLength ?? 0;
	}
	if (loaded) onProgress?.(loaded);

	let whole: Uint8Array | undefined;
	for (let index = 0; index < count && !whole; index++) {
		if (parts[index]) continue;
		const from = index * partSize;
		const to = Math.min(asset.bytes, from + partSize) - 1;
		let lastError: unknown;
		for (let attempt = 0; attempt <= retries; attempt++) {
			signal?.throwIfAborted();
			if (attempt > 0) await wait(retryDelayMs * 2 ** (attempt - 1), signal);
			try {
				const response = await fetch(asset.url, {
					headers: { Range: `bytes=${from}-${to}` },
					...(signal ? { signal } : {}),
				});
				if (response.status === 200) {
					// The server ignored Range and sent the whole file.
					const bytes = new Uint8Array(await response.arrayBuffer());
					if (bytes.byteLength !== asset.bytes) {
						throw new PartError(`${asset.key}: got ${bytes.byteLength} bytes`);
					}
					whole = bytes;
					break;
				}
				if (response.status !== 206) {
					throw new PartError(`${asset.key}: HTTP ${response.status}`);
				}
				const bytes = new Uint8Array(await response.arrayBuffer());
				if (bytes.byteLength !== to - from + 1) {
					throw new PartError(`${asset.key}: part ${index} came back short`);
				}
				await store.put(partKey(asset, partSize, index), bytes);
				parts[index] = bytes;
				loaded += bytes.byteLength;
				onProgress?.(loaded);
				lastError = undefined;
				break;
			} catch (error) {
				if (signal?.aborted) throw signal.reason;
				lastError = error;
			}
		}
		if (lastError !== undefined) throw lastError;
	}

	if (!whole) {
		whole = new Uint8Array(asset.bytes);
		let offset = 0;
		for (const part of parts) {
			whole.set(part as Uint8Array, offset);
			offset += part?.byteLength ?? 0;
		}
	}
	const clearParts = async () => {
		for (let index = 0; index < count; index++)
			await store.delete(partKey(asset, partSize, index));
	};
	const actual = await sha256Hex(whole);
	if (actual !== asset.sha256) {
		await clearParts();
		throw new IntegrityError(asset.key, actual);
	}
	await store.put(asset.key, whole);
	await clearParts();
	onProgress?.(asset.bytes);
	return whole;
}
