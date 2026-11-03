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
	terminate(): void;
};

export type KokoroStatus = Extract<KokoroWorkerMessage, { type: "status" }>;
export type KokoroReady = Extract<KokoroWorkerMessage, { type: "ready" }>;

const toError = (message: Extract<KokoroWorkerMessage, { type: "error" }>) =>
	message.code === "failed"
		? new Error(message.message)
		: new KokoroError(message.code as KokoroErrorCode, message.message);

export function createKokoroClient(worker: WorkerLike) {
	let nextId = 1;
	const pending = new Map<
		number,
		{ resolve: (r: GenerateResult) => void; reject: (e: Error) => void }
	>();
	let waiting: {
		types: KokoroWorkerMessage["type"][];
		resolve: (m: KokoroWorkerMessage) => void;
		reject: (e: Error) => void;
	}[] = [];
	const progress = new Set<(loaded: number, total: number) => void>();

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
			if (data.type === "result") request?.resolve(data.result);
			else request?.reject(toError(data));
			return;
		}
		const [first, ...rest] = waiting;
		if (!first) return;
		waiting = rest;
		if (data.type === "error") first.reject(toError(data));
		else first.resolve(data);
	});

	const control = <T extends KokoroWorkerMessage>(
		request: KokoroWorkerRequest,
		types: T["type"][],
	) =>
		new Promise<T>((resolve, reject) => {
			waiting.push({
				types,
				resolve: resolve as (m: KokoroWorkerMessage) => void,
				reject,
			});
			worker.postMessage(request);
		});

	return {
		status: () => control<KokoroStatus>({ type: "status" }, ["status"]),
		/** Download (resuming any earlier attempt) and load. Call only after the reader agrees. */
		download: () =>
			control<KokoroReady>({ type: "download", consent: true }, ["ready"]),
		/** Load from the cache; rejects with `not-downloaded` when nothing is cached. */
		load: () => control<KokoroReady>({ type: "load" }, ["ready"]),
		generate(
			sentence: string,
			options: GenerateOptions,
		): Promise<GenerateResult> {
			const id = nextId++;
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				worker.postMessage({ type: "generate", id, sentence, ...options });
			});
		},
		onProgress(listener: (loaded: number, total: number) => void) {
			progress.add(listener);
			return () => progress.delete(listener);
		},
		terminate: () => worker.terminate(),
	};
}

export type KokoroClient = ReturnType<typeof createKokoroClient>;
