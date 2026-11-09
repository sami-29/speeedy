import type { Document } from "@speeedy/contracts";
import {
	buildTimeline,
	createAudioClock,
	createEngine,
	createSpeechClock,
} from "@speeedy/engine";
import { createKokoroClient } from "@speeedy/kokoro/client";
import { describe, expect, it } from "vitest";
import { createListener } from "../src/lib/reader/listen/listener.ts";
import type {
	Speaker,
	SpeakHandlers,
	SpeakJob,
} from "../src/lib/reader/listen/speaker.ts";
import { memoryAudioCache } from "../src/lib/voice/audio-cache.ts";
import { createRenderer } from "../src/lib/voice/clip.ts";
import {
	createKokoroSpeaker,
	KOKORO_VOICE,
} from "../src/lib/voice/kokoro-speaker.ts";
import {
	fakeKokoroWorker,
	fakeScheduler,
	fakeVoiceAudio,
	settle,
} from "./fake-kokoro.ts";

/** The browser's voice, standing by for when the on-device one cannot go on. */
function fakeBrowser() {
	const jobs: SpeakJob[] = [];
	let cancels = 0;
	const speaker: Speaker = {
		speak(job) {
			jobs.push(job);
		},
		cancel() {
			cancels++;
		},
	};
	return {
		speaker,
		jobs,
		get cancels() {
			return cancels;
		},
	};
}

type RigOptions = Parameters<typeof fakeKokoroWorker>[0] &
	Parameters<typeof fakeVoiceAudio>[0] & { ahead?: number };

function rig(options: RigOptions = {}) {
	const kokoro = fakeKokoroWorker(options);
	const client = createKokoroClient(kokoro.worker);
	const sound = fakeVoiceAudio(options);
	const scheduler = fakeScheduler();
	const clock = createAudioClock(() => sound.audio.context, scheduler.options);
	const render = createRenderer({
		generate: (sentence, speed, signal) =>
			client.generate(sentence, { voice: "af_msa", speed }, signal),
		cache: memoryAudioCache(),
		voice: "af_msa",
	});
	const browser = fakeBrowser();
	const fallbacks: string[] = [];
	const played: number[] = [];
	const speaker = createKokoroSpeaker({
		render,
		audio: sound.audio,
		clock,
		fallback: browser.speaker,
		onFallback: (reason) => fallbacks.push(reason),
		onPlayed: (seconds) => played.push(seconds),
		...(options.ahead === undefined ? {} : { ahead: options.ahead }),
	});
	const events: string[] = [];
	const handlers: SpeakHandlers = {
		start: () => events.push("start"),
		boundary: (charIndex) => events.push(`word ${charIndex}`),
		end: () => events.push("end"),
		error: (kind) => events.push(`error ${kind}`),
	};
	/** The audio plays on by `seconds`; a frame comes, as it does in a visible tab. */
	const play = (seconds: number) => {
		sound.context.currentTime += seconds;
		scheduler.frame();
	};
	const job = (text: string, extra: Partial<SpeakJob> = {}): SpeakJob => ({
		text,
		lang: "en",
		voice: KOKORO_VOICE,
		rate: 1,
		...extra,
	});
	return {
		kokoro,
		client,
		sound,
		scheduler,
		speaker,
		browser,
		fallbacks,
		played,
		events,
		handlers,
		play,
		job,
		/** The source started last. */
		get source() {
			return sound.context.sources.at(-1);
		},
	};
}

