import { describe, expect, it } from "vitest";
import {
	createBrowserSpeaker,
	type SpeakHandlers,
	type SynthLike,
	type UtteranceLike,
} from "../src/lib/reader/listen/speaker.ts";
import type { VoiceLike } from "../src/lib/reader/listen/voices.ts";

class FakeUtterance implements UtteranceLike {
	lang = "";
	voice: VoiceLike | null = null;
	rate = 1;
	onstart: ((event: unknown) => void) | null = null;
	onboundary: ((event: { name?: string; charIndex: number }) => void) | null =
		null;
	onend: ((event: unknown) => void) | null = null;
	onerror: ((event: { error: string }) => void) | null = null;
	text: string;
	constructor(text: string) {
		this.text = text;
	}
}

/** speechSynthesis with the browser's habit of reporting a cancelled utterance as an error. */
function fakeSynth() {
	const queue: FakeUtterance[] = [];
	let cancels = 0;
	let cancelReports: "error" | "end" | "nothing" = "error";
	const synth: SynthLike = {
		speak(utterance) {
			queue.push(utterance as FakeUtterance);
		},
		cancel() {
			cancels++;
			const cancelled = queue.splice(0);
			for (const u of cancelled) {
				if (cancelReports === "error") u.onerror?.({ error: "canceled" });
				if (cancelReports === "end") u.onend?.({});
			}
		},
	};
	return {
		synth,
		queue,
		get cancels() {
			return cancels;
		},
		reportCancelAs(kind: "error" | "end" | "nothing") {
			cancelReports = kind;
		},
	};
}

function handlersLog() {
	const log: string[] = [];
	const handlers: SpeakHandlers = {
		start: () => log.push("start"),
		boundary: (charIndex) => log.push(`boundary ${charIndex}`),
		end: () => log.push("end"),
		error: (kind) => log.push(`error ${kind}`),
	};
	return { log, handlers };
}

const setup = () => {
	const fake = fakeSynth();
	const speaker = createBrowserSpeaker(
		fake.synth,
		(text) => new FakeUtterance(text),
	);
	return { fake, speaker };
};

