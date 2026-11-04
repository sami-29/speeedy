import {
	createBrowserSpeaker,
	type Speaker,
	type SynthLike,
	type UtteranceLike,
} from "./speaker.ts";
import { createVoiceList, type VoiceList, type VoiceSource } from "./voices.ts";

export type BrowserSpeech = {
	speaker: Speaker;
	voices: VoiceList;
};

/**
 * The browser's own speech, or undefined where the browser has none. Every browser Speeedy
 * supports has it, but a locked-down one can leave it out.
 */
export function browserSpeech(
	win: {
		speechSynthesis?: unknown;
		SpeechSynthesisUtterance?: unknown;
	} = window,
	/** The voice volume, 0 to 1, from the AudioSystem's voice bus setting. */
	volume?: () => number,
): BrowserSpeech | undefined {
	const synth = win.speechSynthesis as SpeechSynthesis | undefined;
	const Utterance = win.SpeechSynthesisUtterance as
		| typeof SpeechSynthesisUtterance
		| undefined;
	if (!synth || typeof Utterance !== "function") return undefined;
	return {
		speaker: createBrowserSpeaker(
			synth as unknown as SynthLike,
			(text) => new Utterance(text) as unknown as UtteranceLike,
			volume ? { volume } : {},
		),
		voices: createVoiceList(synth as unknown as VoiceSource),
	};
}

/** The device's storage for Listen's preferences, or undefined where it is blocked. */
export function listenStorage(): Storage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}
