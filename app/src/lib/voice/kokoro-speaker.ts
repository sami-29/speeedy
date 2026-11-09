import type { Clock } from "@speeedy/engine";
import { clampSpeed } from "@speeedy/kokoro";
import type {
	AudioContextLike,
	AudioNodeLike,
	BufferSourceLike,
} from "../audio/system.ts";
import type {
	Speaker,
	SpeakHandlers,
	SpeakJob,
} from "../reader/listen/speaker.ts";
import type { VoiceLike } from "../reader/listen/voices.ts";
import { clipKey, type Render, type Rendered } from "./clip.ts";

/** The on-device voice, as Listen's voice list names it. It is never a browser voice. */
export const KOKORO_VOICE: VoiceLike = {
	voiceURI: "speeedy:kokoro/af_msa",
	name: "Speeedy voice",
	lang: "en-US",
	localService: true,
	default: false,
};

export const isKokoroVoice = (voice: VoiceLike | undefined): boolean =>
	voice?.voiceURI === KOKORO_VOICE.voiceURI;

/** The slice of the AudioSystem a voice that makes its own audio uses. */
export type VoiceAudio = {
	readonly context: AudioContextLike | undefined;
	readonly buses: { readonly voice: AudioNodeLike } | undefined;
	unlock(): Promise<boolean>;
	setVoiceActive(active: boolean): void;
};

/** Why the on-device voice gave way to the browser's: it failed, or it cannot keep up. */
export type FallbackReason = "failed" | "slow";

export type KokoroSpeakerOptions = {
	render: Render;
	audio: VoiceAudio;
	/** The audio Clock: the time of the sound the reader hears now. */
	clock: Clock;
	/** The browser's voices, which take over when this voice fails. */
	fallback?: Speaker;
	onFallback?: (reason: FallbackReason) => void;
	/** Seconds of this voice the reader heard, told as each sentence stops. */
	onPlayed?: (seconds: number) => void;
	/** Sentences to prepare after the one being said. */
	ahead?: number;
	/** Generation time over audio time above which the voice is too slow for this device. */
	slowRatio?: number;
};

/** Clips just made or played, kept in memory so the next sentence starts without a wait. */
const READY_CLIPS = 8;
/** Ratios averaged for the slowness check. */
const RATIO_WINDOW = 3;
/** Half a millisecond: the audio time and the word times are both rounded. */
const EPSILON = 0.0005;

const codeOf = (error: unknown): unknown =>
	(error as { code?: unknown } | null)?.code;

type Playing = {
	source: BufferSourceLike;
	/** Context time the slice started playing at. */
	startedAt: number;
	seconds: number;
	untick: () => void;
};

/**
 * Listen on the on-device voice. Each sentence's audio is made in the worker, once, at the
 * speed it is to be heard at (never sped up with a playback rate), and played through the
 * voice bus. Its words are timed exactly, so they are reported to Listen as the audio Clock
 * reaches them, which keeps the Cursor and the highlight on the sound heard, a hidden tab
 * included. Starting part-way in (a resume, a rewind) plays the same sentence's audio from
 * that word's time.
 *
 * The next `ahead` sentences are made while one plays; work a seek has left behind is
 * cancelled. A sentence that cannot be made hands this and every later sentence to the
 * browser's voice; a device that makes audio slower than it plays is reported once.
 */
