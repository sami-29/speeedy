import { KOKORO_CACHE } from "@speeedy/kokoro";
import { createAudioCache } from "./audio-cache.ts";
import KokoroWorker from "./kokoro.worker.ts?worker";
import { createOnDeviceVoice, type OnDeviceVoice } from "./on-device.ts";

let instance: OnDeviceVoice | undefined;

/**
 * Whether this browser can keep and run the on-device voice: a worker, Cache Storage for
 * the model and its runtime, and Web Audio to play it.
 */
export function canUseOnDeviceVoice(): boolean {
	const w = window as unknown as Record<string, unknown>;
	return (
		typeof w.Worker === "function" &&
		typeof w.caches === "object" &&
		w.caches !== null &&
		(typeof w.AudioContext === "function" ||
			typeof w.webkitAudioContext === "function")
	);
}

/** The page's one on-device voice. Made on first use; it starts no worker until it speaks. */
export function onDeviceVoice(): OnDeviceVoice {
	instance ??= createOnDeviceVoice({
		createWorker: () => new KokoroWorker({ name: "kokoro" }),
		openCache: () => caches.open(KOKORO_CACHE),
		audioCache: createAudioCache(),
	});
	return instance;
}
