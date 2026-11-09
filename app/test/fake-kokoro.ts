import { tokenize } from "@speeedy/engine";
import type { KokoroWorkerMessage, KokoroWorkerRequest } from "@speeedy/kokoro";
import { FakeContext, FakeGain } from "./fake-audio.ts";

/** Seconds of audio the fake voice makes per word, at speed 1. */
export const WORD_SECONDS = 0.25;
export const RATE = 24_000;

type Generate = Extract<KokoroWorkerRequest, { type: "generate" }>;

/**
 * A stand-in for the Kokoro worker that speaks its protocol. Each word of a sentence (as the
 * Engine tokenizes it) lasts `WORD_SECONDS / speed`, and the reported generation time is
 * `ratio` times the audio's length. In `manual` mode generations wait for `finish`.
 */
export function fakeKokoroWorker(
	options: {
		manual?: boolean;
		/** Generation time ÷ audio time the fake reports. */
		ratio?: number;
		/** Words per sentence above which the fake says the sentence is too long. */
		maxWords?: number;
		/** The download fails partway, as a dropped connection would. */
		failDownload?: boolean;
	} = {},
) {
	const requests: KokoroWorkerRequest[] = [];
	const listeners = {
		message: new Set<(event: { data: KokoroWorkerMessage }) => void>(),
		error: new Set<(event: unknown) => void>(),
	};
	const queued: Generate[] = [];
	const failures = new Map<string, string>();
	let ratio = options.ratio ?? 0.2;
	let terminated = 0;

	const post = (data: KokoroWorkerMessage) => {
		for (const listener of [...listeners.message]) listener({ data });
	};

	const answer = (request: Generate) => {
		const code = failures.get(request.sentence);
		if (code) {
			post({
				type: "error",
				id: request.id,
				code: code as never,
				message: code,
			});
			return;
		}
		const words = tokenize(request.sentence);
		if (words.length === 0) {
			post({ type: "error", id: request.id, code: "empty", message: "empty" });
			return;
		}
		if (options.maxWords !== undefined && words.length > options.maxWords) {
			post({
				type: "error",
				id: request.id,
				code: "too-long",
				message: "too long",
			});
			return;
		}
		const speed = Math.min(request.speed ?? 1, 1.5);
		const each = WORD_SECONDS / speed;
		const seconds = words.length * each;
		const samples = new Float32Array(Math.round(seconds * RATE));
		for (let i = 0; i < samples.length; i++)
			samples[i] = ((i % 100) - 50) / 100;
		post({
			type: "result",
			id: request.id,
			ms: seconds * 1000 * ratio,
			result: {
				samples,
				sampleRate: RATE,
				durations: [],
				phonemes: "",
				words: words.map((word, i) => ({
					text: word.text,
					start: i * each,
					end: (i + 1) * each,
				})),
				speed,
			},
		});
	};

	const worker = {
		postMessage(message: KokoroWorkerRequest) {
			requests.push(message);
			switch (message.type) {
				case "status":
					queueMicrotask(() =>
						post({
							type: "status",
							downloaded: false,
							totalBytes: 37_271_123,
							totalLabel: "37.3 MB",
							threads: 1,
							crossOriginIsolated: false,
						}),
					);
					return;
				case "download":
					queueMicrotask(() => {
						post({
							type: "progress",
							loaded: 1_000_000,
							totalBytes: 37_271_123,
						});
						if (options.failDownload) {
							post({
								type: "error",
								code: "download-failed",
								message: "offline",
							});
						} else {
							post({ type: "ready", threads: 1, crossOriginIsolated: false });
						}
					});
					return;
				case "load":
					queueMicrotask(() =>
						post({ type: "ready", threads: 1, crossOriginIsolated: false }),
					);
					return;
				case "cancel":
					for (const id of message.ids) {
						const at = queued.findIndex((request) => request.id === id);
						if (at < 0) continue;
						queued.splice(at, 1);
						queueMicrotask(() =>
							post({
								type: "error",
								id,
								code: "cancelled",
								message: "cancelled",
							}),
						);
					}
					return;
				case "generate":
					if (options.manual) queued.push(message);
					else queueMicrotask(() => answer(message));
					return;
			}
		},
		addEventListener(type: "message" | "error", listener: never) {
			listeners[type].add(listener);
		},
		removeEventListener(type: "message" | "error", listener: never) {
			listeners[type].delete(listener);
		},
		terminate() {
			terminated++;
		},
	};

	return {
		worker,
		requests,
		/** The sentences asked for, in order. */
		get sentences() {
			return requests
				.filter((request): request is Generate => request.type === "generate")
				.map((request) => request.sentence);
		},
		get generations() {
			return requests.filter(
				(request): request is Generate => request.type === "generate",
			);
		},
		get cancelled() {
			return requests.flatMap((request) =>
				request.type === "cancel" ? request.ids : [],
			);
		},
		get queued() {
			return queued.map((request) => request.sentence);
		},
		get terminated() {
			return terminated;
		},
		/** In manual mode: answer the oldest waiting generation (or the one for `sentence`). */
		finish(sentence?: string) {
			const at =
				sentence === undefined
					? 0
					: queued.findIndex((request) => request.sentence === sentence);
			const [request] = at < 0 ? [] : queued.splice(at, 1);
			if (request) answer(request);
		},
		finishAll() {
			while (queued.length > 0) this.finish();
		},
		/** The next generation of `sentence` fails with `code`. */
		failOn(sentence: string, code: string) {
			failures.set(sentence, code);
		},
		setRatio(next: number) {
			ratio = next;
		},
		post,
		crash() {
			for (const listener of [...listeners.error])
				listener({ message: "crashed" });
		},
	};
}