describe("browser Speaker", () => {
	it("hands the sentence, the language, the voice and the speed to the browser", () => {
		const { fake, speaker } = setup();
		const voice: VoiceLike = {
			voiceURI: "v",
			name: "V",
			lang: "fr-FR",
			localService: true,
			default: false,
		};
		speaker.speak(
			{ text: "Bonjour le monde.", lang: "fr", voice, rate: 1.25 },
			handlersLog().handlers,
		);
		expect(fake.queue).toHaveLength(1);
		const utterance = fake.queue[0] as FakeUtterance;
		expect(utterance.text).toBe("Bonjour le monde.");
		expect(utterance.lang).toBe("fr");
		expect(utterance.voice).toBe(voice);
		expect(utterance.rate).toBe(1.25);
	});

	it("leaves the language and voice alone when none were asked for", () => {
		const { fake, speaker } = setup();
		speaker.speak({ text: "Hello.", rate: 1 }, handlersLog().handlers);
		const utterance = fake.queue[0] as FakeUtterance;
		expect(utterance.lang).toBe("");
		expect(utterance.voice).toBeNull();
	});

	it("reports start, word boundaries and end", () => {
		const { fake, speaker } = setup();
		const { log, handlers } = handlersLog();
		speaker.speak({ text: "Hello there.", rate: 1 }, handlers);
		const utterance = fake.queue[0] as FakeUtterance;
		utterance.onstart?.({});
		utterance.onboundary?.({ name: "word", charIndex: 0 });
		utterance.onboundary?.({ name: "word", charIndex: 6 });
		utterance.onend?.({});
		expect(log).toEqual(["start", "boundary 0", "boundary 6", "end"]);
	});

	it("ignores sentence boundaries, and takes a boundary with no name for a word", () => {
		const { fake, speaker } = setup();
		const { log, handlers } = handlersLog();
		speaker.speak({ text: "Hello there.", rate: 1 }, handlers);
		const utterance = fake.queue[0] as FakeUtterance;
		utterance.onboundary?.({ name: "sentence", charIndex: 0 });
		utterance.onboundary?.({ charIndex: 6 });
		expect(log).toEqual(["boundary 6"]);
	});

	it("speaks one sentence at a time: a new one cancels the one before", () => {
		const { fake, speaker } = setup();
		speaker.speak({ text: "One.", rate: 1 }, handlersLog().handlers);
		speaker.speak({ text: "Two.", rate: 1 }, handlersLog().handlers);
		expect(fake.cancels).toBe(1);
		expect(fake.queue.map((u) => u.text)).toEqual(["Two."]);
	});

	for (const reports of ["error", "end", "nothing"] as const) {
		it(`says nothing about a cancelled sentence, even when the browser reports it as ${reports}`, () => {
			const { fake, speaker } = setup();
			fake.reportCancelAs(reports);
			const first = handlersLog();
			speaker.speak({ text: "One.", rate: 1 }, first.handlers);
			speaker.cancel();
			expect(first.log).toEqual([]);
		});
	}

	it("drops a late event from a cancelled sentence after the next one began", () => {
		const { fake, speaker } = setup();
		fake.reportCancelAs("nothing");
		const first = handlersLog();
		speaker.speak({ text: "One.", rate: 1 }, first.handlers);
		const old = fake.queue[0] as FakeUtterance;
		const second = handlersLog();
		speaker.speak({ text: "Two.", rate: 1 }, second.handlers);
		old.onboundary?.({ name: "word", charIndex: 2 });
		old.onend?.({});
		expect(first.log).toEqual([]);
		expect(second.log).toEqual([]);
	});

	it("reports a blocked voice and a failed one, but not a cancel or an interruption", () => {
		const { fake, speaker } = setup();
		const { log, handlers } = handlersLog();
		speaker.speak({ text: "One.", rate: 1 }, handlers);
		const utterance = fake.queue[0] as FakeUtterance;
		utterance.onerror?.({ error: "canceled" });
		utterance.onerror?.({ error: "interrupted" });
		expect(log).toEqual([]);
		utterance.onerror?.({ error: "not-allowed" });
		expect(log).toEqual(["error blocked"]);
		// A failed sentence is over: whatever else the browser says about it is dropped.
		utterance.onerror?.({ error: "synthesis-failed" });
		expect(log).toEqual(["error blocked"]);
	});

	it("reports a failure of the voice", () => {
		const { fake, speaker } = setup();
		const { log, handlers } = handlersLog();
		speaker.speak({ text: "One.", rate: 1 }, handlers);
		(fake.queue[0] as FakeUtterance).onerror?.({ error: "synthesis-failed" });
		expect(log).toEqual(["error failed"]);
	});

	it("reports a failure when the browser refuses the sentence outright", () => {
		const refusing: SynthLike = {
			speak() {
				throw new TypeError("not an utterance");
			},
			cancel() {},
		};
		const speaker = createBrowserSpeaker(
			refusing,
			(text) => new FakeUtterance(text),
		);
		const { log, handlers } = handlersLog();
		expect(() =>
			speaker.speak({ text: "One.", rate: 1 }, handlers),
		).not.toThrow();
		expect(log).toEqual(["error failed"]);
	});

	it("cancels the browser's queue when told to stop", () => {
		const { fake, speaker } = setup();
		speaker.speak({ text: "One.", rate: 1 }, handlersLog().handlers);
		speaker.cancel();
		expect(fake.cancels).toBe(1);
		expect(fake.queue).toEqual([]);
	});

	it("stays quiet after the sentence ended", () => {
		const { fake, speaker } = setup();
		const { log, handlers } = handlersLog();
		speaker.speak({ text: "One.", rate: 1 }, handlers);
		const utterance = fake.queue[0] as FakeUtterance;
		utterance.onend?.({});
		utterance.onend?.({});
		speaker.cancel();
		expect(log).toEqual(["end"]);
	});
});
