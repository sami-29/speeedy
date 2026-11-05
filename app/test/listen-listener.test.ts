import type { Document } from "@speeedy/contracts";
import {
	buildTimeline,
	createEngine,
	createSpeechClock,
	type Engine,
	type EngineEventName,
} from "@speeedy/engine";
import { describe, expect, it } from "vitest";
import {
	createListener,
	type Listener,
	WATCHDOG_MS,
} from "../src/lib/reader/listen/listener.ts";
import type {
	Speaker,
	SpeakHandlers,
	SpeakJob,
} from "../src/lib/reader/listen/speaker.ts";
import type { VoiceLike } from "../src/lib/reader/listen/voices.ts";

const paragraphs = (...texts: string[]): Document => ({
	version: 1,
	blocks: texts.map((text) => ({ kind: "paragraph", text, spans: [] })),
});

/** A Speaker that records what it was asked to say; the test plays the browser's part. */
function fakeSpeaker() {
	const jobs: { job: SpeakJob; handlers: SpeakHandlers }[] = [];
	let cancels = 0;
	let active: SpeakHandlers | undefined;
	const speaker: Speaker = {
		speak(job, handlers) {
			jobs.push({ job, handlers });
			active = handlers;
		},
		cancel() {
			cancels++;
			active = undefined;
		},
	};
	return {
		speaker,
		jobs,
		get cancels() {
			return cancels;
		},
		get texts() {
			return jobs.map((entry) => entry.job.text);
		},
		/** The browser says the current sentence began. */
		start() {
			active?.start();
		},
		boundary(charIndex: number) {
			active?.boundary(charIndex);
		},
		end() {
			active?.end();
		},
		error(kind: "blocked" | "failed") {
			active?.error(kind);
		},
		last() {
			return jobs[jobs.length - 1] as (typeof jobs)[number];
		},
	};
}

function fakeTimers() {
	let next = 1;
	const pending = new Map<number, () => void>();
	return {
		set(fn: () => void) {
			const id = next++;
			pending.set(id, fn);
			return id;
		},
		clear(handle: unknown) {
			pending.delete(handle as number);
		},
		/** The time passes: run what was waiting. */
		fire() {
			const run = [...pending.values()];
			pending.clear();
			for (const fn of run) fn();
		},
		get waiting() {
			return pending.size;
		},
	};
}

type Options = {
	language?: string;
	voice?: VoiceLike;
	rate?: number;
	seekDelayMs?: number;
	settings?: Parameters<typeof createEngine>[0]["settings"];
};

function setup(doc: Document, options: Options = {}) {
	const clock = createSpeechClock();
	const engine = createEngine({
		clock,
		document: doc,
		settings: { wpm: 300, ...options.settings },
	});
	const speech = fakeSpeaker();
	const timers = fakeTimers();
	const listener = createListener({
		engine,
		document: doc,
		clock,
		speaker: speech.speaker,
		timers,
		...(options.language ? { language: options.language } : {}),
		...(options.voice ? { voice: options.voice } : {}),
		...(options.rate ? { rate: options.rate } : {}),
		...(options.seekDelayMs ? { seekDelayMs: options.seekDelayMs } : {}),
	});
	const events: string[] = [];
	for (const name of [
		"play",
		"pause",
		"seek",
		"end",
		"frameShown",
	] as EngineEventName[]) {
		engine.on(name, () => events.push(name));
	}
	return { clock, engine, speech, timers, listener, events };
}

const DOC = paragraphs("One two. Three four five. Six.");

/** The text a highlight covers. */
function textOf(doc: Document, listener: Listener): string {
	const h = listener.highlight;
	if (!h) return "";
	const block = doc.blocks[h.block];
	const text = block && "text" in block ? block.text : "";
	return text.slice(h.from, h.to);
}

