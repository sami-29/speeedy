import { describe, expect, it } from "vitest";
import {
	routeSpeaker,
	type Speaker,
	type SpeakHandlers,
	type SpeakJob,
} from "../src/lib/reader/listen/speaker.ts";

function recording(name: string, log: string[]): Speaker {
	return {
		speak: (job) => log.push(`${name} speak ${job.text}`),
		cancel: () => log.push(`${name} cancel`),
	};
}

const handlers: SpeakHandlers = {
	start: () => {},
	boundary: () => {},
	end: () => {},
	error: () => {},
};

const job = (text: string, voiceURI?: string): SpeakJob => ({
	text,
	rate: 1,
	voice: voiceURI
		? {
				voiceURI,
				name: voiceURI,
				lang: "en-US",
				localService: true,
				default: false,
			}
		: undefined,
});

function setup() {
	const log: string[] = [];
	const own = recording("own", log);
	const browser = recording("browser", log);
	const speaker = routeSpeaker((voice) =>
		voice?.voiceURI === "own" ? own : browser,
	);
	return { log, speaker };
}

describe("Listen with more than one kind of voice", () => {
	it("gives each sentence to the Speaker its voice belongs to", () => {
		const { log, speaker } = setup();
		speaker.speak(job("One."), handlers);
		speaker.speak(job("Two."), handlers);
		expect(log).toEqual(["browser speak One.", "browser speak Two."]);
	});

	it("stops the other Speaker when the voice changes kind, so two never speak at once", () => {
		const { log, speaker } = setup();
		speaker.speak(job("One."), handlers);
		speaker.speak(job("Two.", "own"), handlers);
		speaker.speak(job("Three."), handlers);
		expect(log).toEqual([
			"browser speak One.",
			"browser cancel",
			"own speak Two.",
			"own cancel",
			"browser speak Three.",
		]);
	});

	it("cancels the Speaker last used", () => {
		const { log, speaker } = setup();
		speaker.speak(job("One.", "own"), handlers);
		speaker.cancel();
		expect(log).toEqual(["own speak One.", "own cancel"]);
	});

	it("has nothing to cancel before anything was said", () => {
		const { log, speaker } = setup();
		speaker.cancel();
		expect(log).toEqual([]);
	});
});
