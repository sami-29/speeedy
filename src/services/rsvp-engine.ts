import type { OrpResult, ReaderSettings } from "../models/types.js";

const COMMON_WORDS = new Set([
	"the",
	"a",
	"an",
	"is",
	"it",
	"in",
	"on",
	"at",
	"to",
	"of",
	"and",
	"or",
	"but",
	"for",
	"nor",
	"so",
	"yet",
	"as",
	"if",
	"be",
	"do",
	"go",
	"by",
	"up",
	"my",
	"we",
	"he",
	"she",
	"they",
]);

export interface TokenContext {
	paragraphStart?: boolean;
	inQuotes?: boolean;
	inParens?: boolean;
	inBrackets?: boolean;
	/** True if this token ends with )" or ]" (closing aside then quote). */
	closesAside?: boolean;
}

export interface WordToken {
	text: string;
	pauseMultiplier: number;
	context?: TokenContext;
}

export interface PlaybackState {
	playing: boolean;
	wordIndex: number;
	displayWordIndex: number;
	totalWords: number;
	currentTokens: WordToken[];
	currentOrp: OrpResult | null;
	elapsedMs: number;
	startTime: number | null;
	baseWpm: number;
	currentWpm: number;
}

export type EngineEventType = "word" | "complete" | "progress" | "stateChange";

export type EngineListener = (state: PlaybackState) => void;

export class RSVPEngine {
	private _tokens: WordToken[] = [];
	get tokens(): WordToken[] {
		return this._tokens;
	}
	private state: PlaybackState = this.emptyState();
	private timerId: ReturnType<typeof setTimeout> | null = null;
	private listeners: Map<EngineEventType, EngineListener[]> = new Map();

	private emptyState(): PlaybackState {
		return {
			playing: false,
			wordIndex: 0,
			displayWordIndex: 0,
			totalWords: 0,
			currentTokens: [],
			currentOrp: null,
			elapsedMs: 0,
			startTime: null,
			baseWpm: 300,
			currentWpm: 300,
		};
	}

	load(text: string, settings: ReaderSettings): void {
		this.stop();
		this._tokens = tokenize(text, settings);
		this.state = {
			...this.emptyState(),
			totalWords: this._tokens.length,
			baseWpm: settings.wpm,
		};
		this.updateCurrentDisplay();
		this.emit("stateChange", this.state);
	}

	play(settings: ReaderSettings): void {
		if (this.state.wordIndex >= this.tokens.length) {
			this.state.wordIndex = 0;
		}
		this.state.playing = true;
		if (!this.state.startTime) {
			this.state.startTime = Date.now() - this.state.elapsedMs;
		}
		this.state.baseWpm = settings.wpm;
		this.emit("stateChange", this.state);
		this.scheduleNext(settings);
	}

	pause(): void {
		this.clearTimer();
		this.state.playing = false;
		this.state.wordIndex = this.state.displayWordIndex;
		if (this.state.startTime) {
			this.state.elapsedMs = Date.now() - this.state.startTime;
			this.state.startTime = null;
		}
		this.updateCurrentDisplay();
		this.emit("stateChange", this.state);
	}

	stop(): void {
		this.clearTimer();
		this.state = {
			...this.emptyState(),
			totalWords: this.tokens.length,
			baseWpm: this.state.baseWpm,
		};
		this.emit("stateChange", this.state);
	}

	seekBy(delta: number): void {
		const newIndex = Math.max(
			0,
			Math.min(this.tokens.length - 1, this.state.wordIndex + delta),
		);
		this.state.wordIndex = newIndex;
		if (!this.state.playing) {
			this.updateCurrentDisplay();
		}
		this.emit("stateChange", this.state);
	}

	seekToWord(index: number): void {
		this.state.wordIndex = Math.max(0, Math.min(this.tokens.length - 1, index));
		if (!this.state.playing) {
			this.updateCurrentDisplay();
		}
		this.emit("stateChange", this.state);
	}

	setWpm(settings: ReaderSettings): void {
		this.state.baseWpm = settings.wpm;
		if (this.state.playing) {
			this.clearTimer();
			this.scheduleNext(settings, true);
		}
	}

	getState(): PlaybackState {
		return { ...this.state };
	}