describe("Listen: speaking", () => {
	it("says nothing until the reader plays", () => {
		const { speech } = setup(DOC);
		expect(speech.jobs).toEqual([]);
	});

	it("speaks the sentence under the Cursor, and only that one", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		expect(speech.texts).toEqual(["One two."]);
	});

	it("speaks the next sentence only when the one before has ended", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		speech.start();
		expect(speech.texts).toHaveLength(1);
		speech.end();
		expect(speech.texts).toEqual(["One two.", "Three four five."]);
		speech.start();
		speech.end();
		expect(speech.texts).toEqual(["One two.", "Three four five.", "Six."]);
	});

	it("asks for the document's language, the chosen voice and the speed", () => {
		const voice: VoiceLike = {
			voiceURI: "v",
			name: "V",
			lang: "fr-FR",
			localService: true,
			default: false,
		};
		const { engine, speech } = setup(DOC, {
			language: "fr",
			voice,
			rate: 1.2,
		});
		engine.play();
		expect(speech.last().job).toMatchObject({ lang: "fr", voice, rate: 1.2 });
	});

	it("leaves the language out when it is not known", () => {
		const { engine, speech } = setup(DOC, { language: "und" });
		engine.play();
		expect(speech.last().job.lang).toBeUndefined();
	});

	it("ends a sentence at the end of a block, with or without punctuation", () => {
		const doc = paragraphs("A heading here", "Then a paragraph.");
		const { engine, speech } = setup(doc);
		engine.play();
		speech.end();
		expect(speech.texts).toEqual(["A heading here", "Then a paragraph."]);
	});

	it("starts from the word the Cursor is on when a mode switch left it mid-sentence", () => {
		const { engine, speech } = setup(DOC);
		engine.seek({ block: 0, offset: 15 });
		engine.play();
		expect(speech.texts).toEqual(["four five."]);
	});

	it("finishes the document: the Engine ends and nothing more is spoken", () => {
		const { engine, speech, events, listener } = setup(paragraphs("Only one."));
		engine.play();
		speech.start();
		speech.end();
		expect(events).toContain("end");
		expect(engine.playing).toBe(false);
		expect(speech.jobs).toHaveLength(1);
		expect(listener.status).toBe("idle");
	});

	it("counts the last sentence's words before it ends", () => {
		const { engine, speech } = setup(paragraphs("Only one here."));
		const shown: string[] = [];
		engine.on("frameShown", ({ frame }) => shown.push(frame.text));
		engine.play();
		speech.end();
		expect(shown).toEqual(["Only", "one", "here."]);
		expect(engine.playing).toBe(false);
	});

	it("speaks the document again from the top when played after the end", () => {
		const { engine, speech } = setup(paragraphs("Only one."));
		engine.play();
		speech.end();
		engine.play();
		expect(speech.texts).toEqual(["Only one.", "Only one."]);
	});
});

describe("Listen: what a voice that prepares its audio is told", () => {
	it("gives the whole sentence and where the spoken text starts in it", () => {
		const { engine, speech } = setup(DOC);
		engine.seek({ block: 0, offset: 15 });
		engine.play();
		expect(speech.last().job).toMatchObject({
			text: "four five.",
			sentence: { text: "Three four five.", at: 6 },
		});
	});

	it("names the sentences that follow, so they can be prepared ahead", () => {
		const doc = paragraphs("One two. Three four five.", "Six. Seven.");
		const { engine, speech } = setup(doc);
		engine.play();
		expect(speech.last().job.next).toEqual([
			"Three four five.",
			"Six.",
			"Seven.",
		]);
		speech.end();
		expect(speech.last().job.next).toEqual(["Six.", "Seven."]);
	});

	it("names no more than three, and none past the end", () => {
		const doc = paragraphs("One. Two. Three. Four. Five.");
		const { engine, speech } = setup(doc);
		engine.play();
		expect(speech.last().job.next).toEqual(["Two.", "Three.", "Four."]);
		engine.seek({ block: 0, offset: 23 });
		expect(speech.last().job.next).toEqual([]);
	});

	it("tells the voice the next sentences again after a seek", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		engine.seek({ block: 0, offset: 27 });
		expect(speech.last().job).toMatchObject({
			text: "Six.",
			sentence: { text: "Six.", at: 0 },
			next: [],
		});
	});
});

