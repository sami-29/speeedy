/**
 * Web Worker entry: builds the first Timeline off the main thread. The app starts it with
 * `new Worker(new URL("@speeedy/engine/worker", import.meta.url), { type: "module" })` and
 * posts a `BuildRequest`. Playback itself stays on the main thread.
 */
import {
	type BuildRequest,
	type BuildResponse,
	handleBuildRequest,
} from "./build-request";

type WorkerScope = {
	onmessage: ((event: { data: BuildRequest }) => void) | null;
	postMessage(message: BuildResponse): void;
};

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = (event) => scope.postMessage(handleBuildRequest(event.data));