describe("The on-device voice: playing a sentence", () => {
	it("unlocks the audio inside the reader's gesture, before anything waits", () => {
		const r = rig();
		r.speaker.speak(r.job("One two three."), r.handlers);
		// Nothing has been awaited yet: the context was asked for in the same turn.
		expect(r.sound.unlocks).toBe(1);
	});

	it("plays the sentence's audio through the voice bus and says the voice is active", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two three."), r.handlers);
		await settle();
		const source = r.source;
		expect(source?.startedAt).toBe(0);
		expect(source?.reaches(r.sound.voice)).toBe(true);
		expect(source?.buffer?.length).toBe(18_000);
		expect(r.sound.active).toEqual([true]);
		expect(r.events[0]).toBe("start");
	});

	it("reports each word when the audio reaches it, never before (golden)", async () => {
		const r = rig({ latency: 0.02 });
		r.speaker.speak(r.job("One two three."), r.handlers);
		await settle();
		const seen: [number, string[]][] = [];
		for (const at of [0.01, 0.02, 0.26, 0.27, 0.5, 0.52, 0.74]) {
			r.play(at - r.sound.context.currentTime);
			seen.push([at, [...r.events]]);
		}
		expect(seen).toEqual([
			[0.01, ["start"]],
			[0.02, ["start", "word 0"]],
			[0.26, ["start", "word 0"]],
			[0.27, ["start", "word 0", "word 4"]],
			[0.5, ["start", "word 0", "word 4"]],
			[0.52, ["start", "word 0", "word 4", "word 8"]],
			[0.74, ["start", "word 0", "word 4", "word 8"]],
		]);
	});

	it("ends the sentence when its audio has played", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two."), r.handlers);
		await settle();
		r.play(0.5);
		r.source?.end();
		expect(r.events.at(-1)).toBe("end");
	});

	it("goes on reporting words from the slower timer in a hidden tab, where no frames come", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two three."), r.handlers);
		await settle();
		r.sound.context.currentTime = 0.6;
		r.scheduler.timer();
		expect(r.events).toContain("word 8");
	});

	it("starts part-way through from the word's own time in the whole sentence's audio", async () => {
		const r = rig();
		r.speaker.speak(
			r.job("three four.", {
				sentence: { text: "One two three four.", at: 8 },
			}),
			r.handlers,
		);
		await settle();
		expect(r.kokoro.sentences[0]).toBe("One two three four.");
		// Two of four words are skipped: half a second of the second's audio is left.
		expect(r.source?.buffer?.length).toBe(12_000);
		expect(r.events).toEqual(["start", "word 0"]);
		r.play(0.26);
		expect(r.events).toEqual(["start", "word 0", "word 6"]);
	});

	it("speaks at the speed chosen when the audio is made, never with a playback rate", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two.", { rate: 1.3 }), r.handlers);
		await settle();
		expect(r.kokoro.generations[0]?.speed).toBe(1.3);
		expect(r.source && "playbackRate" in r.source).toBe(false);
		r.speaker.speak(r.job("One two.", { rate: 4 }), r.handlers);
		await settle();
		expect(r.kokoro.generations.at(-1)?.speed).toBe(1.5);
	});

	it("tells how many seconds of its audio were heard", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two."), r.handlers);
		await settle();
		r.play(0.5);
		r.source?.end();
		expect(r.played.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5);
	});
});

describe("The on-device voice: preparing ahead", () => {
	it("makes the next sentences while one plays, so the next starts as this one ends", async () => {
		const r = rig();
		r.speaker.speak(
			r.job("One two.", { next: ["Three four.", "Five six."] }),
			r.handlers,
		);
		await settle();
		expect(r.kokoro.sentences).toEqual([
			"One two.",
			"Three four.",
			"Five six.",
		]);
		r.play(0.5);
		r.source?.end();
		r.speaker.speak(r.job("Three four.", { next: ["Five six."] }), r.handlers);
		await settle(2);
		// No new generation, and the next sentence starts where the first ended.
		expect(r.kokoro.sentences).toHaveLength(3);
		expect(r.source?.startedAt).toBeCloseTo(0.5);
	});

	it("stays at most three sentences ahead", async () => {
		const r = rig();
		r.speaker.speak(
			r.job("A one.", { next: ["B two.", "C three.", "D four.", "E five."] }),
			r.handlers,
		);
		await settle();
		expect(r.kokoro.sentences).toEqual([
			"A one.",
			"B two.",
			"C three.",
			"D four.",
		]);
	});

	it("cancels the queued work a seek has left behind", async () => {
		const r = rig({ manual: true });
		r.speaker.speak(
			r.job("A one.", { next: ["B two.", "C three.", "D four."] }),
			r.handlers,
		);
		await settle();
		r.speaker.cancel();
		r.speaker.speak(r.job("Z last.", { next: [] }), r.handlers);
		await settle();
		expect(r.kokoro.queued).toEqual(["Z last."]);
		const ids = r.kokoro.generations
			.filter((g) => g.sentence !== "Z last.")
			.map((g) => g.id);
		expect(r.kokoro.cancelled.sort()).toEqual(ids.sort());
		r.kokoro.finish();
		await settle();
		expect(r.sound.context.sources).toHaveLength(1);
		expect(r.fallbacks).toEqual([]);
		expect(r.events.filter((e) => e.startsWith("error"))).toEqual([]);
	});

	it("keeps work still wanted after a seek: the next sentence is not made twice", async () => {
		const r = rig({ manual: true });
		r.speaker.speak(r.job("A one.", { next: ["B two."] }), r.handlers);
		await settle();
		r.speaker.speak(r.job("B two.", { next: ["C three."] }), r.handlers);
		await settle();
		expect(r.kokoro.sentences.filter((s) => s === "B two.")).toHaveLength(1);
	});
});