describe("Listen: the highlight", () => {
	it("marks the whole sentence before any word is reported", () => {
		const { engine, speech, listener } = setup(DOC);
		expect(listener.highlight).toMatchObject({ kind: "sentence" });
		expect(textOf(DOC, listener)).toBe("One two.");
		engine.play();
		speech.start();
		expect(listener.highlight?.kind).toBe("sentence");
		expect(textOf(DOC, listener)).toBe("One two.");
	});

	it("follows the spoken word when the browser reports word boundaries", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(0);
		expect(listener.highlight?.kind).toBe("word");
		expect(textOf(DOC, listener)).toBe("One");
		speech.boundary(4);
		expect(textOf(DOC, listener)).toBe("two.");
		expect(listener.wordSync).toBe("word");
	});

	it("moves the Cursor to the spoken word, so progress and position follow", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(4);
		expect(engine.frame?.text).toBe("two.");
		speech.end();
		speech.start();
		speech.boundary(6);
		expect(engine.frame?.text).toBe("four");
	});

	it("keeps the Cursor on the first word of the sentence without boundaries: no word timing is made up", () => {
		const { engine, speech, listener, timers } = setup(DOC);
		engine.play();
		speech.start();
		timers.fire();
		expect(engine.frame?.text).toBe("One");
		expect(listener.highlight?.kind).toBe("sentence");
		speech.end();
		expect(engine.frame?.text).toBe("Three");
		expect(textOf(DOC, listener)).toBe("Three four five.");
	});

	it("counts every word of a finished sentence as shown, whether or not the voice reported them", () => {
		const { engine, speech, timers } = setup(DOC);
		const shown: string[] = [];
		engine.on("frameShown", ({ frame }) => shown.push(frame.text));
		engine.play();
		speech.start();
		timers.fire();
		speech.end();
		// Sessions count the Frames shown: the whole sentence was heard, so the whole sentence counts.
		expect(shown).toEqual(["One", "two.", "Three"]);
	});

	it("shows every Frame once, in order, even when the voice skips a word", () => {
		const { engine, speech } = setup(DOC);
		const shown: string[] = [];
		engine.on("frameShown", ({ frame }) => shown.push(frame.text));
		engine.play();
		speech.start();
		speech.end();
		speech.start();
		speech.boundary(0);
		// The voice jumped from "Three" to "five.": "four" was still spoken.
		speech.boundary(11);
		speech.end();
		expect(shown).toEqual(["One", "two.", "Three", "four", "five.", "Six."]);
	});

	it("is always on the sentence being spoken, never ahead of it", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(0);
		speech.boundary(4);
		// The next sentence has not started: the highlight has not left this one.
		expect(textOf(DOC, listener)).toBe("two.");
		speech.end();
		expect(textOf(DOC, listener)).toMatch(/^Three/);
		expect(engine.frame?.text).toBe("Three");
	});

	it("tells subscribers when the highlight changes", () => {
		const { engine, speech, listener } = setup(DOC);
		let calls = 0;
		listener.subscribe(() => calls++);
		engine.play();
		speech.start();
		speech.boundary(4);
		expect(calls).toBeGreaterThan(0);
	});

	it("ignores a boundary that points outside the sentence", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(0);
		speech.boundary(500);
		speech.boundary(-4);
		expect(textOf(DOC, listener)).toBe("One");
	});

	it("never moves the Cursor backwards on a late boundary", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(4);
		speech.boundary(0);
		expect(engine.frame?.text).toBe("two.");
	});
});

describe("Listen: word boundaries that may never come", () => {
	it("knows nothing about word timing until a boundary arrives, and says so plainly after 1.5 s without one", () => {
		const { engine, speech, listener, timers } = setup(DOC);
		expect(WATCHDOG_MS).toBe(1500);
		engine.play();
		speech.start();
		expect(listener.wordSync).toBe("unknown");
		timers.fire();
		expect(listener.wordSync).toBe("sentence");
	});

	it("does not call the voice sentence-only once a boundary has come", () => {
		const { engine, speech, listener, timers } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(0);
		timers.fire();
		expect(listener.wordSync).toBe("word");
	});

	it("changes its mind if boundaries start late", () => {
		const { engine, speech, listener, timers } = setup(DOC);
		engine.play();
		speech.start();
		timers.fire();
		expect(listener.wordSync).toBe("sentence");
		speech.boundary(4);
		expect(listener.wordSync).toBe("word");
		expect(listener.highlight?.kind).toBe("word");
	});

	it("starts the next sentence on its first word for a voice that reports boundaries", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(0);
		speech.end();
		expect(listener.highlight?.kind).toBe("word");
		expect(textOf(DOC, listener)).toBe("Three");
	});

	it("starts the next sentence on the whole sentence for a voice that has none", () => {
		const { engine, speech, listener, timers } = setup(DOC);
		engine.play();
		speech.start();
		timers.fire();
		speech.end();
		expect(listener.highlight?.kind).toBe("sentence");
	});

	it("remembers each voice's answer, so a voice switch asks again", () => {
		const a: VoiceLike = {
			voiceURI: "a",
			name: "A",
			lang: "en-US",
			localService: true,
			default: false,
		};
		const b = { ...a, voiceURI: "b", name: "B" };
		const { engine, speech, listener, timers } = setup(DOC, { voice: a });
		engine.play();
		speech.start();
		speech.boundary(0);
		listener.setVoice(b);
		expect(listener.wordSync).toBe("unknown");
		speech.start();
		timers.fire();
		expect(listener.wordSync).toBe("sentence");
		listener.setVoice(a);
		expect(listener.wordSync).toBe("word");
	});

	it("does not leave a timer running after a pause", () => {
		const { engine, speech, timers } = setup(DOC);
		engine.play();
		speech.start();
		engine.pause();
		expect(timers.waiting).toBe(0);
	});
});

