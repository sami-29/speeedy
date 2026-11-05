import { describe, expect, it } from "vitest";
import { createKokoroClient } from "../src/client";
import { KokoroError } from "../src/generate";
import type {
	KokoroWorkerMessage,
	KokoroWorkerRequest,
} from "../src/worker-core";

/** A worker that records requests; the test sends its replies. */
function fakeWorker() {
	const requests: KokoroWorkerRequest[] = [];
	const listeners = {
		message: new Set<(event: { data: KokoroWorkerMessage }) => void>(),
		error: new Set<(event: unknown) => void>(),
	};
	let terminated = false;
	return {
		requests,
		get terminated() {
			return terminated;
		},
		worker: {
			postMessage(message: KokoroWorkerRequest) {
				requests.push(message);
			},
			addEventListener(type: "message" | "error", listener: never) {
				listeners[type].add(listener);
			},
			terminate() {
				terminated = true;
			},
		},
		reply(data: KokoroWorkerMessage) {
			for (const listener of listeners.message) listener({ data });
		},
		crash() {
			for (const listener of listeners.error) listener({ message: "boom" });
		},
	};
}

const result = (n = 2400) => ({
	samples: new Float32Array(n),
	sampleRate: 24_000,
	durations: [],
	phonemes: "",
	words: [{ text: "Hi.", start: 0, end: 0.1 }],
	speed: 1,
});

describe("Kokoro client: Listen", () => {
	it("hands back the generation time the worker measured", async () => {
		const fake = fakeWorker();
		const client = createKokoroClient(fake.worker);
		const pending = client.generate("Hi.", { voice: "af_msa" });
		fake.reply({ type: "result", id: 1, result: result(), ms: 80 });
		await expect(pending).resolves.toMatchObject({
			ms: 80,
			sampleRate: 24_000,
		});
	});

	it("cancels a queued sentence: tells the worker, rejects at once, and ignores a late result", async () => {
		const fake = fakeWorker();
		const client = createKokoroClient(fake.worker);
		const controller = new AbortController();
		const pending = client.generate(
			"Hi.",
			{ voice: "af_msa" },
			controller.signal,
		);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
		expect(fake.requests.at(-1)).toEqual({ type: "cancel", ids: [1] });
		// A result the worker had already sent is dropped without a throw.
		fake.reply({ type: "result", id: 1, result: result(), ms: 5 });
	});

	it("does not send a sentence whose signal was already aborted", async () => {
		const fake = fakeWorker();
		const client = createKokoroClient(fake.worker);
		const controller = new AbortController();
		controller.abort();
		await expect(
			client.generate("Hi.", { voice: "af_msa" }, controller.signal),
		).rejects.toBeInstanceOf(KokoroError);
		expect(fake.requests).toEqual([]);
	});

	it("rejects everything waiting, and anything after, when the worker dies", async () => {
		const fake = fakeWorker();
		const client = createKokoroClient(fake.worker);
		const generating = client.generate("Hi.", { voice: "af_msa" });
		const loading = client.load();
		fake.crash();
		await expect(generating).rejects.toThrow();
		await expect(loading).rejects.toThrow();
		await expect(client.generate("Hi.", { voice: "af_msa" })).rejects.toThrow();
		await expect(client.status()).rejects.toThrow();
	});

	it("tells listeners when the worker dies", () => {
		const fake = fakeWorker();
		const client = createKokoroClient(fake.worker);
		const seen: string[] = [];
		client.onFailure(() => seen.push("failed"));
		fake.crash();
		expect(seen).toEqual(["failed"]);
	});
});
