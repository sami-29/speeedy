/** Seconds of a voice the reader hears before being asked how it sounds. */
export const RATING_AFTER_SECONDS = 30;

/** The moment to ask: the voice, and how much of it the reader has heard. */
export type RatingMoment = { voice: string; seconds: number };

/**
 * When to ask the reader to rate a voice: once a visit, after half a minute of listening.
 * The question itself is asked elsewhere; this only says when.
 */
export function createVoiceRating() {
	const heard = new Map<string, number>();
	const told = new Set<string>();
	const listeners = new Set<(moment: RatingMoment) => void>();
	return {
		/** The reader heard `seconds` more of `voice`. */
		played(voice: string, seconds: number) {
			if (!Number.isFinite(seconds) || seconds <= 0) return;
			const total = (heard.get(voice) ?? 0) + seconds;
			heard.set(voice, total);
			if (told.has(voice) || total < RATING_AFTER_SECONDS) return;
			told.add(voice);
			for (const listener of [...listeners])
				listener({ voice, seconds: total });
		},
		subscribe(listener: (moment: RatingMoment) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export type VoiceRating = ReturnType<typeof createVoiceRating>;

let shared: VoiceRating | undefined;

/** The app's one rating moment, for the voice survey to subscribe to. */
export const voiceRating = (): VoiceRating => {
	shared ??= createVoiceRating();
	return shared;
};