export function createKokoroSpeaker(options: KokoroSpeakerOptions): Speaker {
	const { render, audio, clock } = options;
	const ahead = options.ahead ?? 3;
	const slowRatio = options.slowRatio ?? 1;

	let token = 0;
	let playing: Playing | undefined;
	let voiceOn = false;
	let failed = false;
	let toldSlow = false;
	let warmedUp = false;
	const ratios: number[] = [];
	const inflight = new Map<
		string,
		{ promise: Promise<Rendered>; controller: AbortController }
	>();
	const ready = new Map<string, Rendered>();

	const keep = (key: string, clip: Rendered) => {
		ready.delete(key);
		ready.set(key, clip);
		while (ready.size > READY_CLIPS) {
			const oldest = ready.keys().next().value as string;
			ready.delete(oldest);
		}
	};

	/** How fast this device makes audio, from every sentence made after the first. */
	const measure = (clip: Rendered) => {
		if (clip.cached || clip.samples.length === 0) return;
		if (!warmedUp) {
			warmedUp = true;
			return;
		}
		const audioMs = (clip.samples.length / clip.sampleRate) * 1000;
		ratios.push(clip.ms / audioMs);
		if (ratios.length > RATIO_WINDOW) ratios.shift();
		const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
		if (!toldSlow && ratios.length >= 2 && mean > slowRatio) {
			toldSlow = true;
			options.onFallback?.("slow");
		}
	};

	/** The sentence's audio: ready, being made, or started now. */
	const want = (sentence: string, speed: number): Promise<Rendered> => {
		const key = clipKey(sentence, "", speed);
		const done = ready.get(key);
		if (done) return Promise.resolve(done);
		const running = inflight.get(key);
		if (running) return running.promise;
		const controller = new AbortController();
		const promise = render(sentence, speed, controller.signal).then(
			(clip) => {
				if (inflight.get(key)?.controller === controller) inflight.delete(key);
				measure(clip);
				keep(key, clip);
				return clip;
			},
			(error: unknown) => {
				if (inflight.get(key)?.controller === controller) inflight.delete(key);
				throw error;
			},
		);
		// A sentence prepared ahead that fails is tried again when it is due.
		promise.catch(() => {});
		inflight.set(key, { promise, controller });
		return promise;
	};

	/** Make what is wanted now, and cancel what no longer is. */
	const prepare = (sentences: readonly string[], speed: number) => {
		const wanted = new Set(sentences.map((s) => clipKey(s, "", speed)));
		for (const [key, running] of [...inflight]) {
			if (wanted.has(key)) continue;
			inflight.delete(key);
			running.controller.abort();
		}
		for (const sentence of sentences)
			void want(sentence, speed).catch(() => {});
	};

	const setActive = (on: boolean) => {
		if (voiceOn === on) return;
		voiceOn = on;
		audio.setVoiceActive(on);
	};

	/** Stop the sentence playing, if one is, telling how much of it was heard. */
	const stopPlaying = () => {
		const was = playing;
		if (!was) return;
		playing = undefined;
		was.untick();
		was.source.onended = null;
		try {
			was.source.stop();
		} catch {
			// Never started, or already stopped.
		}
		was.source.disconnect();
		const heard = clock.now() / 1000 - was.startedAt;
		const seconds = Math.min(Math.max(heard, 0), was.seconds);
		if (seconds > 0) options.onPlayed?.(seconds);
	};

	const giveWay = (job: SpeakJob, handlers: SpeakHandlers) => {
		if (!failed) {
			failed = true;
			for (const running of inflight.values()) running.controller.abort();
			inflight.clear();
			options.onFallback?.("failed");
		}
		if (options.fallback) {
			options.fallback.speak({ ...job, voice: undefined }, handlers);
		} else {
			handlers.error("failed");
		}
	};

	const play = (
		mine: number,
		clip: Rendered,
		at: number,
		job: SpeakJob,
		handlers: SpeakHandlers,
	) => {
		const context = audio.context;
		const bus = audio.buses?.voice;
		if (!context || !bus) {
			giveWay(job, handlers);
			return;
		}
		// The word the spoken text starts on, and its time in the sentence's audio.
		let first = 0;
		if (at > 0) {
			for (let i = 0; i < clip.words.length; i++) {
				if ((clip.words[i] as { offset: number }).offset <= at) first = i;
			}
		}
		const from = at > 0 ? (clip.words[first]?.start ?? 0) : 0;
		const startSample = Math.min(
			Math.round(from * clip.sampleRate),
			clip.samples.length,
		);
		const length = clip.samples.length - startSample;
		handlers.start();
		if (mine !== token) return;
		if (length <= 0) {
			handlers.end();
			return;
		}
		const words = clip.words.slice(first).map((word) => ({
			charIndex: Math.max(word.offset - at, 0),
			start: word.start - from,
		}));
		const buffer = context.createBuffer(1, length, clip.sampleRate);
		buffer.getChannelData(0).set(clip.samples.subarray(startSample));
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(bus);
		const startedAt = context.currentTime;
		let next = 0;
		const check = () => {
			if (mine !== token) return;
			const heard = clock.now() / 1000 - startedAt;
			while (mine === token && next < words.length) {
				const word = words[next] as (typeof words)[number];
				if (heard + EPSILON < word.start) break;
				next++;
				handlers.boundary(word.charIndex);
			}
		};
		source.onended = () => {
			if (mine !== token || playing?.source !== source) return;
			stopPlaying();
			setActive(false);
			handlers.end();
		};
		source.start(startedAt);
		playing = {
			source,
			startedAt,
			seconds: length / clip.sampleRate,
			untick: clock.onTick(check),
		};
		setActive(true);
		check();
	};

	return {
		speak(job, handlers) {
			stopPlaying();
			const mine = ++token;
			if (failed) {
				giveWay(job, handlers);
				return;
			}
			// Inside the reader's gesture, before anything waits: browsers start sound only here.
			const unlocking = audio.unlock();
			const speed = clampSpeed(job.rate);
			const sentence = job.sentence?.text ?? job.text;
			const at = job.sentence ? job.sentence.at : 0;
			prepare([sentence, ...(job.next ?? []).slice(0, ahead)], speed);
			const done = ready.get(clipKey(sentence, "", speed));
			if (done && audio.context?.state === "running") {
				// Already made: start now, so one sentence runs into the next without a gap.
				keep(clipKey(sentence, "", speed), done);
				play(mine, done, at, job, handlers);
				return;
			}
			Promise.all([unlocking, want(sentence, speed)]).then(
				([unlocked, clip]) => {
					if (mine !== token) return;
					if (!unlocked && audio.context) {
						handlers.error("blocked");
						return;
					}
					play(mine, clip, at, job, handlers);
				},
				(error: unknown) => {
					if (mine !== token || codeOf(error) === "cancelled") return;
					giveWay(job, handlers);
				},
			);
		},
		cancel() {
			token++;
			stopPlaying();
			setActive(false);
			if (failed) options.fallback?.cancel();
		},
	};
}