	on(event: EngineEventType, listener: EngineListener): void {
		const existing = this.listeners.get(event) ?? [];
		this.listeners.set(event, [...existing, listener]);
	}

	off(event: EngineEventType, listener: EngineListener): void {
		const existing = this.listeners.get(event) ?? [];
		this.listeners.set(
			event,
			existing.filter((l) => l !== listener),
		);
	}

	getProgressPercent(): number {
		if (this.tokens.length === 0) return 0;
		return (this.state.wordIndex / this.tokens.length) * 100;
	}

	getEstimatedRemainingMs(settings: ReaderSettings): number {
		const total = this.tokens.length;
		const current = this.state.wordIndex;
		if (total === 0 || current >= total) return 0;

		const remainingTokens = this.tokens.slice(current);
		let totalMs = 0;

		const smartEnabled = settings.smartSpeed;
		const rampEnabled = settings.speedRampEnabled;
		const rampTarget = settings.speedRampTarget;
		const sentenceMult = settings.sentencePauseMultiplier;
		const paragraphMult = settings.paragraphPauseMultiplier ?? 1;
		const asideMult = settings.contextPauseOnClose ? 1.15 : 1;
		const chunkSize = settings.chunkSize || 1;

		const limit = Math.min(remainingTokens.length, 2000);
		for (let i = 0; i < limit; i += chunkSize) {
			const idx = current + i;
			const chunkTokens = remainingTokens.slice(i, i + chunkSize);
			if (chunkTokens.length === 0) break;

			const firstToken = chunkTokens[0];
			const lastToken = chunkTokens[chunkTokens.length - 1];

			let wpm = settings.wpm;
			if (rampEnabled) wpm = rampWpm(settings.wpm, rampTarget, idx, total);
			if (smartEnabled) wpm = smartWpm(wpm, firstToken.text);

			const msPerChunk = (60000 / wpm) * chunkTokens.length;
			const extraPause = lastToken.pauseMultiplier - 1;
			let delay = msPerChunk * (1 + extraPause * sentenceMult);

			if (paragraphMult > 1 && firstToken.context?.paragraphStart)
				delay *= paragraphMult;
			if (lastToken.context?.closesAside) delay *= asideMult;

			totalMs += delay;
		}

		if (remainingTokens.length > limit) {
			const avgPerWord = totalMs / limit;
			totalMs += avgPerWord * (remainingTokens.length - limit);
		}

		return totalMs;
	}

	private scheduleNext(settings: ReaderSettings, isReschedule = false): void {
		if (!this.state.playing || this.state.wordIndex >= this.tokens.length) {
			if (this.state.wordIndex >= this.tokens.length) {
				this.handleComplete();
			}
			return;
		}

		const chunkEnd = Math.min(
			this.state.wordIndex + settings.chunkSize,
			this.tokens.length,
		);
		const chunkTokens = this.tokens.slice(this.state.wordIndex, chunkEnd);
		const lastToken = chunkTokens[chunkTokens.length - 1];

		this.state.currentTokens = chunkTokens;
		this.state.displayWordIndex = this.state.wordIndex;
		this.state.currentOrp = computeOrp(
			chunkTokens.map((t) => t.text).join(" "),
			settings.bionicFocusPosition,
		);

		if (!isReschedule) {
			this.emit("word", this.state);
			this.emit("progress", this.state);
		}

		const baseWpm = settings.speedRampEnabled
			? rampWpm(
					settings.wpm,
					settings.speedRampTarget,
					this.state.wordIndex,
					this.tokens.length,
				)
			: settings.wpm;

		const finalWpm = settings.smartSpeed
			? smartWpm(baseWpm, chunkTokens[0].text)
			: baseWpm;
		this.state.currentWpm = Math.round(finalWpm);

		const msPerWord = 60000 / finalWpm;
		const totalMsForChunk = msPerWord * chunkTokens.length;

		const extraPause = lastToken.pauseMultiplier - 1;
		let delay =
			totalMsForChunk * (1 + extraPause * settings.sentencePauseMultiplier);

		const firstToken = chunkTokens[0];
		const paragraphMult = settings.paragraphPauseMultiplier ?? 1;
		if (paragraphMult > 1 && firstToken.context?.paragraphStart)
			delay *= paragraphMult;
		if (settings.contextPauseOnClose && lastToken.context?.closesAside)
			delay *= 1.15;

		if (!isReschedule) {
			this.state.wordIndex += settings.chunkSize;
		}

		this.timerId = setTimeout(() => {
			this.scheduleNext(settings);
		}, delay);
	}