describe("The on-device voice: pause, cancel and no double playing", () => {
	it("stops its audio at once when cancelled, and reports nothing after", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two three."), r.handlers);
		await settle();
		const source = r.source;
		r.speaker.cancel();
		expect(source?.stoppedAt).toBeDefined();
		expect(source?.disconnected).toBe(true);
		expect(r.sound.active).toEqual([true, false]);
		const before = [...r.events];
		r.play(1);
		source?.end();
		expect(r.events).toEqual(before);
		expect(r.sound.playing).toEqual([]);
	});

	it("never plays a sentence that was cancelled before its audio was ready", async () => {
		const r = rig({ manual: true });
		r.speaker.speak(r.job("One two."), r.handlers);
		r.speaker.cancel();
		await settle();
		r.kokoro.finishAll();
		await settle();
		expect(r.sound.context.sources).toEqual([]);
		expect(r.events).toEqual([]);
	});

	it("plays one sentence at a time: a new one stops the one before first", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two."), r.handlers);
		await settle();
		const first = r.source;
		r.speaker.speak(r.job("Three four."), r.handlers);
		expect(first?.stoppedAt).toBeDefined();
		await settle();
		expect(r.sound.playing).toHaveLength(1);
		expect(r.sound.playing[0]).not.toBe(first);
	});

	it("when two sentences are asked for before either is ready, plays only the last", async () => {
		const r = rig({ manual: true });
		r.speaker.speak(r.job("One two."), r.handlers);
		r.speaker.speak(r.job("Three four."), r.handlers);
		await settle();
		r.kokoro.finishAll();
		await settle();
		expect(r.sound.context.sources).toHaveLength(1);
		expect(r.sound.context.buffers[0]?.length).toBe(12_000);
	});

	it("resumes from the word it stopped on with the audio it already has", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two three."), r.handlers);
		await settle();
		r.play(0.3);
		r.speaker.cancel();
		r.speaker.speak(
			r.job("two three.", { sentence: { text: "One two three.", at: 4 } }),
			r.handlers,
		);
		await settle();
		expect(r.kokoro.sentences).toEqual(["One two three."]);
		expect(r.source?.buffer?.length).toBe(12_000);
	});

	it("ignores the ended event of a sentence it stopped", async () => {
		const r = rig();
		r.speaker.speak(r.job("One two."), r.handlers);
		await settle();
		const first = r.source;
		r.speaker.speak(r.job("Three four."), r.handlers);
		await settle();
		const ends = r.events.filter((e) => e === "end").length;
		first?.end();
		expect(r.events.filter((e) => e === "end")).toHaveLength(ends);
	});
});

