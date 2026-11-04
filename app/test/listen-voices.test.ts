import { describe, expect, it } from "vitest";
import {
	createVoiceList,
	pickVoice,
	type VoiceLike,
	type VoiceSource,
} from "../src/lib/reader/listen/voices.ts";

const voice = (
	voiceURI: string,
	lang: string,
	extra: Partial<VoiceLike> = {},
): VoiceLike => ({
	voiceURI,
	name: voiceURI,
	lang,
	localService: true,
	default: false,
	...extra,
});

describe("pickVoice", () => {
	const enUS = voice("en-us", "en-US");
	const enGB = voice("en-gb", "en-GB");
	const fr = voice("fr", "fr-FR");
	const de = voice("de", "de-DE");

	it("takes a voice for the language of the document", () => {
		expect(pickVoice([enUS, fr, de], "fr").voice).toBe(fr);
		expect(pickVoice([enUS, fr, de], "de-AT").voice).toBe(de);
	});

	it("prefers the same region when there is one", () => {
		expect(pickVoice([enUS, enGB], "en-GB").voice).toBe(enGB);
		expect(pickVoice([enUS, enGB], "en").voice).toBe(enUS);
	});

	it("prefers a voice on the device to a network voice, then the default voice", () => {
		const network = voice("net", "en-US", { localService: false });
		const fallback = voice("def", "en-US", { default: true });
		expect(pickVoice([network, enUS], "en").voice).toBe(enUS);
		expect(pickVoice([enUS, fallback], "en").voice).toBe(fallback);
	});

	it("keeps the reader's own choice while it speaks the document's language", () => {
		const other = voice("other", "en-US");
		expect(pickVoice([enUS, other], "en", "other").voice).toBe(other);
		expect(pickVoice([enUS, other], "en", "other").matched).toBe(true);
	});

	it("drops the reader's choice for a document in another language", () => {
		expect(pickVoice([enUS, fr], "fr", "en-us").voice).toBe(fr);
	});

	it("ignores a saved voice this device no longer has", () => {
		expect(pickVoice([enUS], "en", "gone").voice).toBe(enUS);
	});

	it("says so when no voice speaks the language", () => {
		const choice = pickVoice([enUS, fr], "ja");
		expect(choice.voice).toBeUndefined();
		expect(choice.matched).toBe(false);
	});

	it("matches on the language alone, whatever the separator or case", () => {
		const android = voice("android", "en_GB");
		expect(pickVoice([android], "EN-gb").voice).toBe(android);
	});

	it("treats the Norwegian and Hebrew tags as the same language", () => {
		const nb = voice("nb", "nb-NO");
		const he = voice("he", "he-IL");
		expect(pickVoice([nb], "no").voice).toBe(nb);
		expect(pickVoice([he], "iw").voice).toBe(he);
	});

	it("leaves the choice to the browser when the language is unknown", () => {
		expect(pickVoice([enUS, fr], undefined)).toEqual({
			voice: undefined,
			matched: true,
		});
		expect(pickVoice([enUS, fr], "und").voice).toBeUndefined();
		expect(pickVoice([enUS, fr], "und", "fr").voice).toBe(fr);
	});

	it("has no voice to give from an empty list", () => {
		expect(pickVoice([], "en")).toEqual({ voice: undefined, matched: false });
	});
});

/** A speechSynthesis stand-in whose voices arrive when the test says so. */
function fakeSource(initial: VoiceLike[] = []) {
	let current = initial;
	const listeners = new Set<() => void>();
	const source: VoiceSource = {
		getVoices: () => current,
		addEventListener: (_type, listener) => listeners.add(listener),
		removeEventListener: (_type, listener) => listeners.delete(listener),
	};
	return {
		source,
		listeners,
		/** The browser finished loading voices. */
		load(next: VoiceLike[]) {
			current = next;
			for (const listener of [...listeners]) listener();
		},
	};
}

describe("voice list", () => {
	const a = voice("a", "en-US");
	const b = voice("b", "fr-FR");

	it("has the voices at once when the browser already knows them", () => {
		const { source } = fakeSource([a, b]);
		const list = createVoiceList(source);
		expect(list.voices).toEqual([a, b]);
	});

	it("starts empty and fills in when voiceschanged arrives", () => {
		const fake = fakeSource([]);
		const list = createVoiceList(fake.source);
		expect(list.voices).toEqual([]);
		fake.load([a]);
		expect(list.voices).toEqual([a]);
	});

	it("tells a subscriber the list now and again whenever it changes", () => {
		const fake = fakeSource([]);
		const list = createVoiceList(fake.source);
		const seen: number[] = [];
		list.subscribe((voices) => seen.push(voices.length));
		fake.load([a]);
		fake.load([a, b]);
		expect(seen).toEqual([0, 1, 2]);
	});

	it("does not repeat itself when the browser fires the event with the same voices", () => {
		const fake = fakeSource([a]);
		const list = createVoiceList(fake.source);
		const seen: number[] = [];
		list.subscribe((voices) => seen.push(voices.length));
		fake.load([a]);
		fake.load([a]);
		expect(seen).toEqual([1]);
	});

	it("is not caught out when the event came before anyone subscribed", () => {
		const fake = fakeSource([]);
		const list = createVoiceList(fake.source);
		fake.load([a, b]);
		const seen: number[] = [];
		list.subscribe((voices) => seen.push(voices.length));
		expect(seen).toEqual([2]);
	});

	it("reads the voices again when a subscriber asks, for a browser that never fires the event", () => {
		const fake = fakeSource([]);
		const list = createVoiceList(fake.source);
		// The browser fills its list without announcing it.
		(fake.source as { getVoices: () => VoiceLike[] }).getVoices = () => [a];
		list.refresh();
		expect(list.voices).toEqual([a]);
	});

	it("stops a subscriber that unsubscribed", () => {
		const fake = fakeSource([]);
		const list = createVoiceList(fake.source);
		const seen: number[] = [];
		const stop = list.subscribe((voices) => seen.push(voices.length));
		stop();
		fake.load([a]);
		expect(seen).toEqual([0]);
	});

	it("lets go of the browser's event on dispose", () => {
		const fake = fakeSource([]);
		const list = createVoiceList(fake.source);
		expect(fake.listeners.size).toBe(1);
		const seen: number[] = [];
		list.subscribe((voices) => seen.push(voices.length));
		list.dispose();
		expect(fake.listeners.size).toBe(0);
		fake.load([a]);
		expect(seen).toEqual([0]);
	});
});
