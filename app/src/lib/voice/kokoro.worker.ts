/// <reference lib="webworker" />
// The on-device voice worker. onnxruntime-web is bundled into this file and starts its WASM
// threads from this same script (named `em-pthread`); those threads belong to the runtime,
// so only the first instance answers the page.
//
// This script and the WASM are kept in the voice's own cache once the reader agrees to the
// download (never in the app's precache), and the service worker serves them from there, so
// the voice starts offline.
import { startKokoroWorker } from "@speeedy/kokoro/worker";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import * as ort from "onnxruntime-web/wasm";

const scope = self as unknown as DedicatedWorkerGlobalScope;
if (!scope.name.startsWith("em-pthread")) {
	startKokoroWorker(
		scope as unknown as Parameters<typeof startKokoroWorker>[0],
		{
			ort,
			wasmPaths: { wasm },
			runtime: [scope.location.href, String(wasm)],
		},
	);
}