	private handleComplete(): void {
		this.state.playing = false;
		if (this.state.startTime) {
			this.state.elapsedMs = Date.now() - this.state.startTime;
			this.state.startTime = null;
		}
		this.emit("complete", this.state);
		this.emit("stateChange", this.state);
	}

	private clearTimer(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}

	private updateCurrentDisplay(): void {
		if (this.tokens.length === 0) return;
		const token = this.tokens[this.state.wordIndex];
		this.state.currentTokens = [token];
		this.state.displayWordIndex = this.state.wordIndex;
		this.state.currentOrp = computeOrp(token.text);
		this.emit("word", this.state);
	}

	private emit(event: EngineEventType, state: PlaybackState): void {
		const listeners = this.listeners.get(event) ?? [];
		for (const listener of listeners) {
			listener({ ...state });
		}
	}
}

function segmentWords(para: string): string[] {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const segmenter = new Intl.Segmenter(navigator.language || "en", {
			granularity: "word",
		});
		const segments = Array.from(segmenter.segment(para));
		const words: string[] = [];
		for (const seg of segments) {
			if (seg.isWordLike) {
				words.push(seg.segment);
			} else if (words.length > 0) {
				const punct = seg.segment.trim();
				if (punct.length > 0) words[words.length - 1] += punct;
			}
		}
		return words.filter((w) => w.length > 0);
	}
	return para.split(/\s+/).filter((w) => w.length > 0);
}

export function tokenize(text: string, settings?: ReaderSettings): WordToken[] {
	const normalized = text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	const paragraphs = normalized
		.split(/\n\n+/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (paragraphs.length === 0) return [];

	const tokens: WordToken[] = [];
	let isFirstParagraph = true;
	for (const para of paragraphs) {
		const words = segmentWords(para);
		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			const context: TokenContext = {};
			if (!isFirstParagraph && i === 0) context.paragraphStart = true;
			tokens.push({
				text: word,
				pauseMultiplier: getPauseMultiplier(word, settings?.commaAsPause),
				context: Object.keys(context).length > 0 ? context : undefined,
			});
		}
		isFirstParagraph = false;
	}

	assignQuoteParenContext(tokens, paragraphs);
	return tokens;
}

function assignQuoteParenContext(
	tokens: WordToken[],
	paragraphs: string[],
): void {
	const normalizedText = paragraphs.join("\n\n");
	let wordIndex = 0;
	let inWord = false;
	let inDoubleQuote = false;
	let inSingleQuote = false;
	let parenDepth = 0;
	let bracketDepth = 0;

	for (let i = 0; i < normalizedText.length; i++) {
		const c = normalizedText[i];

		if (c === " " || c === "\n") {
			if (inWord && wordIndex < tokens.length) {
				closesAsideFromToken(tokens[wordIndex]);
				wordIndex++;
			}
			inWord = false;
		} else {
			if (c === '"') {
				inDoubleQuote = !inDoubleQuote;
			} else if (c === "'") {
				const prev = i > 0 ? normalizedText[i - 1] : "";
				const next = i < normalizedText.length - 1 ? normalizedText[i + 1] : "";
				const isWordBefore = /[\p{L}\p{N}]/u.test(prev);
				const isWordAfter = /[\p{L}\p{N}]/u.test(next);

				if (isWordBefore && !isWordAfter) {
					inSingleQuote = false;
				} else if (!isWordBefore && isWordAfter) {
					inSingleQuote = true;
				}
			} else if (c === "(") parenDepth++;
			else if (c === ")") parenDepth--;
			else if (c === "[") bracketDepth++;
			else if (c === "]") bracketDepth--;

			if (!inWord && wordIndex < tokens.length) {
				const t = tokens[wordIndex];
				t.context = t.context ?? {};
				if (inDoubleQuote || inSingleQuote) t.context.inQuotes = true;
				if (parenDepth > 0) t.context.inParens = true;
				if (bracketDepth > 0) t.context.inBrackets = true;
			}
			inWord = true;
		}
	}
	if (inWord && wordIndex < tokens.length) {
		closesAsideFromToken(tokens[wordIndex]);
	}
}

