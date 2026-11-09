/**
 * Main-thread side of the Kokoro worker: request/response over postMessage. It holds no model
 * state; the Listen UI owns the consent prompt and calls `download()` only after the reader
 * agrees to the size it shows.
 */
import type {
	GenerateOptions,
	GenerateResult,
	KokoroErrorCode,
} from "./generate";
import { KokoroError } from "./generate";
import type { KokoroWorkerMessage, KokoroWorkerRequest } from "./worker-core";

type WorkerLike = {
	postMessage(message: KokoroWorkerRequest): void;
	addEventListener(
		type: "message",
		listener: (event: { data: KokoroWorkerMessage }) => void,
	): void;
	/** The worker could not start, or died. */
	addEventListener(type: "error", listener: (event: unknown) => void): void;
	terminate(): void;
};

export type KokoroStatus = Extract<KokoroWorkerMessage, { type: "status" }>;
export type KokoroReady = Extract<KokoroWorkerMessage, { type: "ready" }>;
/** A generation, and how long the worker took to make it. */
export type Generation = GenerateResult & { ms: number };

const toError = (message: Extract<KokoroWorkerMessage, { type: "error" }>) =>
	message.code === "failed"
		? new Error(message.message)
		: new KokoroError(message.code as KokoroErrorCode, message.message);

const dead = () => new Error("the voice worker stopped");

export function createKokoroClient(worker: WorkerLike) {
	let nextId = 1;
	let broken = false;
	const pending = new Map<
		number,
		{ resolve: (r: Generation) => void; reject: (e: Error) => void }
	>();
	let waiting: {
		resolve: (m: KokoroWorkerMessage) => void;
		reject: (e: Error) => void;
	}[] = [];
	const progress = new Set<(loaded: number, total: number) => void>();
	const failures = new Set<() => void>();

	worker.addEventListener("message", ({ data }) => {
		if (data.type === "progress") {
			for (const listener of progress) listener(data.loaded, data.totalBytes);
			return;
		}
		if (
			data.type === "result" ||
			(data.type === "error" && data.id !== undefined)
		) {
			const id = data.id as number;
			const request = pending.get(id);
			pending.delete(id);
			if (data.type === "result") {
				request?.resolve(Object.assign(data.result, { ms: data.ms }));
			} else request?.reject(toError(data));
			return;
		}
		const [first, ...rest] = waiting;
		if (!first) return;
		waiting = rest;
		if (data.type === "error") first.reject(toError(data));
		else first.resolve(data);
	});

	worker.addEventListener("error", () => {
		if (broken) return;
		broken = true;
		const error = dead();
		for (const request of pending.values()) request.reject(error);
		pending.clear();
		for (const request of waiting) request.reject(error);
		waiting = [];
		for (const listener of [...failures]) listener();
	});

	const control = <T extends KokoroWorkerMessage>(
		request: KokoroWorkerRequest,
	) =>
		new Promise<T>((resolve, reject) => {
			if (broken) return reject(dead());
			waiting.push({
				resolve: resolve as (m: KokoroWorkerMessage) => void,
				reject,
			});
			worker.postMessage(request);
		});

	return {
		status: () => control<KokoroStatus>({ type: "status" }),
		/** Download (resuming any earlier attempt) and load. Call only after the reader agrees. */
		download: () => control<KokoroReady>({ type: "download", consent: true }),
		/** Load from the cache; rejects with `not-downloaded` when nothing is cached. */
		load: () => control<KokoroReady>({ type: "load" }),
		/**
		 * Make `sentence`'s audio. Aborting `signal` rejects at once with `cancelled` and tells the
		 * worker to skip the sentence if it has not started it; a result that arrives anyway is
		 * dropped.
		 */
		generate(
			sentence: string,
			options: GenerateOptions,
			signal?: AbortSignal,
		): Promise<Generation> {
			if (broken) return Promise.reject(dead());
			if (signal?.aborted) return Promise.reject(new KokoroError("cancelled"));
			const id = nextId++;
			return new Promise((resolve, reject) => {
				const onAbort = () => {
					if (!pending.delete(id)) return;
					worker.postMessage({ type: "cancel", ids: [id] });
					reject(new KokoroError("cancelled"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });
				const done = () => signal?.removeEventListener("abort", onAbort);
				pending.set(id, {
					resolve: (result) => {
						done();
						resolve(result);
					},
					reject: (error) => {
						done();
						reject(error);
					},
				});
				worker.postMessage({ type: "generate", id, sentence, ...options });
			});
		},
		onProgress(listener: (loaded: number, total: number) => void) {
			progress.add(listener);
			return () => progress.delete(listener);
		},
		/** Called once if the worker dies; every call after rejects. */
		onFailure(listener: () => void) {
			failures.add(listener);
			return () => failures.delete(listener);
		},
		terminate: () => worker.terminate(),
	};
}

export type KokoroClient = ReturnType<typeof createKokoroClient>;
