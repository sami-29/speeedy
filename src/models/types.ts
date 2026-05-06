export type Route =
	| "landing"
	| "app"
	| "reader"
	| "stats"
	| "profile"
	| "share"
	| "privacy"
	| "terms"
	| "benchmark"
	| "learn"
	| "donate"
	| "promote"
	| "changelog";

export type FontFamily =
	| "JetBrains Mono"
	| "Fira Mono"
	| "Source Code Pro"
	| "Inconsolata"
	| "IBM Plex Mono";

export type FocusPosition = "left" | "center" | "right";

/** Pivot offset as a percentage of half the reading area width.
 *  0 = perfectly centred, negative = shift left, positive = shift right.
 *  Range: -30 to +30. */
export type PivotOffset = number;

export type ThemeName = "light" | "dark" | "system";

export type ChunkSize = 1 | 2 | 3 | 4 | 5;

export type IrlenMode = "none" | "peach" | "mint" | "parchment";
export type FontWeight = 300 | 400 | 500 | 600 | 700 | 800;
export type PauseView = "focus" | "context" | "fulltext";
export type BionicFocusPosition = "early" | "balanced" | "late";
export type RewindStep = number;

export interface ReaderSettings {
	wpm: number;
	fontSize: number;
	fontFamily: FontFamily;
	highlightColor: string;
	letterSpacing: number;
	focusPosition: FocusPosition;
	/** -20 to +20: horizontal pivot offset as % of reading area half-width. 0 = centre. */
	pivotOffset: PivotOffset;
	sentencePauseMultiplier: number;
	showProgress: boolean;
	/** When on, playback (and pre-roll countdown) hides header, progress bar, toolbar, and settings for full immersion. Pausing shows controls again. */
	focusModeEnabled: boolean;
	theme: ThemeName;
	chunkSize: ChunkSize;
	bionicMode: boolean;
	smartSpeed: boolean;
	speedRampEnabled: boolean;
	speedRampTarget: number;
	dyslexiaMode: boolean;
	peripheralContext: boolean;
	peripheralContextCount: number;
	showOrpGuides: boolean;
	hidePunctuationInDisplay: boolean;
	/** Extra pause on first word of a new paragraph (1 = none, ~1.8 = noticeable). */
	paragraphPauseMultiplier: number;
	/** Slight extra pause after closing )" or ]" to close the phrase. */
	contextPauseOnClose: boolean;
	/** Use a distinct color for words inside quotes. */
	colorizeQuotes: boolean;
	/** Use a distinct color for words inside parentheses or brackets. */
	colorizeParens: boolean;
	/** Treat commas as full sentence-end pauses. */
	commaAsPause: boolean;
	/** How many words to rewind when pressing the rewind button / arrow key. */
	rewindStep: RewindStep;
	/** Where the ORP pivot letter sits within the word (shifts index left/right). */
	bionicFocusPosition: BionicFocusPosition;
	/** Show a 3-2-1 countdown before reading starts. */
	countdownEnabled: boolean;
	/** Play a soft click sound on each word flash. */
	clickSoundEnabled: boolean;
	/** Pitch multiplier for the click sound, 0.1–3.0. */
	clickSoundPitch: number;
	/** Ambient background noise. */
	ambientNoise: "none" | "white" | "pink" | "brown";
	/** Ambient background volume, 0.0-1.0. */
	ambientVolume: number;
	/** Tinted overlay for Irlen syndrome / visual stress. */
	irlenMode: IrlenMode;
	/** Irlen overlay opacity, 0.0–0.5. */
	irlenOpacity: number;
	/** Font weight for the reading display. */
	fontWeight: FontWeight;
	/** What to show when paused: focus (just the current word) or fulltext (entire text). */
	pauseView: PauseView;
	/** Color for words inside quotes. */
	quoteHighlightColor: string;
	/** Color for words inside parentheses/brackets. */
	parenHighlightColor: string;
	/** Pomodoro focus duration in minutes. */
	pomodoroReadMinutes: number;
	/** Pomodoro break duration in minutes. */
	pomodoroBreakMinutes: number;
	/** Pomodoro long break duration in minutes (after N sessions). */
	pomodoroLongBreakMinutes: number;
	/** Number of focus sessions before a long break. */
	pomodoroSessionsBeforeLongBreak: number;
	/** Strip inline citations (e.g. [1], (Smith et al., 2020)) from text for cleaner academic reading. */
	removeCitations: boolean;
	/** When on, text scrolls horizontally left-to-right at WPM pace instead of RSVP flashing. */
	tickerMode: boolean;
}

export interface ReadingSession {
	id: string;
	date: string;
	sourceTitle: string;
	wordCount: number;
	wordsRead: number;
	wpm: number;
	durationMs: number;
	completionPercent: number;
}

export interface ReadingGoal {
	type: "words" | "minutes";
	target: number;
}

export interface UserProfile {
	id: string;
	displayName: string;
	avatarEmoji: string;
	avatarImage?: string | null;
	createdAt: string;
	goals: ReadingGoal;
	totalWordsRead: number;
	totalTimeMs: number;
	currentStreak: number;
	bestStreak: number;
	lastReadDate: string | null;
	sessions: ReadingSession[];
	settings: ReaderSettings;
	baselineWpm: number | null;
	baselineComprehension: number | null;
	onboardingSeen: boolean;
	githubStarPromptDismissed?: boolean;
}

export interface ParsedDocument {
	title: string;
	text: string;
	wordCount: number;
}

export interface SavedDocument {
	id: string;
	title: string;
	text: string;
	wordCount: number;
	savedAt: string;
	resumeWordIndex: number;
	completionPercent: number;
	/** SHA-256 hash of text for deduplication; optional for legacy docs. */
	contentHash?: string;
}

export interface OrpResult {
	before: string;
	pivot: string;
	after: string;
}

export interface ShareData {
	displayName: string;
	avatarEmoji: string;
	avatarImage?: string | null;
	totalWordsRead: number;
	totalTimeMs: number;
	avgWpm: number;
	currentStreak: number;
	bestStreak: number;
	recentWpms: number[];
}
