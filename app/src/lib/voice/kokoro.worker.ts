/// <reference lib="webworker" />
// The on-device voice worker. onnxruntime-web is bundled into this file and starts its WASM
// threads from this same script (named `em-pthread`); those threads belong to the runtime,
// so only the first instance answers the page.
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
		},
	);
}