describe("The on-device voice: when it cannot go on", () => {
	it("hands the sentence to the browser's voice when the worker fails, and says so", async () => {
		const r = rig();
		r.kokoro.failOn("One two.", "failed");
		const job = r.job("One two.");
		r.speaker.speak(job, r.handlers);
		await settle();
		expect(r.fallbacks).toEqual(["failed"]);
		expect(r.browser.jobs).toEqual([{ ...job, voice: undefined }]);
		expect(r.sound.context.sources).toEqual([]);
	});

	it("sends every later sentence to the browser's voice once it has failed", async () => {
		const r = rig();
		r.kokoro.failOn("One two.", "bad-output");
		r.speaker.speak(r.job("One two."), r.handlers);
		await settle();
		r.speaker.speak(r.job("Three four."), r.handlers);
		await settle();
		expect(r.browser.jobs.map((job) => job.text)).toEqual([
			"One two.",
			"Three four.",
		]);
		expect(r.fallbacks).toEqual(["failed"]);
	});

	it("hands over when the worker dies", async () => {
		const r = rig({ manual: true });
		r.speaker.speak(r.job("One two."), r.handlers);
		await settle();
		r.kokoro.crash();
		await settle();
		expect(r.fallbacks).toEqual(["failed"]);
		expect(r.browser.jobs.map((job) => job.text)).toEqual(["One two."]);
	});

	it("reports a failure as an error when there is no browser voice to hand over to", async () => {
		const kokoro = fakeKokoroWorker();
		kokoro.failOn("One two.", "failed");
		const client = createKokoroClient(kokoro.worker);
		const sound = fakeVoiceAudio();
		const events: string[] = [];
		const speaker = createKokoroSpeaker({
			render: createRenderer({
				generate: (s, speed, signal) =>
					client.generate(s, { voice: "af_msa", speed }, signal),
				cache: memoryAudioCache(),
				voice: "af_msa",
			}),
			audio: sound.audio,
			clock: createAudioClock(
				() => sound.audio.context,
				fakeScheduler().options,
			),
		});
		speaker.speak(
			{ text: "One two.", rate: 1, voice: KOKORO_VOICE },
			{
				start: () => events.push("start"),
				boundary: () => events.push("word"),
				end: () => events.push("end"),
				error: (kind) => events.push(`error ${kind}`),
			},
		);
		await settle();
		expect(events).toEqual(["error failed"]);
	});

	it("hands over when the browser has no Web Audio", async () => {
		const r = rig({ noWebAudio: true });
		r.speaker.speak(r.job("One two."), r.handlers);
		await settle();
		expect(r.fallbacks).toEqual(["failed"]);
		expect(r.browser.jobs).toHaveLength(1);
	});

	it("ends at once a sentence it has nothing to say for", async () => {
		const r = rig();
		r.kokoro.failOn("…", "empty");
		r.speaker.speak(r.job("…"), r.handlers);
		await settle();
		expect(r.events).toEqual(["start", "end"]);
		expect(r.fallbacks).toEqual([]);
	});

	it("hands over to the browser's voice when it makes audio slower than it plays", async () => {
		const r = rig({ ratio: 1.6 });
		const sentences = ["A one.", "B two.", "C three.", "D four."];
		for (const [i, text] of sentences.entries()) {
			r.speaker.speak(r.job(text), r.handlers);
			await settle();
			r.play(0.5);
			r.source?.end();
			if (i === 0) expect(r.fallbacks).toEqual([]);
		}
		expect(r.fallbacks).toEqual(["slow"]);
	});

	it("does not count the first, warm-up sentence as slow", async () => {
		const r = rig({ ratio: 0.2 });
		r.kokoro.setRatio(5);
		r.speaker.speak(r.job("A one."), r.handlers);
		await settle();
		r.kokoro.setRatio(0.2);
		for (const text of ["B two.", "C three.", "D four.", "E five."]) {
			r.speaker.speak(r.job(text), r.handlers);
			await settle();
		}
		expect(r.fallbacks).toEqual([]);
	});

	it("keeps its own voice when it makes audio faster than it plays", async () => {
		const r = rig({ ratio: 0.4 });
		for (const text of ["A one.", "B two.", "C three.", "D four.", "E five."]) {
			r.speaker.speak(r.job(text), r.handlers);
			await settle();
		}
		expect(r.fallbacks).toEqual([]);
	});

	it("does not count audio played again from its cache as fast or slow", async () => {
		const r = rig({ ratio: 3 });
		r.speaker.speak(r.job("A one."), r.handlers);
		await settle();
		r.kokoro.setRatio(0.1);
		for (let i = 0; i < 4; i++) {
			r.speaker.speak(r.job("A one."), r.handlers);
			await settle();
		}
		expect(r.kokoro.sentences).toHaveLength(1);
		expect(r.fallbacks).toEqual([]);
	});
});

const paragraphs = (...texts: string[]): Document => ({
	version: 1,
	blocks: texts.map((text) => ({ kind: "paragraph", text, spans: [] })),
});

const DOC = paragraphs("One two. Three four five. Six.");

