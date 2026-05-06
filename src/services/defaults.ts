import type { ReaderSettings } from "../models/types.js";

/** Default font size (smaller on narrow viewports). */
export function getDefaultFontSize(): number {
	if (typeof window === "undefined") return 80;
	return window.innerWidth < 768 ? 48 : 80;
}

/** Default ORP pivot offset (% of half-width): -20 mobile, -10 desktop. */
export function getDefaultPivotOffset(): number {
	if (typeof window === "undefined") return -10;
	return window.innerWidth < 768 ? -20 : -10;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
	wpm: 300,
	fontSize: getDefaultFontSize(),
	fontFamily: "JetBrains Mono",
	highlightColor: "#e63946",
	letterSpacing: 0,
	focusPosition: "center",
	pivotOffset: getDefaultPivotOffset(),
	sentencePauseMultiplier: 2,
	showProgress: true,
	focusModeEnabled: false,
	theme: "system",
	chunkSize: 1,
	bionicMode: false,
	smartSpeed: false,
	speedRampEnabled: false,
	speedRampTarget: 500,
	dyslexiaMode: false,
	peripheralContext: true,
	peripheralContextCount: 1,
	showOrpGuides: true,
	hidePunctuationInDisplay: false,
	paragraphPauseMultiplier: 1.8,
	contextPauseOnClose: true,
	colorizeQuotes: true,
	colorizeParens: true,
	commaAsPause: false,
	rewindStep: 5,
	bionicFocusPosition: "balanced",
	countdownEnabled: false,
	clickSoundEnabled: true,
	clickSoundPitch: 1.0,
	ambientNoise: "none",
	ambientVolume: 0.5,
	irlenMode: "none",
	irlenOpacity: 0.18,
	fontWeight: 400,
	pauseView: "focus",
	quoteHighlightColor: "#a8dadc",
	parenHighlightColor: "#457b9d",
	pomodoroReadMinutes: 25,
	pomodoroBreakMinutes: 5,
	pomodoroLongBreakMinutes: 20,
	pomodoroSessionsBeforeLongBreak: 4,
	removeCitations: false,
	tickerMode: false,
};

export const AVATAR_EMOJIS = [
	"📚",
	"🦉",
	"🐉",
	"🌙",
	"⚡",
	"🎯",
	"🧠",
	"🦔",
	"🔮",
	"🌸",
	"🍀",
	"🦋",
	"🔥",
	"❄️",
	"🎭",
];
