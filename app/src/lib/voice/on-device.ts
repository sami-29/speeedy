import {
	assetStatus,
	type CacheLike,
	cacheStore,
	DEFAULT_VOICE,
	formatBytes,
	KOKORO_ASSETS,
	KokoroError,
	TOTAL_DOWNLOAD_BYTES,
} from "@speeedy/kokoro";
import { createKokoroClient, type KokoroClient } from "@speeedy/kokoro/client";
import type { AudioCache } from "./audio-cache.ts";
import { createRenderer, type Render } from "./clip.ts";

/**
 * Where the on-device voice is: not checked yet, not downloaded, downloading, downloaded but
 * not loaded, loading, ready to speak, or stopped by a worker failure.
 */
export type OnDevicePhase =
	| "unknown"
	| "absent"
	| "downloading"
	| "downloaded"
	| "loading"
	| "ready"
	| "failed";

export type OnDeviceState = {
	phase: OnDevicePhase;
	/** Bytes downloaded so far, while downloading. */
	loaded: number;
	totalBytes: number;
	/** The size the download is shown as, before the reader agrees to it. */
	totalLabel: string;
	/** The last download failed. */
	error?: "download";
};

type WorkerLike = Parameters<typeof createKokoroClient>[0];

export type OnDeviceOptions = {
	createWorker: () => WorkerLike;
	/** The voice's Cache Storage cache, which holds the model and its runtime. */
	openCache: () => Promise<CacheLike>;
	audioCache: AudioCache;
};

/**
 * The on-device voice's model and worker. Checking whether it is downloaded reads the cache
 * only: no worker starts and no host is asked until the reader agrees to `download()`. The
 * worker starts when a downloaded voice first speaks, once, and a new one starts after a
 * failure.
 */
export function createOnDeviceVoice(options: OnDeviceOptions) {
	let state: OnDeviceState = {
		phase: "unknown",
		loaded: 0,
		totalBytes: TOTAL_DOWNLOAD_BYTES,
		totalLabel: formatBytes(TOTAL_DOWNLOAD_BYTES),
	};
	let downloaded = false;
	let client: KokoroClient | undefined;
	let loading: Promise<boolean> | undefined;
	const listeners = new Set<() => void>();
	const failures = new Set<() => void>();

	const set = (next: Partial<OnDeviceState>) => {
		const { error: _, ...rest } = state;
		state = { ...rest, ...next };
		for (const listener of [...listeners]) listener();
	};

	const stop = () => {
		client?.terminate();
		client = undefined;
		loading = undefined;
	};

	const start = (): KokoroClient => {
		if (client) return client;
		const made = createKokoroClient(options.createWorker());
		client = made;
		made.onFailure(() => {
			if (client !== made) return;
			stop();
			set({ phase: "failed" });
			for (const listener of [...failures]) listener();
		});
		made.onProgress((loaded, totalBytes) => {
			if (client === made && state.phase === "downloading") {
				set({ loaded, totalBytes });
			}
		});
		return made;
	};

	const check = async (): Promise<"absent" | "downloaded"> => {
		let found = false;
		try {
			const status = await assetStatus(
				Object.values(KOKORO_ASSETS),
				cacheStore(options.openCache),
			);
			found = Object.values(status).every(Boolean);
		} catch {
			// No Cache Storage here: the voice cannot be kept, so it is not downloaded.
		}
		downloaded = found;
		if (state.phase === "unknown" || state.phase === "absent") {
			set({ phase: found ? "downloaded" : "absent" });
		}
		return found ? "downloaded" : "absent";
	};

	const load = (): Promise<boolean> => {
		if (loading) return loading;
		const attempt = (async () => {
			if (!downloaded && (await check()) === "absent") return false;
			const c = start();
			set({ phase: "loading" });
			try {
				await c.load();
				set({ phase: "ready" });
				return true;
			} catch (error) {
				if (client !== c) return false;
				stop();
				if ((error as { code?: unknown }).code === "not-downloaded") {
					downloaded = false;
					set({ phase: "absent" });
				} else set({ phase: "failed" });
				return false;
			}
		})();
		loading = attempt;
		void attempt.then((ok) => {
			if (!ok && loading === attempt) loading = undefined;
		});
		return attempt;
	};

	const render: Render = createRenderer({
		generate: async (sentence, speed, signal) => {
			if (!(await load()) || !client) throw new KokoroError("not-downloaded");
			return client.generate(sentence, { voice: DEFAULT_VOICE, speed }, signal);
		},
		cache: options.audioCache,
		voice: DEFAULT_VOICE,
	});

	return {
		get state() {
			return state;
		},
		check,
		/** Download the voice and its runtime. Call only after the reader agrees to the size. */
		async download(): Promise<boolean> {
			stop();
			const c = start();
			set({ phase: "downloading", loaded: 0 });
			try {
				await c.download();
				downloaded = true;
				loading = Promise.resolve(true);
				set({ phase: "ready" });
				return true;
			} catch {
				if (client === c) stop();
				set({ phase: downloaded ? "downloaded" : "absent", error: "download" });
				return false;
			}
		},
		load,
		/** A sentence's audio; rejects with `not-downloaded` when the voice is not downloaded. */
		async render(sentence: string, speed: number, signal?: AbortSignal) {
			if (!downloaded && (await check()) === "absent") {
				throw new KokoroError("not-downloaded");
			}
			return render(sentence, speed, signal);
		},
		/** Told once each time the worker dies. */
		onFailure(listener: () => void) {
			failures.add(listener);
			return () => {
				failures.delete(listener);
			};
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export type OnDeviceVoice = ReturnType<typeof createOnDeviceVoice>;
