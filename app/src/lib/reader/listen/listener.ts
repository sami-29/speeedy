import {
	blockText,
	comparePositions,
	type Document,
	type Position,
} from "@speeedy/contracts";
import {
	type Engine,
	type Frame,
	type SpeechClock,
	sentenceBounds,
} from "@speeedy/engine";
import type { Speaker } from "./speaker.ts";
import type { VoiceLike } from "./voices.ts";

/** How long a voice may go without reporting a word before Listen stops expecting it to. */
export const WATCHDOG_MS = 1500;

/** The text Listen marks: the word being spoken, or the whole sentence it is in. */
export type Highlight = {
	kind: "word" | "sentence";
	block: number;
	/** UTF-16 offsets into the block's text, `[from, to)`. */
	from: number;
	to: number;
};

export type ListenStatus = "idle" | "speaking" | "blocked" | "failed";

/** What is known of the voice in use: that it reports words, that it does not, or neither yet. */
export type WordSync = "unknown" | "word" | "sentence";

export type Timers = {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
};

export type ListenerOptions = {
	engine: Engine;
	document: Document;
	/** The Clock the Engine runs on in Listen. The Listener is the only thing that pushes it. */
	clock: SpeechClock;
	speaker: Speaker;
	/** BCP 47 tag of the document. `und` and nothing both leave the voice to the browser. */
	language?: string | undefined;
	voice?: VoiceLike | undefined;
	/** 1 is normal speed. */
	rate?: number;
	/**
	 * How long a run of seeks must sit still before the voice speaks from the last one, so a
	 * drag along the progress bar says one sentence, not one per step. Defaults to none.
	 */
	seekDelayMs?: number;
	timers?: Timers;
};

export type Listener = {
	readonly highlight: Highlight | undefined;
	readonly status: ListenStatus;
	readonly wordSync: WordSync;
	setVoice(voice: VoiceLike | undefined): void;
	setRate(rate: number): void;
	/** Called when the highlight, the status or what is known of the voice changes. */
	subscribe(listener: () => void): () => void;
	dispose(): void;
};

