/**
 * Web Worker entry for the on-device voice. The app's worker file imports
 * `onnxruntime-web/wasm` and the URL of its `.wasm` binary (a bundler concern, so it stays in
 * the app) and calls `startKokoroWorker(self, { ort, wasmPaths })`.
 */
import { KOKORO_ASSETS } from "./assets";
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
	onmessage: ((event: { data: KokoroWorkerRequest }) => void) | null;
	postMessage(message: KokoroWorkerMessage, transfer?: Transferable[]): void;
	fetch: typeof fetch;
};

type OrtWithEnv = OrtModule & {
	env: { wasm: { numThreads?: number; wasmPaths?: unknown; proxy?: boolean } };
};

export const CACHE_NAME = "speeedy-kokoro-v1";

export function startKokoroWorker(
	scope: WorkerScope,
	{
		ort,
		wasmPaths,
		store,
	}: { ort: OrtWithEnv; wasmPaths?: unknown; store?: AssetStore },
) {
	const caches = scope.caches;
	const assets =
		store ?? (caches ? cacheStore(() => caches.open(CACHE_NAME)) : undefined);
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
	});
	scope.onmessage = (event) => {
		void worker.handle(event.data);
	};
	return worker;
}
