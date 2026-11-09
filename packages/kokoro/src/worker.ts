/**
 * Web Worker entry for the on-device voice. The app's worker file imports
 * `onnxruntime-web/wasm` and the URL of its `.wasm` binary (a bundler concern, so it stays in
 * the app) and calls `startKokoroWorker(self, { ort, wasmPaths })`.
 */
import { KOKORO_ASSETS, KOKORO_CACHE } from "./assets";
import { type AssetStore, type CacheLike, cacheStore } from "./download";
import { createOrtSession, type OrtModule } from "./ort";
import {
	createKokoroWorker,
	type KokoroWorkerMessage,
	type KokoroWorkerRequest,
} from "./worker-core";

type WorkerScope = {
	crossOriginIsolated?: boolean;
	navigator: { hardwareConcurrency?: number };
	caches?: { open(name: string): Promise<CacheLike> };
	location: { href: string };
	onmessage: ((event: { data: KokoroWorkerRequest }) => void) | null;
	postMessage(message: KokoroWorkerMessage, transfer?: Transferable[]): void;
	fetch: typeof fetch;
};

type OrtWithEnv = OrtModule & {
	env: { wasm: { numThreads?: number; wasmPaths?: unknown; proxy?: boolean } };
};

export function startKokoroWorker(
	scope: WorkerScope,
	{
		ort,
		wasmPaths,
		store,
		runtime,
	}: {
		ort: OrtWithEnv;
		wasmPaths?: unknown;
		store?: AssetStore;
		/** The URLs of the voice's own code, relative to this worker: its script and WASM. */
		runtime?: readonly string[];
	},
) {
	const caches = scope.caches;
	const assets =
		store ?? (caches ? cacheStore(() => caches.open(KOKORO_CACHE)) : undefined);
	if (!assets) throw new Error("Cache Storage is not available in this worker");
	if (wasmPaths !== undefined) ort.env.wasm.wasmPaths = wasmPaths;
	ort.env.wasm.proxy = false;
	const worker = createKokoroWorker({
		assets: KOKORO_ASSETS,
		fetch: (url, init) => scope.fetch(url, init),
		store: assets,
		environment: {
			crossOriginIsolated: scope.crossOriginIsolated === true,
			hardwareConcurrency: scope.navigator.hardwareConcurrency ?? 1,
		},
		createSession: (model, { threads }) => {
			ort.env.wasm.numThreads = threads;
			return createOrtSession(ort, model, { threads });
		},
		post: (message, transfer) => scope.postMessage(message, transfer ?? []),
		// This script and the WASM it loads, so the voice starts offline.
		...(caches && runtime
			? {
					runtime: {
						urls: runtime.map((url) => new URL(url, scope.location.href).href),
						cache: () => caches.open(KOKORO_CACHE),
					},
				}
			: {}),
	});
	scope.onmessage = (event) => {
		void worker.handle(event.data);
	};
	return worker;
}
