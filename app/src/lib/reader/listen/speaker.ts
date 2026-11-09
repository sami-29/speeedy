import type { VoiceLike } from "./voices.ts";

/** One sentence to say. */
export type SpeakJob = {
	text: string;
	/** BCP 47 tag of the text. Left out when the language is not known. */
	lang?: string | undefined;
	/** Left out to let the browser choose. */
	voice?: VoiceLike | undefined;
	/** 1 is normal speed. */
	rate: number;
	/**
	 * The whole sentence `text` is the end of, and where `text` starts in it. A voice that makes
	 * its own audio makes the whole sentence once, and starts part-way in from there.
	 */
	sentence?: { text: string; at: number } | undefined;
	/** The sentences after this one, nearest first, so a voice can prepare them ahead. */
	next?: readonly string[] | undefined;
};

/** What a Speaker tells Listen about the sentence it was given. */
export type SpeakHandlers = {
	/** The voice began. */
	start(): void;
	/** The voice reached the word at `charIndex` of the job's text. */
	boundary(charIndex: number): void;
	/** The sentence is finished. */
	end(): void;
	/** The voice could not go on: the browser blocked it (no user gesture), or it failed. */
	error(kind: "blocked" | "failed"): void;
};

/**
 * Whatever says a sentence aloud. The browser's voices are one; a voice that makes its own
 * audio is another, and tells Listen about its words with `boundary` in the same way. A
 * Speaker says one sentence at a time, and once a job is cancelled or replaced it never
 * calls that job's handlers again, however late the voice reports.
 */
export interface Speaker {
	/** Say `job`. A sentence still being said is cancelled first. */
	speak(job: SpeakJob, handlers: SpeakHandlers): void;
	/** Stop at once. */
	cancel(): void;
}

/**
 * One Speaker over several: each sentence goes to the Speaker its voice belongs to. When the
 * voice moves to another Speaker, the one before is cancelled first, so two never speak at
 * once.
 */
export function routeSpeaker(
	choose: (voice: VoiceLike | undefined) => Speaker,
): Speaker {
	let last: Speaker | undefined;
	return {
		speak(job, handlers) {
			const next = choose(job.voice);
			if (last && last !== next) last.cancel();
			last = next;
			next.speak(job, handlers);
		},
		cancel() {
			last?.cancel();
		},
	};
}

/** The slice of `SpeechSynthesisUtterance` the Speaker sets and hears. */
export type UtteranceLike = {
	text: string;
	lang: string;
	voice: VoiceLike | null;
	rate: number;
	/** 0 to 1. A fake without one is left alone. */
	volume?: number;
	onstart: ((event: unknown) => void) | null;
	onboundary: ((event: { name?: string; charIndex: number }) => void) | null;
	onend: ((event: unknown) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
};

/** The slice of `speechSynthesis` the Speaker uses. */
export type SynthLike = {
	speak(utterance: UtteranceLike): void;
	cancel(): void;
};

/**
 * The browser's voices. Each sentence is its own utterance, spoken once the one before has
 * ended, so the voice is never ahead of the highlight. Chrome reports a cancelled sentence
 * as an error and Safari as an end; both are ignored, because Listen cancelled it.
 */
export function createBrowserSpeaker(
	synth: SynthLike,
	createUtterance: (text: string) => UtteranceLike,
	options: {
		/** The voice volume, 0 to 1, read as each sentence begins. Left out, the browser's own. */
		volume?: () => number;
	} = {},
): Speaker {
	// Held, so the browser cannot collect an utterance that is still being said.
	let current: UtteranceLike | undefined;

	const cancel = () => {
		current = undefined;
		synth.cancel();
	};

	return {
		speak(job, handlers) {
			if (current) cancel();
			const utterance = createUtterance(job.text);
			if (job.lang) utterance.lang = job.lang;
			if (job.voice) utterance.voice = job.voice;
			utterance.rate = job.rate;
			if (options.volume) utterance.volume = options.volume();
			const live = () => current === utterance;
			utterance.onstart = () => {
				if (live()) handlers.start();
			};
			utterance.onboundary = (event) => {
				// Some browsers also report sentence boundaries; only words are used.
				if (live() && (event.name === undefined || event.name === "word")) {
					handlers.boundary(event.charIndex);
				}
			};
			utterance.onend = () => {
				if (!live()) return;
				current = undefined;
				handlers.end();
			};
			utterance.onerror = (event) => {
				if (!live()) return;
				if (event.error === "canceled" || event.error === "interrupted") return;
				current = undefined;
				handlers.error(event.error === "not-allowed" ? "blocked" : "failed");
			};
			current = utterance;
			try {
				synth.speak(utterance);
			} catch {
				// A browser that refuses the call outright (no speech service) is a failed voice.
				current = undefined;
				handlers.error("failed");
			}
		},
		cancel,
	};
}