describe("Listen: pause, resume, seek and rewind", () => {
	it("stops the voice when the reader pauses", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		const before = speech.cancels;
		engine.pause();
		expect(speech.cancels).toBe(before + 1);
		expect(listener.status).toBe("idle");
	});

	it("picks up at the word it stopped on when the voice reports words", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(4);
		engine.pause();
		engine.play();
		expect(speech.last().job.text).toBe("two.");
	});

	it("picks up at the start of the sentence when the voice reports no words", () => {
		const { engine, speech, timers } = setup(DOC);
		engine.play();
		speech.start();
		timers.fire();
		engine.pause();
		engine.play();
		expect(speech.last().job.text).toBe("One two.");
	});

	it("goes back one sentence while playing: cancels, then speaks the one before", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		speech.end();
		speech.start();
		expect(speech.last().job.text).toBe("Three four five.");
		const before = speech.cancels;
		engine.back("sentence");
		expect(speech.cancels).toBeGreaterThan(before);
		expect(speech.last().job.text).toBe("One two.");
	});

	it("goes to the start of the sentence it is in, when the Cursor is part-way through", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		speech.end();
		speech.start();
		speech.boundary(6);
		engine.back("sentence");
		expect(speech.last().job.text).toBe("Three four five.");
	});

	it("moves the Cursor without speaking while paused, and speaks from there on play", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.seek({ block: 0, offset: 9 });
		expect(speech.jobs).toEqual([]);
		expect(textOf(DOC, listener)).toBe("Three four five.");
		engine.play();
		expect(speech.last().job.text).toBe("Three four five.");
	});

	it("drops what the old sentence says after a seek", () => {
		const { engine, speech, events } = setup(DOC);
		engine.play();
		speech.start();
		const oldEnd = speech.last().handlers;
		engine.seek({ block: 0, offset: 9 });
		expect(speech.last().job.text).toBe("Three four five.");
		const spoken = speech.jobs.length;
		const seen = events.length;
		oldEnd.end();
		oldEnd.boundary(0);
		expect(speech.jobs).toHaveLength(spoken);
		expect(events).toHaveLength(seen);
	});

	it("shows the sentence of the Cursor after a rewind, not the last word", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(4);
		engine.pause();
		engine.back("sentence");
		expect(textOf(DOC, listener)).toBe("One two.");
	});
});

describe("Listen: scrubbing the progress bar", () => {
	it("speaks once, from where the reader stopped, not at every step of a drag", () => {
		const { engine, speech, timers } = setup(DOC, { seekDelayMs: 150 });
		engine.play();
		const before = speech.jobs.length;
		engine.seek({ block: 0, offset: 9 });
		engine.seek({ block: 0, offset: 15 });
		engine.seek({ block: 0, offset: 26 });
		expect(speech.jobs).toHaveLength(before);
		timers.fire();
		expect(speech.jobs).toHaveLength(before + 1);
		expect(speech.last().job.text).toBe("Six.");
	});

	it("says nothing from a drag the reader paused in the middle of", () => {
		const { engine, speech, timers } = setup(DOC, { seekDelayMs: 150 });
		engine.play();
		engine.seek({ block: 0, offset: 9 });
		engine.pause();
		const spoken = speech.jobs.length;
		timers.fire();
		expect(speech.jobs).toHaveLength(spoken);
	});

	it("drops the pending sentence when the listener is disposed", () => {
		const { engine, speech, timers, listener } = setup(DOC, {
			seekDelayMs: 150,
		});
		engine.play();
		engine.seek({ block: 0, offset: 9 });
		listener.dispose();
		expect(timers.waiting).toBe(0);
		const spoken = speech.jobs.length;
		timers.fire();
		expect(speech.jobs).toHaveLength(spoken);
	});
});

