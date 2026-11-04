import { baseLanguage } from "@speeedy/contracts";

/** The part of a browser voice Listen reads. A `SpeechSynthesisVoice` has all of it. */
export type VoiceLike = {
	voiceURI: string;
	name: string;
	lang: string;
	localService: boolean;
	default: boolean;
};

export type VoiceChoice = {
	/** Undefined leaves the choice to the browser. */
	voice: VoiceLike | undefined;
	/** False when the document has a language and no voice here speaks it. */
	matched: boolean;
};

const tagOf = (lang: string | undefined): string =>
	(lang ?? "").toLowerCase().replace(/_/g, "-");

/**
 * The voice to read a document of `language` with. A voice the reader chose (`preferredURI`)
 * wins while it speaks the document's language. Otherwise: the same region if there is one,
 * then a voice on the device (network voices often send no word boundaries), then the
 * browser's default. With no voice for the language, `voice` is undefined and `matched` false.
 * With no language known the browser chooses, unless the reader picked a voice.
 */
export function pickVoice(
	voices: readonly VoiceLike[],
	language: string | undefined,
	preferredURI?: string,
): VoiceChoice {
	const preferred = preferredURI
		? voices.find((voice) => voice.voiceURI === preferredURI)
		: undefined;
	const wanted = baseLanguage(language);
	if (!wanted) return { voice: preferred, matched: true };
	const speaking = voices.filter(
		(voice) => baseLanguage(voice.lang) === wanted,
	);
	if (preferred && speaking.includes(preferred)) {
		return { voice: preferred, matched: true };
	}
	const exact = tagOf(language);
	let best: VoiceLike | undefined;
	let bestScore = -1;
	for (const voice of speaking) {
		const score =
			(tagOf(voice.lang) === exact ? 4 : 0) +
			(voice.localService ? 2 : 0) +
			(voice.default ? 1 : 0);
		if (score > bestScore) {
			best = voice;
			bestScore = score;
		}
	}
	return { voice: best, matched: best !== undefined };
}

/** The slice of `speechSynthesis` the voice list uses. */
export type VoiceSource = {
	getVoices(): VoiceLike[];
	addEventListener(type: "voiceschanged", listener: () => void): void;
	removeEventListener(type: "voiceschanged", listener: () => void): void;
};

export type VoiceList = {
	readonly voices: readonly VoiceLike[];
	/** Called now with the voices, and again whenever they change. Returns a function that stops. */
	subscribe(listener: (voices: readonly VoiceLike[]) => void): () => void;
	/** Read the voices again, for a browser that fills its list without saying so. */
	refresh(): void;
	dispose(): void;
};

const sameVoices = (
	a: readonly VoiceLike[],
	b: readonly VoiceLike[],
): boolean =>
	a.length === b.length &&
	a.every(
		(voice, i) =>
			voice.voiceURI === b[i]?.voiceURI && voice.lang === b[i]?.lang,
	);

/**
 * The browser's voices, as they load. Chrome returns an empty list at first and announces
 * the real one with `voiceschanged`; Safari has them at once and may never fire the event.
 * The event is listened for before the first read, so neither order loses the list.
 */
export function createVoiceList(source: VoiceSource): VoiceList {
	const listeners = new Set<(voices: readonly VoiceLike[]) => void>();
	let voices: readonly VoiceLike[] = [];

	const refresh = () => {
		const next = [...source.getVoices()];
		if (sameVoices(voices, next)) return;
		voices = next;
		for (const listener of [...listeners]) listener(voices);
	};

	source.addEventListener("voiceschanged", refresh);
	refresh();

	return {
		get voices() {
			return voices;
		},
		subscribe(listener) {
			listeners.add(listener);
			listener(voices);
			return () => {
				listeners.delete(listener);
			};
		},
		refresh,
		dispose() {
			source.removeEventListener("voiceschanged", refresh);
			listeners.clear();
		},
	};
}