const defaultTimers: Timers = {
	set: (fn, ms) => setTimeout(fn, ms),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Last Frame that starts at or before `position`, or the first Frame. */
function frameIndexAt(frames: readonly Frame[], position: Position): number {
	let low = 0;
	let high = frames.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (comparePositions((frames[middle] as Frame).position, position) <= 0) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return low;
}

const inFrame = (frame: Frame, position: Position): boolean =>
	position.block === frame.position.block &&
	position.offset >= frame.position.offset &&
	position.offset < frame.end.offset;

/** The sentence being said: where its text sits in its block. */
type Utterance = {
	token: number;
	block: number;
	/** Where the spoken text starts, and where the sentence ends, in the block's text. */
	from: number;
	to: number;
};

/**
 * Listen with a voice that speaks a sentence at a time. It reads the Cursor's sentence off
 * the Engine's Timeline, hands it to the Speaker, and moves the Engine by pushing the speech
 * Clock: to the sentence's first Frame when it begins, to each Frame the voice reports a word
 * in, and to the next sentence when it ends. The Engine plays on that Clock like any other,
 * so Reading Events, progress, Positions and Sessions need no special case.
 *
 * What the highlight claims is what is known. A voice that sends word boundaries gets the
 * spoken word marked; a voice that does not gets the whole sentence marked and the Cursor
 * stays on its first Frame until the sentence ends. Words inside a sentence are never
 * guessed. Everything is found from Positions, never from Frame indexes, so a rebuilt
 * Timeline (a new chunk size, a speed change) cannot throw the voice off.
 *
 * A later voice that makes its own audio plugs in as another Speaker: it calls `boundary`
 * with the character it has reached, or, when its words are timed exactly, drives the same
 * Clock from the audio time.
 */
export function createListener(options: ListenerOptions): Listener {
	const { engine, document, clock, speaker } = options;
	const timers = options.timers ?? defaultTimers;
	const language = options.language;
	let voice = options.voice;
	let rate = options.rate ?? 1;

	let disposed = false;
	let status: ListenStatus = "idle";
	let highlight: Highlight | undefined;
	let token = 0;
	let current: Utterance | undefined;
	let resumeAt: Position | undefined;
	let watchdog: unknown;
	let pendingSeek: unknown;
	const seekDelayMs = options.seekDelayMs ?? 0;
	/** Whether each voice has sent word boundaries (true) or has not (false). Not asked yet: absent. */
	const reportsWords = new Map<string, boolean>();
	const subscribers = new Set<() => void>();

	const voiceKey = () => voice?.voiceURI ?? "";

	const notify = () => {
		for (const subscriber of [...subscribers]) subscriber();
	};

	const frames = () => engine.timeline.frames;

	const textOf = (block: number) => {
		const found = document.blocks[block];
		return found ? blockText(found) : "";
	};

	const setHighlight = (next: Highlight | undefined) => {
		if (
			highlight?.kind === next?.kind &&
			highlight?.block === next?.block &&
			highlight?.from === next?.from &&
			highlight?.to === next?.to
		) {
			return;
		}
		highlight = next;
		notify();
	};

	const setStatus = (next: ListenStatus) => {
		if (status === next) return;
		status = next;
		notify();
	};

	const sentenceHighlight = (index: number): Highlight | undefined => {
		const all = frames();
		if (all.length === 0) return undefined;
		const { from, to } = sentenceBounds(all, index);
		const first = all[from] as Frame;
		const last = all[to] as Frame;
		return {
			kind: "sentence",
			block: first.position.block,
			from: first.position.offset,
			to: last.end.offset,
		};
	};

	/** The word at `offset` of a block, as far as the end of the Frame it is in. */
	const wordHighlight = (
		block: number,
		offset: number,
		frame: Frame,
	): Highlight => {
		const text = textOf(block);
		const limit = Math.min(frame.end.offset, text.length);
		let from = offset;
		while (from < limit && /\s/u.test(text[from] ?? "")) from++;
		let to = from;
		while (to < limit && !/\s/u.test(text[to] ?? "")) to++;
		if (to === from) to = Math.min(from + 1, Math.max(limit, from));
		return { kind: "word", block, from, to };
	};

	const clearWatchdog = () => {
		if (watchdog === undefined) return;
		timers.clear(watchdog);
		watchdog = undefined;
	};

	const clearPendingSeek = () => {
		if (pendingSeek === undefined) return;
		timers.clear(pendingSeek);
		pendingSeek = undefined;
	};

	/** Stop what is being said, and make every handler of it a no-op. */
	const silence = () => {
		const speaking = current !== undefined;
		token++;
		current = undefined;
		clearWatchdog();
		clearPendingSeek();
		if (speaking) speaker.cancel();
	};

	/** Push the speech Clock one Frame on: until the Engine's Cursor is on Frame `target`. */
	const pushTo = (target: number) => {
		for (let attempt = 0; attempt < 4; attempt++) {
			if (!engine.playing || engine.index >= target) return;
			const all = frames();
			const here = all[engine.index];
			const there = all[target];
			if (!here || !there) return;
			const speed = engine.settings.wpm / engine.timelineWpm;
			// The first push is exact; if rounding left the Cursor a hair short, nudge it over.
			const nudge = attempt === 0 ? 0 : 0.001 * attempt;
			clock.advance((there.startMs - here.startMs) / speed + nudge);
		}
	};

	/**
	 * Move the Cursor forward to Frame `target`, showing each Frame on the way. The voice said
	 * the words between, so Sessions count them even when it reported none.
	 */
	const advanceTo = (target: number) => {
		let guard = target - engine.index + 4;
		while (engine.playing && engine.index < target && guard-- > 0) {
			pushTo(Math.min(engine.index + 1, target));
		}
	};

	/** Past the last Frame: the Engine ends. */
	const finishDocument = () => {
		for (let attempt = 0; attempt < 3 && engine.playing; attempt++) {
			const here = frames()[engine.index];
			const speed = engine.settings.wpm / engine.timelineWpm;
			const remaining = engine.timeline.totalMs - (here?.startMs ?? 0);
			clock.advance(remaining / speed + 1 + attempt);
		}
	};

	const speakFrom = (at: Position): void => {
		const all = frames();
		if (all.length === 0) return;
		const index = frameIndexAt(all, at);
		const frame = all[index] as Frame;
		const { from, to } = sentenceBounds(all, index);
		const first = all[from] as Frame;
		const last = all[to] as Frame;
		const block = frame.position.block;
		const start =
			inFrame(frame, at) && at.offset > frame.position.offset
				? at.offset
				: frame.position.offset;
		const end = last.end.offset;
		const text = textOf(block).slice(start, end);
		if (text.trim() === "") {
			// Nothing to say here (a sentence of marks alone): on to the next one.
			advanceAfter({ block, end });
			return;
		}
		const mine = ++token;
		current = { token: mine, block, from: start, to: end };
		resumeAt = { block, offset: start };
		const knownWords = reportsWords.get(voiceKey());
		setHighlight(
			knownWords === true
				? wordHighlight(block, start, frame)
				: {
						kind: "sentence",
						block: first.position.block,
						from: first.position.offset,
						to: end,
					},
		);
		setStatus("speaking");
		speaker.speak(
			{ text, lang: baseTag(language), voice, rate },
			{
				start() {
					if (mine !== token || disposed) return;
					if (reportsWords.get(voiceKey()) === undefined) {
						clearWatchdog();
						watchdog = timers.set(() => {
							watchdog = undefined;
							if (mine !== token || disposed) return;
							if (reportsWords.get(voiceKey()) === undefined) {
								reportsWords.set(voiceKey(), false);
								notify();
							}
						}, WATCHDOG_MS);
					}
				},
				boundary(charIndex) {
					if (mine !== token || disposed) return;
					onBoundary(charIndex);
				},
				end() {
					if (mine !== token || disposed) return;
					const done = current;
					current = undefined;
					clearWatchdog();
					if (done) advanceAfter({ block: done.block, end: done.to });
				},
				error(kind) {
					if (mine !== token || disposed) return;
					silence();
					setStatus(kind === "blocked" ? "blocked" : "failed");
					engine.pause();
				},
			},
		);
	};

	/** A word of the sentence being said was reached. */
	const onBoundary = (charIndex: number) => {
		const said = current;
		if (!said || !Number.isFinite(charIndex)) return;
		const offset = said.from + charIndex;
		if (charIndex < 0 || offset >= said.to) return;
		clearWatchdog();
		const wasKnown = reportsWords.get(voiceKey());
		reportsWords.set(voiceKey(), true);
		const all = frames();
		const index = frameIndexAt(all, { block: said.block, offset });
		const frame = all[index];
		if (!frame || frame.position.block !== said.block) return;
		advanceTo(index);
		const marked = wordHighlight(said.block, offset, frame);
		resumeAt = { block: said.block, offset: marked.from };
		setHighlight(marked);
		if (wasKnown !== true) notify();
	};

	/** The sentence ended: carry on with the next, or finish the document. */
	const advanceAfter = (said: { block: number; end: number }) => {
		const all = frames();
		const lastIndex = frameIndexAt(all, {
			block: said.block,
			offset: Math.max(said.end - 1, 0),
		});
		const next = lastIndex + 1;
		if (next >= all.length) {
			advanceTo(all.length - 1);
			finishDocument();
			return;
		}
		advanceTo(next);
		const frame = frames()[next];
		if (frame && engine.playing) speakFrom(frame.position);
	};

	/** Start again from where the voice is, with the voice or speed it has now. */
	const restart = () => {
		if (!engine.playing || status !== "speaking") return;
		const at = resumeAt ?? engine.position;
		silence();
		if (at) speakFrom(at);
	};

	const stops = [
		engine.on("play", () => {
			if (disposed) return;
			const frame = engine.frame;
			if (!frame) return;
			const at =
				resumeAt && inFrame(frame, resumeAt) ? resumeAt : frame.position;
			silence();
			speakFrom(at);
		}),
		engine.on("pause", () => {
			if (disposed) return;
			silence();
			if (status === "speaking") setStatus("idle");
		}),
		engine.on("end", () => {
			if (disposed) return;
			silence();
			resumeAt = undefined;
			setStatus("idle");
		}),
		engine.on("seek", () => {
			if (disposed) return;
			silence();
			resumeAt = undefined;
			setHighlight(sentenceHighlight(engine.index));
			if (engine.playing) {
				const speakFromCursor = () => {
					pendingSeek = undefined;
					const frame = engine.frame;
					if (frame && engine.playing && !disposed) speakFrom(frame.position);
				};
				if (seekDelayMs > 0) {
					pendingSeek = timers.set(speakFromCursor, seekDelayMs);
				} else {
					speakFromCursor();
				}
			} else if (status === "speaking") {
				setStatus("idle");
			}
		}),
	];

	setHighlight(sentenceHighlight(engine.index));

	return {
		get highlight() {
			return highlight;
		},
		get status() {
			return status;
		},
		get wordSync() {
			const known = reportsWords.get(voiceKey());
			return known === undefined ? "unknown" : known ? "word" : "sentence";
		},
		setVoice(next) {
			if (disposed || next === voice) return;
			voice = next;
			notify();
			restart();
		},
		setRate(next) {
			if (disposed || next === rate) return;
			rate = next;
			restart();
		},
		subscribe(subscriber) {
			subscribers.add(subscriber);
			return () => {
				subscribers.delete(subscriber);
			};
		},
		dispose() {
			if (disposed) return;
			silence();
			disposed = true;
			for (const stop of stops) stop();
			subscribers.clear();
		},
	};
}

/** The language to give the voice: the document's tag, unless it is unknown. */
function baseTag(language: string | undefined): string | undefined {
	return language && language !== "und" ? language : undefined;
}