/** The AudioSystem slice a Web Audio voice uses, over a FakeContext, recording what it was told. */
export function fakeVoiceAudio(
	options: { latency?: number; noWebAudio?: boolean } = {},
) {
	const context = new FakeContext();
	context.outputLatency = options.latency ?? 0;
	const voice = new FakeGain();
	const active: boolean[] = [];
	const order: string[] = [];
	let unlocked = false;
	let unlocks = 0;
	const audio = {
		get context() {
			return unlocked && !options.noWebAudio ? context : undefined;
		},
		get buses() {
			return unlocked && !options.noWebAudio
				? { voice, ambient: new FakeGain(), cue: new FakeGain() }
				: undefined;
		},
		unlock() {
			unlocks++;
			order.push("unlock");
			if (!options.noWebAudio) {
				unlocked = true;
				context.state = "running";
			}
			return Promise.resolve(!options.noWebAudio);
		},
		setVoiceActive(on: boolean) {
			active.push(on);
		},
	};
	return {
		audio,
		context,
		voice,
		active,
		order,
		get unlocks() {
			return unlocks;
		},
		/** Sources that were started and not stopped, and have not ended. */
		get playing() {
			return context.sources.filter(
				(source) =>
					source.startedAt !== undefined &&
					source.stoppedAt === undefined &&
					!(source as { ended?: boolean }).ended,
			);
		},
	};
}

/** Frames and hidden-tab timers for the audio Clock, run by the test. */
export function fakeScheduler() {
	let next = 1;
	const frames = new Map<number, () => void>();
	const timers = new Map<number, () => void>();
	return {
		options: {
			requestFrame: (callback: () => void) => {
				const id = next++;
				frames.set(id, callback);
				return id;
			},
			cancelFrame: (id: number) => {
				frames.delete(id);
			},
			setTimer: (callback: () => void) => {
				const id = next++;
				timers.set(id, callback);
				return id;
			},
			clearTimer: (id: unknown) => {
				timers.delete(id as number);
			},
		},
		/** An animation frame comes. */
		frame() {
			const run = [...frames.values()];
			frames.clear();
			for (const callback of run) callback();
		},
		/** The hidden-tab timer fires (no frames come in a hidden tab). */
		timer() {
			const run = [...timers.values()];
			timers.clear();
			for (const callback of run) callback();
		},
	};
}

/** Let the fake worker's replies and the promises after them settle. */
export async function settle(rounds = 20) {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
}