/** Listen on the on-device voice, with the real Engine and Listener. */
function listening(doc: Document = DOC, options: RigOptions = {}) {
	const r = rig(options);
	const clock = createSpeechClock();
	const engine = createEngine({ clock, document: doc, settings: { wpm: 300 } });
	const listener = createListener({
		engine,
		document: doc,
		clock,
		speaker: r.speaker,
		voice: KOKORO_VOICE,
		language: "en",
		timers: { set: () => 0, clear: () => {} },
	});
	const word = () => {
		const h = listener.highlight;
		const block = h ? doc.blocks[h.block] : undefined;
		return h && block && "text" in block ? block.text.slice(h.from, h.to) : "";
	};
	return {
		...r,
		engine,
		listener,
		word,
		/** The source started last. */
		get source() {
			return r.sound.context.sources.at(-1);
		},
	};
}

describe("Listen on the on-device voice", () => {
	it("moves the Cursor and the highlight with the audio being heard", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		expect(l.word()).toBe("One");
		l.play(0.26);
		expect(l.engine.frame?.text).toBe("two.");
		expect(l.word()).toBe("two.");
		l.play(0.25);
		l.source?.end();
		await settle();
		expect(l.engine.frame?.text).toBe("Three");
		expect(l.word()).toBe("Three");
	});

	it("keeps the audio and the highlight together through a Timeline rebuild, without playing twice", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		l.source?.end();
		await settle();
		l.play(0.1);
		const sources = l.sound.context.sources.length;
		l.engine.replaceTimeline(buildTimeline(DOC, { wpm: 300, chunkSize: 2 }), {
			chunkSize: 2,
		});
		await settle();
		expect(l.sound.context.sources).toHaveLength(sources);
		expect(l.sound.playing).toHaveLength(1);
		l.play(0.2);
		expect(l.engine.frame?.text).toBe("Three four");
		expect(l.word()).toBe("four");
	});

	it("keeps them together through a change of reading speed", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		l.engine.setWpm(600);
		l.play(0.26);
		expect(l.word()).toBe("two.");
		expect(l.sound.playing).toHaveLength(1);
	});

	it("stops the old audio on a seek and plays the new sentence once", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		const first = l.source;
		l.engine.seek({ block: 0, offset: 27 });
		expect(first?.stoppedAt).toBeDefined();
		await settle();
		expect(l.sound.playing).toHaveLength(1);
		expect(l.word()).toBe("Six.");
		expect(l.engine.frame?.text).toBe("Six.");
	});

	it("goes back a sentence with the audio it already made, in step", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		l.source?.end();
		await settle();
		l.play(0.3);
		expect(l.word()).toBe("four");
		l.engine.back("sentence");
		await settle();
		expect(l.sound.playing).toHaveLength(1);
		expect(l.word()).toBe("Three");
		expect(
			l.kokoro.sentences.filter((s) => s === "Three four five."),
		).toHaveLength(1);
	});

	it("leaves no audio playing while paused, and picks up at the word on play", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		l.play(0.26);
		l.engine.pause();
		expect(l.sound.playing).toEqual([]);
		expect(l.sound.active.at(-1)).toBe(false);
		l.play(5);
		expect(l.engine.frame?.text).toBe("two.");
		l.engine.play();
		await settle();
		expect(l.sound.playing).toHaveLength(1);
		expect(l.source?.buffer?.length).toBe(6_000);
		expect(l.word()).toBe("two.");
	});

	it("makes the audio again at a new voice speed, from the word it is on", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		l.play(0.26);
		l.listener.setRate(1.2);
		await settle();
		expect(l.kokoro.generations).toContainEqual(
			expect.objectContaining({ sentence: "One two.", speed: 1.2 }),
		);
		expect(l.sound.playing).toHaveLength(1);
		expect(l.word()).toBe("two.");
	});

	it("ends with the document and leaves nothing playing", async () => {
		const l = listening(paragraphs("Only one."));
		l.engine.play();
		await settle();
		l.play(0.5);
		l.source?.end();
		await settle();
		expect(l.engine.playing).toBe(false);
		expect(l.sound.playing).toEqual([]);
	});

	it("leaves no audio when Listen is left", async () => {
		const l = listening();
		l.engine.play();
		await settle();
		l.listener.dispose();
		expect(l.sound.playing).toEqual([]);
	});
});