function closesAsideFromToken(t: WordToken): void {
	const text = t.text.trim();
	const closesAside = /[)"'\]]$/.test(text) || /[)"'\]][,.;]$/.test(text);
	if (closesAside) {
		t.context = t.context ?? {};
		t.context.closesAside = true;
	}
}

function getPauseMultiplier(word: string, commaAsPause = false): number {
	const last = word[word.length - 1];
	if (last === "." || last === "!" || last === "?") return 2.0;
	if (last === "," || last === ";") return commaAsPause ? 2.0 : 1.4;
	if (last === ":") return 1.4;
	return 1.0;
}

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

export function computeOrp(
	text: string,
	bionicFocusPosition: ReaderSettings["bionicFocusPosition"] = "balanced",
): OrpResult {
	const leadingMatch = text.match(/^[^\p{L}\p{N}]+/u);
	const trailingMatch = text.match(/[^\p{L}\p{N}]+$/u);

	const leading = leadingMatch ? leadingMatch[0] : "";
	const trailing = trailingMatch ? trailingMatch[0] : "";

	if (leading === text) {
		return { before: "", pivot: text, after: "" };
	}

	const coreStartIndex = leading.length;
	const coreEndIndex = text.length - trailing.length;
	const coreText = text.slice(coreStartIndex, coreEndIndex);

	const clean = coreText.replace(/[^\p{L}\p{N}]/gu, "");
	const len = clean.length;

	let pivotIndex: number;
	if (len <= 1) pivotIndex = 0;
	else if (len <= 5) pivotIndex = 1;
	else if (len <= 9) pivotIndex = 2;
	else pivotIndex = 3;

	if (bionicFocusPosition === "early" && pivotIndex > 0) {
		pivotIndex--;
	} else if (
		bionicFocusPosition === "late" &&
		pivotIndex < Math.min(len - 1, 4)
	) {
		pivotIndex++;
	}

	const originalPivotIndexInCoreText = findPivotInOriginal(
		coreText,
		pivotIndex,
	);
	const baseChar = String.fromCodePoint(
		coreText.codePointAt(originalPivotIndexInCoreText) ?? 0,
	);
	let pivotEndIndex = originalPivotIndexInCoreText + baseChar.length;

	while (pivotEndIndex < coreText.length) {
		const nextChar = String.fromCodePoint(
			coreText.codePointAt(pivotEndIndex) ?? 0,
		);
		if (/^\p{M}$/u.test(nextChar)) {
			pivotEndIndex += nextChar.length;
		} else {
			break;
		}
	}

	return {
		before: leading + coreText.slice(0, originalPivotIndexInCoreText),
		pivot: coreText.slice(originalPivotIndexInCoreText, pivotEndIndex),
		after: coreText.slice(pivotEndIndex) + trailing,
	};
}

function findPivotInOriginal(text: string, cleanIndex: number): number {
	let cleanCount = 0;
	for (let i = 0; i < text.length; ) {
		const cp = text.codePointAt(i) ?? 0;
		const char = String.fromCodePoint(cp);
		if (WORD_CHAR_RE.test(char)) {
			if (cleanCount === cleanIndex) return i;
			cleanCount++;
		}
		i += char.length;
	}
	return 0;
}

function smartWpm(base: number, word: string): number {
	const clean = word.replace(/[^\p{L}\p{N}]/gu, "");
	const len = clean.length;
	const isCommon = COMMON_WORDS.has(clean.toLowerCase());

	if (isCommon || len <= 3) return Math.min(base * 1.3, 1600);
	if (len >= 8) return Math.max(base * 0.75, 100);
	if (len >= 6) return Math.max(base * 0.9, 100);
	return base;
}

const RAMP_WORDS = 30;

function rampWpm(
	startWpm: number,
	targetWpm: number,
	currentIndex: number,
	_totalWords: number,
): number {
	if (currentIndex >= RAMP_WORDS) return targetWpm;
	const progress = currentIndex / RAMP_WORDS;
	return startWpm + (targetWpm - startWpm) * progress;
}