describe("Listen: live setting changes", () => {
	it("speaks on at the new speed from the word it is on, without moving the Cursor", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(4);
		const frame = engine.frame;
		listener.setRate(1.5);
		expect(speech.last().job).toMatchObject({ text: "two.", rate: 1.5 });
		expect(engine.frame).toBe(frame);
	});

	it("holds the new speed for the next sentence and the next play", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		listener.setRate(0.8);
		speech.end();
		expect(speech.last().job.rate).toBe(0.8);
		engine.pause();
		listener.setRate(1.1);
		const spoken = speech.jobs.length;
		expect(speech.jobs).toHaveLength(spoken);
		engine.play();
		expect(speech.last().job.rate).toBe(1.1);
	});

	it("says nothing when the speed changes while paused", () => {
		const { speech, listener } = setup(DOC);
		listener.setRate(1.4);
		expect(speech.jobs).toEqual([]);
	});

	it("switches voice from the Cursor", () => {
		const voice: VoiceLike = {
			voiceURI: "v",
			name: "V",
			lang: "en-US",
			localService: true,
			default: false,
		};
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		listener.setVoice(voice);
		expect(speech.last().job.voice).toBe(voice);
		expect(speech.last().job.text).toBe("One two.");
	});

	it("takes a new Timeline from a settings rebuild without losing the spoken word", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(0);
		// Chunks of two words: the Frames are not the ones the sentence was planned on.
		engine.replaceTimeline(buildTimeline(DOC, { wpm: 300, chunkSize: 2 }), {
			chunkSize: 2,
		});
		speech.boundary(4);
		expect(textOf(DOC, listener)).toBe("two.");
		speech.end();
		expect(speech.last().job.text).toBe("Three four five.");
		speech.start();
		speech.boundary(6);
		// The Cursor is on the chunk that holds the spoken word; the highlight is the word.
		expect(engine.frame?.text).toBe("Three four");
		expect(textOf(DOC, listener)).toBe("four");
	});

	it("carries on through a speed change that rescales the Frames", () => {
		const { engine, speech } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(4);
		engine.setWpm(600);
		speech.end();
		expect(engine.frame?.text).toBe("Three");
		speech.start();
		speech.boundary(6);
		expect(engine.frame?.text).toBe("four");
	});
});

describe("Listen: when the voice fails", () => {
	it("stops and says the browser blocked it, then tries again on the next play", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.error("blocked");
		expect(engine.playing).toBe(false);
		expect(listener.status).toBe("blocked");
		engine.play();
		expect(listener.status).toBe("speaking");
		expect(speech.jobs).toHaveLength(2);
	});

	it("stops and says the voice failed", () => {
		const { engine, speech, listener } = setup(DOC);
		engine.play();
		speech.start();
		speech.error("failed");
		expect(engine.playing).toBe(false);
		expect(listener.status).toBe("failed");
	});
});

describe("Listen: leaving", () => {
	it("cancels the voice and lets go of the Engine and the Clock when disposed", () => {
		const { engine, speech, listener, timers } = setup(DOC);
		engine.play();
		speech.start();
		const before = speech.cancels;
		listener.dispose();
		expect(speech.cancels).toBeGreaterThan(before);
		expect(timers.waiting).toBe(0);
		engine.pause();
		engine.play();
		expect(speech.jobs).toHaveLength(1);
		let calls = 0;
		listener.subscribe(() => calls++);
		speech.boundary(4);
		expect(calls).toBe(0);
	});

	it("can be disposed twice and before it ever spoke", () => {
		const { listener, speech } = setup(DOC);
		listener.dispose();
		listener.dispose();
		expect(speech.jobs).toEqual([]);
	});
});

describe("Listen: odd documents", () => {
	it("has nothing to say for a document with no words", () => {
		const doc: Document = { version: 1, blocks: [] };
		const { engine, speech, listener } = setup(doc);
		engine.play();
		expect(speech.jobs).toEqual([]);
		expect(listener.highlight).toBeUndefined();
	});

	it("reads on over an image placeholder", () => {
		const doc: Document = {
			version: 1,
			blocks: [
				{ kind: "paragraph", text: "Before.", spans: [] },
				{ kind: "image-placeholder", alt: "a fox" },
				{ kind: "paragraph", text: "After.", spans: [] },
			],
		};
		const { engine, speech } = setup(doc);
		engine.play();
		speech.end();
		expect(speech.texts).toEqual(["Before.", "After."]);
	});

	it("keeps list and heading text in its own sentences", () => {
		const doc: Document = {
			version: 1,
			blocks: [
				{ kind: "heading", level: 1, text: "A title", spans: [] },
				{
					kind: "list-item",
					depth: 0,
					ordered: false,
					text: "First",
					spans: [],
				},
				{
					kind: "list-item",
					depth: 0,
					ordered: false,
					text: "Second",
					spans: [],
				},
			],
		};
		const { engine, speech } = setup(doc);
		engine.play();
		speech.end();
		speech.end();
		expect(speech.texts).toEqual(["A title", "First", "Second"]);
	});
});

describe("the Engine given to Listen", () => {
	it("is the real Engine: Reading Events come out of the speech Clock", () => {
		const { engine, speech, events } = setup(DOC);
		engine.play();
		speech.start();
		speech.boundary(4);
		expect(events).toEqual(expect.arrayContaining(["play", "frameShown"]));
		const engineType: Engine = engine;
		expect(engineType.playing).toBe(true);
	});
});
