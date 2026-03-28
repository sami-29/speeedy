import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type {
	ParsedDocument,
	ReaderSettings,
	UserProfile,
} from "../models/types.js";
import { audioService } from "../services/audio-service.js";
import { DEFAULT_SETTINGS } from "../services/defaults.js";
import { type PlaybackState, RSVPEngine } from "../services/rsvp-engine.js";
import { recordSession } from "../services/stats-service.js";
import {
	getSavedDocuments,
	updateDocumentProgress,
} from "../services/storage-service.js";
import { applyBionicReading } from "../services/text-parser.js";
import { applyTheme } from "../services/theme-service.js";
import { trackEvent, wpmBracket } from "../utils/analytics.js";
import { emitProfileUpdated, navigate } from "../utils/events.js";
import "./settings-panel.ts";
import "./wellness-overlay.ts";

@customElement("rsvp-reader")
export class RsvpReader extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) profile!: UserProfile;
	@property({ type: Object }) pendingDoc: ParsedDocument | null = null;
	@property({ type: String }) savedDocId: string | null = null;
	@property({ type: Number }) resumeWordIndex = 0;

	@state() private engine = new RSVPEngine();
	@state() private playbackState: PlaybackState | null = null;
	@state() private settings!: ReaderSettings;
	@state() private showSettings = true;
	@state() private showShortcuts = false;
	@state() private sessionStartTime: number | null = null;
	@state() private wordsAtSessionStart = 0;
	@state() private docTitle = "";
	@state() private totalDocWords = 0;
	@state() private isCountingDown = false;
	@state() private countdownNumber = 0;
	@state() private isProgressHovered = false;
	@state() private isSeeking = false;
	@state() private seekWordIndex: number | null = null;
	private wasPlayingBeforeSeek = false;
	private countdownTimer: ReturnType<typeof setTimeout> | null = null;
	private seekingPointerId: number | null = null;

	private keyHandler = (e: KeyboardEvent): void => {
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement
		)
			return;
		switch (e.key) {
			case " ":
				e.preventDefault();
				this.togglePlay();
				break;
			case "ArrowRight":
				this.emit("settings-change", {
					wpm: Math.min(1600, this.settings.wpm + 25),
				});
				break;
			case "ArrowLeft":
				this.emit("settings-change", {
					wpm: Math.max(100, this.settings.wpm - 25),
				});
				break;
			case "ArrowUp":
				this.engine.seekBy(-(this.settings.rewindStep ?? 5));
				break;
			case "ArrowDown":
				this.engine.seekBy(this.settings.rewindStep ?? 5);
				break;
			case "r":
			case "R":
				this.engine.stop();
				break;
			case "Escape":
				this.handleBack();
				break;
			case "?":
				this.showShortcuts = !this.showShortcuts;
				break;
			case "f":
			case "F":
				e.preventDefault();
				this.emit("settings-change", {
					focusModeEnabled: !this.settings.focusModeEnabled,
				});
				break;
		}
	};

	private emit(type: string, detail: Partial<ReaderSettings>): void {
		this.handleSettingsChange(
			new CustomEvent(type, { detail: { ...this.settings, ...detail } }),
		);
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.settings = {
			...DEFAULT_SETTINGS,
			...this.profile.settings,
		};

		this.engine.on("word", (s) => {
			this.playbackState = s;
			if (s.playing) {
				const w = s.currentTokens[0]?.text ?? "";
				if (this.settings.clickSoundEnabled) {
					const type = /[.!?]$/.test(w)
						? "sentence"
						: /[,;:]$/.test(w)
							? "comma"
							: "tick";
					audioService.playTick(type, this.settings.clickSoundPitch ?? 1.0);
				}
			}
		});
		this.engine.on("progress", (s) => {
			this.playbackState = s;
		});
		this.engine.on("stateChange", (s) => {
			this.playbackState = s;
		});
		this.engine.on("complete", (s) => {
			this.playbackState = s;
			this.saveSession(s);
			this.persistProgress(s);
			audioService.stopAmbientNoise();
			if (s.totalWords > 0) {
				const wpm =
					s.elapsedMs > 0 ? Math.round((s.wordIndex / s.elapsedMs) * 60000) : 0;
				trackEvent("reader-completed", {
					wpm_bracket: wpmBracket(wpm),
					words: s.totalWords,
				});
			}
		});

		if (this.pendingDoc) {
			this.loadDoc(this.pendingDoc);
			if (this.savedDocId) {
				localStorage.setItem("speeedy:last-doc-id", this.savedDocId);
			}
		} else {
			void this.restoreLastDocument();
		}

		window.addEventListener("keydown", this.keyHandler);
	}

	private async restoreLastDocument() {
		const docs = await getSavedDocuments();
		if (docs.length === 0) return;

		const lastId = localStorage.getItem("speeedy:last-doc-id");
		let docToLoad = docs.find((d) => d.id === lastId);
		if (!docToLoad) {
			docToLoad = docs[0];
			localStorage.setItem("speeedy:last-doc-id", docToLoad.id);
		}

		this.savedDocId = docToLoad.id;
		this.resumeWordIndex = docToLoad.resumeWordIndex;
		this.loadDoc({
			title: docToLoad.title,
			text: docToLoad.text,
			wordCount: docToLoad.wordCount,
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.engine.stop();
		audioService.stopAmbientNoise();
		window.removeEventListener("keydown", this.keyHandler);
		this._rtlResizeObserver?.disconnect();
		this._rtlResizeObserver = null;
	}

	protected override updated(
		changedProperties: Map<string | number | symbol, unknown>,
	): void {
		super.updated(changedProperties);
		if (
			this.playbackState &&
			!this.playbackState.playing &&
			(this.settings.pauseView === "fulltext" ||
				this.settings.pauseView === "context")
		) {
			requestAnimationFrame(() => {
				const activeWord = this.renderRoot.querySelector("#current-pause-word");
				if (activeWord) {
					activeWord.scrollIntoView({ behavior: "smooth", block: "center" });
				}
			});
		}

		this.alignRtlPivot();
	}

	/** RTL pivot alignment; updated on resize, not each word. */
	private _rtlPivotOffset = 0;
	private _rtlResizeObserver: ResizeObserver | null = null;

	private alignRtlPivot() {
		const measurer = this.renderRoot.querySelector(
			"#rtl-measurer",
		) as HTMLElement;
		const pivot = this.renderRoot.querySelector("#rtl-pivot") as HTMLElement;
		const shifter = this.renderRoot.querySelector(
			"#rtl-shifter",
		) as HTMLElement;

		if (!measurer || !pivot || !shifter) return;

		if (!this._rtlResizeObserver) {
			this._rtlResizeObserver = new ResizeObserver(() => {
				this._recalcRtlPivot();
			});
			this._rtlResizeObserver.observe(measurer);
		}

		shifter.style.transform = `translateX(${this._rtlPivotOffset}px)`;
	}

	private _recalcRtlPivot() {
		const measurer = this.renderRoot.querySelector(
			"#rtl-measurer",
		) as HTMLElement;
		const pivot = this.renderRoot.querySelector("#rtl-pivot") as HTMLElement;
		const shifter = this.renderRoot.querySelector(
			"#rtl-shifter",
		) as HTMLElement;

		if (!measurer || !pivot || !shifter) return;

		const mRect = measurer.getBoundingClientRect();
		const pRect = pivot.getBoundingClientRect();

		const mCenter = mRect.left + mRect.width / 2;
		const pCenter = pRect.left + pRect.width / 2;
		this._rtlPivotOffset = mCenter - pCenter;
		shifter.style.transform = `translateX(${this._rtlPivotOffset}px)`;
	}

	private static readonly RESUME_LOOKBACK_WORDS = 12;

	private loadDoc(doc: ParsedDocument): void {
		this.docTitle = doc.title;
		this.totalDocWords = doc.wordCount;
		this.engine.load(doc.text, this.settings);
		if (this.resumeWordIndex > 0) {
			const startIndex = Math.max(
				0,
				this.resumeWordIndex - RsvpReader.RESUME_LOOKBACK_WORDS,
			);
			this.engine.seekToWord(startIndex);
			this.wordsAtSessionStart = startIndex;
		} else {
			this.wordsAtSessionStart = this.resumeWordIndex;
		}
		this.sessionStartTime = null;
	}

	private togglePlay(): void {
		const state = this.engine.getState();

		if (this.isCountingDown) {
			this.isCountingDown = false;
			if (this.countdownTimer) {
				clearTimeout(this.countdownTimer);
				this.countdownTimer = null;
			}
			return;
		}

		if (state.playing) {
			this.engine.pause();
			audioService.stopAmbientNoise();
		} else {
			this.showSettings = false;
			if (!this.sessionStartTime) {
				this.sessionStartTime = Date.now();
				this.wordsAtSessionStart = state.wordIndex;
			}

			if (this.settings.countdownEnabled) {
				this.isCountingDown = true;
				this.countdownNumber = 3;

				const tick = () => {
					if (!this.isCountingDown) return;
					if (this.countdownNumber > 1) {
						this.countdownNumber--;
						this.countdownTimer = setTimeout(tick, 800);
					} else {
						this.isCountingDown = false;
						this.countdownTimer = null;
						this.engine.play(this.settings);
						audioService.setAmbientNoise(
							this.settings.ambientNoise,
							this.settings.ambientVolume,
						);
					}
				};
				this.countdownTimer = setTimeout(tick, 800);
			} else {
				this.engine.play(this.settings);
				audioService.setAmbientNoise(
					this.settings.ambientNoise,
					this.settings.ambientVolume,
				);
			}
		}
	}

	private handleSettingsChange(e: CustomEvent): void {
		const newSettings = e.detail as ReaderSettings;
		this.settings = newSettings;
		this.engine.setWpm(newSettings);
		applyTheme(newSettings.theme);

		const updatedProfile: UserProfile = {
			...this.profile,
			settings: newSettings,
		};
		emitProfileUpdated(updatedProfile);
	}

	private saveSession(state: PlaybackState): void {
		if (!this.sessionStartTime) return;
		const durationMs = Date.now() - this.sessionStartTime;
		const wordsRead = state.wordIndex - this.wordsAtSessionStart;
		if (wordsRead < 10 || durationMs < 5000) return;

		const wpm = Math.round((wordsRead / durationMs) * 60000);
		const completionPercent = Math.round(
			(state.wordIndex / state.totalWords) * 100,
		);

		const updatedProfile = recordSession(this.profile, {
			date: new Date().toISOString(),
			sourceTitle: this.docTitle,
			wordCount: this.totalDocWords,
			wordsRead,
			wpm,
			durationMs,
			completionPercent,
		});

		emitProfileUpdated(updatedProfile);
		this.sessionStartTime = Date.now();
		this.wordsAtSessionStart = state.wordIndex;
	}

	private handleBack(): void {
		const state = this.engine.getState();
		if (state.playing) {
			this.engine.pause();
			this.saveSession(state);
		}
		this.persistProgress(state);
		navigate("app");
	}

	private persistProgress(state: PlaybackState): void {
		if (!this.savedDocId || state.totalWords === 0) return;
		const completionPercent = Math.round(
			(state.wordIndex / state.totalWords) * 100,
		);
		void updateDocumentProgress(
			this.savedDocId,
			state.wordIndex,
			completionPercent,
		);
	}

	private seekRatioFromPointerEvent(e: PointerEvent): number {
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	private onSeekStart = (e: PointerEvent): void => {
		e.preventDefault();
		this.isSeeking = true;
		this.isProgressHovered = true;
		this.seekingPointerId = e.pointerId;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

		this.wasPlayingBeforeSeek = this.engine.getState().playing;
		if (this.wasPlayingBeforeSeek) {
			this.engine.pause();
		}

		const s = this.playbackState;
		if (!s || s.totalWords === 0) return;
		const ratio = this.seekRatioFromPointerEvent(e);
		const idx = Math.round(ratio * (s.totalWords - 1));
		this.seekWordIndex = idx;
		this.engine.seekToWord(idx);
	};

	private onSeekMove = (e: PointerEvent): void => {
		if (!this.isSeeking || e.pointerId !== this.seekingPointerId) return;
		e.preventDefault();
		const s = this.playbackState;
		if (!s || s.totalWords === 0) return;
		const ratio = this.seekRatioFromPointerEvent(e);
		const idx = Math.round(ratio * (s.totalWords - 1));
		this.seekWordIndex = idx;
		this.engine.seekToWord(idx);
	};

	private onSeekEnd = (e: PointerEvent): void => {
		if (e.pointerId !== this.seekingPointerId) return;

		if (this.wasPlayingBeforeSeek) {
			this.engine.play(this.settings);
			audioService.setAmbientNoise(
				this.settings.ambientNoise,
				this.settings.ambientVolume,
			);
		}

		this.isSeeking = false;
		this.isProgressHovered = false;
		this.seekWordIndex = null;
		this.seekingPointerId = null;
		this.wasPlayingBeforeSeek = false;
	};

	override render() {
		const s = this.playbackState;
		const playing = s?.playing ?? false;
		const displayWordIndex =
			this.isSeeking && this.seekWordIndex !== null
				? this.seekWordIndex
				: (s?.wordIndex ?? 0);
		const progress = s
			? (displayWordIndex / Math.max(s.totalWords, 1)) * 100
			: 0;
		const wpm = s?.playing
			? (s.currentWpm ?? this.settings.wpm)
			: this.settings.wpm;
		const remainingMs = s
			? this.engine.getEstimatedRemainingMs(this.settings)
			: 0;
		const remainingSeconds = Math.ceil(remainingMs / 1000);
		const remainingLabel = this.formatTimeRemaining(remainingSeconds);

		const hasDoc = (s?.totalWords ?? 0) > 0;
		/** Immersive chrome hidden only when the setting is on and playback (or countdown) is active. Pausing always shows controls again. */
		const focusModeActive =
			hasDoc &&
			(this.settings.focusModeEnabled ?? false) &&
			(playing || this.isCountingDown);

		const irlenOpacity = this.settings.irlenOpacity ?? 0.18;
		const irlenColors: Record<string, string> = {
			peach: `rgba(255, 160, 80, ${irlenOpacity})`,
			mint: `rgba(80, 200, 140, ${irlenOpacity})`,
			parchment: `rgba(210, 185, 110, ${irlenOpacity})`,
		};
		const irlenStyle =
			this.settings.irlenMode !== "none" && irlenColors[this.settings.irlenMode]
				? `background-color: ${irlenColors[this.settings.irlenMode]}; pointer-events: none;`
				: "";

		return html`
			<div
				class="flex h-screen bg-base-100 overflow-hidden relative"
				data-focus-mode="${focusModeActive}"
			>

				<!-- Irlen Mode Overlay -->
				${
					irlenStyle
						? html`<div class="absolute inset-0 z-50" style="${irlenStyle}"></div>`
						: ""
				}

			<!-- Countdown Overlay -->
			${
				this.isCountingDown
					? html`
				<div class="absolute inset-0 z-40 flex items-center justify-center bg-base-100" aria-live="assertive" aria-atomic="true">
					<span class="countdown-number text-9xl font-bold text-primary tabular-nums" key=${this.countdownNumber}>
						${this.countdownNumber > 0 ? this.countdownNumber : "GO"}
					</span>
				</div>
			`
					: ""
			}

				<!-- Main Reader Area -->
				<div class="flex-1 flex flex-col min-w-0 min-h-0">

					<!-- Top Bar -->
					${
						focusModeActive
							? nothing
							: html`
					<div class="flex items-center justify-between px-4 md:px-5 py-3 md:py-4 border-b border-base-200 shrink-0 min-h-[48px]">
						<div class="flex items-center gap-2 md:gap-3 min-w-0">
						<button
							type="button"
							class="btn btn-ghost btn-md btn-circle shrink-0 min-h-[44px] min-w-[44px] touch-manipulation"
							@click=${this.handleBack}
							title="Back to home (Esc)"
							aria-label="Back to home"
						>
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
							</svg>
						</button>
							<span class="text-xs md:text-sm text-base-content/70 truncate font-light tracking-wide">${this.docTitle || "No document"}</span>
						</div>
						<div class="flex items-center gap-1 md:gap-2 shrink-0 relative z-50">
							<span class="text-xs md:text-sm text-base-content/55 font-mono hidden md:block mr-2">
								${s?.wordIndex ?? 0}<span class="text-ui-muted-subtle"> / ${s?.totalWords ?? 0}</span>
							</span>
							<wellness-overlay
							.playing=${s?.playing ?? false}
							.settings=${this.settings}
							@pomodoro-break-start=${() => {
								if (s?.playing) this.engine.pause();
								audioService.stopAmbientNoise();
							}}
							@pomodoro-resume=${() => {
								if (!this.engine.getState().playing) this.togglePlay();
							}}
							@settings-change=${(e: CustomEvent) => this.handleSettingsChange(new CustomEvent("settings-change", { detail: { ...this.settings, ...e.detail } }))}
						></wellness-overlay>
						<button
							type="button"
							class="btn btn-ghost btn-md btn-circle min-h-[44px] min-w-[44px] touch-manipulation"
							@click=${() => {
								this.showShortcuts = true;
							}}
							title="Keyboard shortcuts (?)"
							aria-label="Show keyboard shortcuts"
						>
							<svg class="w-5 h-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
									d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
							</svg>
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-md btn-circle min-h-[44px] min-w-[44px] touch-manipulation ${this.showSettings ? "bg-base-200" : ""}"
							data-umami-event="settings-opened"
							@click=${() => {
								this.showSettings = !this.showSettings;
							}}
							title="Settings"
							aria-label="${this.showSettings ? "Close settings" : "Open settings"}"
							aria-expanded="${this.showSettings}"
						>
							<svg class="w-5 h-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
									d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
							</svg>
						</button>
						</div>
					</div>
					`
					}

				<!-- Progress / Seek bar -->
				${
					!focusModeActive && this.settings.showProgress
						? html`
					<div
						class="w-full shrink-0 cursor-pointer select-none relative"
						style="height: ${this.isProgressHovered || this.isSeeking ? "10px" : "4px"}; transition: height 0.15s ease; background: oklch(var(--b2));"
						@pointerenter=${() => {
							this.isProgressHovered = true;
						}}
						@pointerleave=${(_e: PointerEvent) => {
							if (!this.isSeeking) this.isProgressHovered = false;
						}}
						@pointerdown=${this.onSeekStart}
						@pointermove=${this.onSeekMove}
						@pointerup=${this.onSeekEnd}
						@pointercancel=${this.onSeekEnd}
					>
						<div
							class="h-full bg-primary pointer-events-none"
							style="width: ${progress}%; transition: width ${this.isSeeking ? "0ms" : "300ms"} ease-out;"
						></div>
						<!-- Seek thumb — visible on hover/drag -->
						${
							this.isProgressHovered || this.isSeeking
								? html`
							<div
								class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary shadow pointer-events-none"
								style="left: calc(${progress}% - 6px);"
							></div>
						`
								: ""
						}
					</div>
				`
						: ""
				}

					<!-- Word Display Area -->
					<div
						class="flex-1 flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden relative"
						@click=${this.togglePlay}
					>
						${
							!s || s.totalWords === 0
								? this.renderEmptyState()
								: (
											!s.playing &&
												(this.settings.pauseView === "fulltext" ||
													this.settings.pauseView === "context")
										)
									? this.renderFullTextPauseView(s)
									: this.renderWordDisplay(s)
						}
					</div>

					<!-- Bottom Controls -->
					${
						focusModeActive
							? nothing
							: html`
					<div class="border-t border-base-200 px-4 md:px-6 py-4 md:py-5 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] relative z-30">
						${this.renderControls(playing, wpm, remainingSeconds, remainingLabel)}
					</div>
					`
					}
				</div>

				<!-- Settings Sidebar (RIGHT, desktop only) -->
			${
				focusModeActive
					? nothing
					: html`
			<div class="hidden md:flex transition-all duration-300 ${this.showSettings ? "w-80 border-l border-base-200" : "w-0"} overflow-hidden shrink-0 bg-base-100 flex-col relative z-40">
				<div class="w-80 flex flex-col h-full overflow-hidden">
					<div class="px-5 py-4 border-b border-base-200 flex items-center justify-between shrink-0">
						<span class="text-sm font-medium text-base-content/70 tracking-wide">Settings</span>
						<button class="btn btn-ghost btn-sm btn-circle" aria-label="Close settings" @click=${() => {
							this.showSettings = false;
						}}>
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
							</svg>
						</button>
					</div>
						<div class="flex-1 overflow-y-auto">
							<settings-panel
								.settings=${this.settings}
								@settings-change=${this.handleSettingsChange}
							></settings-panel>
						</div>
					</div>
				</div>
			`
			}

			</div>

		<!-- Settings Bottom Sheet (mobile only) -->
		${
			!focusModeActive && this.showSettings
				? html`
			<div class="md:hidden fixed inset-0 z-40 flex flex-col justify-end">
				<!-- Backdrop -->
				<div
					class="absolute inset-0 bg-base-content/40"
					@click=${() => {
						this.showSettings = false;
					}}
					aria-hidden="true"
				></div>
				<!-- Sheet -->
				<div class="relative bg-base-100 rounded-t-2xl max-h-[80vh] flex flex-col shadow-2xl z-10 w-full" role="dialog" aria-label="Reader settings">
					<div class="flex items-center justify-between px-5 py-4 border-b border-base-200 shrink-0">
						<span class="text-sm font-medium text-base-content/70 tracking-wide">Settings</span>
						<button class="btn btn-ghost btn-sm btn-circle" aria-label="Close settings" @click=${() => {
							this.showSettings = false;
						}}>
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
							</svg>
						</button>
					</div>
						<div class="flex-1 overflow-y-auto w-full">
							<settings-panel
								.settings=${this.settings}
								@settings-change=${this.handleSettingsChange}
							></settings-panel>
						</div>
					</div>
				</div>
			`
				: ""
		}

			<!-- Shortcuts Modal -->
			${this.showShortcuts ? this.renderShortcutsModal() : ""}
		`;
	}

	private renderEmptyState() {
		return html`
      <div class="text-center">
        <p class="text-base-content/65 text-lg font-light mb-4">No document loaded</p>
        <button class="btn btn-primary btn-sm" @click=${() => navigate("app")}>
          Load a document
        </button>
      </div>
    `;
	}

	private renderFullTextPauseView(s: PlaybackState) {
		const tokens = this.engine.tokens;
		if (!tokens || tokens.length === 0) return this.renderWordDisplay(s);

		const currentIdx = s.displayWordIndex;
		let displayTokens = tokens.map((token, idx) => ({ token, idx }));

		if (this.settings.pauseView === "context") {
			const start = Math.max(0, currentIdx - 40);
			const end = Math.min(tokens.length, currentIdx + 40);
			displayTokens = displayTokens.slice(start, end);
		}

		return html`
      <div
        class="w-full h-full overflow-y-auto px-6 py-4 cursor-text"
        @click=${(e: Event) => e.stopPropagation()}
        style="font-size: ${this.settings.fontSize * 0.45}px; font-family: '${this.settings.fontFamily}', monospace; line-height: 1.8; letter-spacing: 0.02em; word-spacing: 0.1em; max-width: 720px; margin: 0 auto; scroll-behavior: smooth;"
      >
        <p class="text-xs text-base-content/40 mb-3 text-center font-mono">
          Paused — click any word to jump to it, then press play
        </p>
        <p class="text-base-content/80 text-start" dir="auto">
          ${displayTokens.map(
						({ token, idx }) => html`<span
              id="${idx === currentIdx ? "current-pause-word" : ""}"
              class="cursor-pointer rounded transition-colors duration-150 hover:bg-primary/20 whitespace-pre-wrap inline-block max-w-full break-all ${
								idx === currentIdx
									? "bg-primary/30 text-primary font-bold px-1"
									: idx < currentIdx
										? "text-base-content/40 hover:text-base-content/60"
										: "hover:text-base-content/80"
							}"
              @click=${(e: Event) => {
								e.stopPropagation();
								this.engine.seekToWord(idx);
								this.requestUpdate();
							}}
            >${token.text}</span> `,
					)}
        </p>
      </div>
    `;
	}

	/** Display-only; does not affect timing or tokens. */
	private stripTrailingPunctuation(s: string): string {
		return s.replace(/[.,;:!?'")]+$/, "");
	}

	private isRtlText(word: string): boolean {
		return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
			word,
		);
	}

	private renderWordDisplay(s: PlaybackState) {
		const word = s.currentTokens.map((t) => t.text).join(" ");
		const orp = s.currentOrp;

		const hidePunct = this.settings.hidePunctuationInDisplay ?? false;
		const displayWord = hidePunct
			? word
					.split(" ")
					.map((w) => this.stripTrailingPunctuation(w))
					.join(" ")
			: word;
		const displayOrp =
			orp && hidePunct
				? {
						before: this.stripTrailingPunctuation(orp.before),
						pivot: orp.pivot,
						after: this.stripTrailingPunctuation(orp.after),
					}
				: orp;

		const isDyslexia = this.settings.dyslexiaMode;
		const fontFamily = isDyslexia
			? "OpenDyslexic"
			: `'${this.settings.fontFamily}', 'Amiri Quran', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, 'PingFang SC', 'Microsoft YaHei', sans-serif`;
		const letterSpacing = isDyslexia
			? Math.max(this.settings.letterSpacing + 0.08, 0.08)
			: this.settings.letterSpacing;
		const wordSpacing = isDyslexia ? "0.2em" : "normal";
		const lineHeight = isDyslexia ? "1.5" : "1";

		const fontWeight = this.settings.fontWeight ?? 400;
		const fontStyle = `font-size: ${this.settings.fontSize}px; font-family: ${fontFamily}; letter-spacing: ${letterSpacing}em; word-spacing: ${wordSpacing}; line-height: ${lineHeight}; font-weight: ${fontWeight}`;
		const peripheralStyle = `font-size: ${this.settings.fontSize * 0.38}px; font-family: ${fontFamily}; letter-spacing: ${letterSpacing}em; word-spacing: ${wordSpacing}; font-weight: ${fontWeight}`;

		const count = this.settings.peripheralContextCount ?? 1;
		const displayIdx = s.displayWordIndex;
		const prevWordsRaw = this.settings.peripheralContext
			? Array.from({ length: count }, (_, i) => {
					const idx = displayIdx - count + i;
					return idx >= 0 ? (this.engine.tokens?.[idx]?.text ?? "") : "";
				}).filter(Boolean)
			: [];
		const nextWordsRaw = this.settings.peripheralContext
			? Array.from({ length: count }, (_, i) => {
					const idx = displayIdx + 1 + i;
					return idx < s.totalWords
						? (this.engine.tokens?.[idx]?.text ?? "")
						: "";
				}).filter(Boolean)
			: [];
		const prevWords = hidePunct
			? prevWordsRaw.map((w) => this.stripTrailingPunctuation(w))
			: prevWordsRaw;
		const nextWords = hidePunct
			? nextWordsRaw.map((w) => this.stripTrailingPunctuation(w))
			: nextWordsRaw;

		const offset = this.settings.pivotOffset ?? 0;
		const translateStyle =
			offset !== 0 ? `transform: translateX(${offset}%)` : "";

		const rtl = this.isRtlText(word);
		const dirAttr = rtl ? "rtl" : "ltr";

		const hasQuotes = s.currentTokens.some((t) => t.context?.inQuotes);
		const hasParens = s.currentTokens.some(
			(t) => t.context?.inParens || t.context?.inBrackets,
		);
		const colorizeQuotes = this.settings.colorizeQuotes ?? false;
		const colorizeParens = this.settings.colorizeParens ?? false;

		const contextColor =
			colorizeQuotes && hasQuotes
				? this.settings.quoteHighlightColor || "oklch(var(--s))"
				: colorizeParens && hasParens
					? this.settings.parenHighlightColor || "oklch(var(--p))"
					: "";

		const wordContent = this.settings.bionicMode
			? this.renderBionicOrpWord(displayWord, displayOrp, contextColor)
			: displayOrp
				? this.renderOrpWord(displayOrp, rtl, contextColor)
				: html`<span class="block text-center" style="${contextColor ? `color: ${contextColor}` : "color: oklch(var(--bc) / 0.8)"}">${displayWord}</span>`;

		return html`
      <div
        class="reading-box flex flex-col gap-3 min-w-0 items-center"
        style="${translateStyle}"
        dir="${dirAttr}"
      >
        ${
					prevWords.length
						? html`
          <span class="peripheral-context text-base-content/15 font-mono select-none leading-none" style="${peripheralStyle}">
            ${prevWords.join(" ")}
          </span>
        `
						: ""
				}

        <div class="word-flash leading-none w-full min-w-0" style="${fontStyle}">
          ${wordContent}
        </div>

        ${
					nextWords.length
						? html`
          <span class="peripheral-context text-base-content/15 font-mono select-none leading-none" style="${peripheralStyle}">
            ${nextWords.join(" ")}
          </span>
        `
						: ""
				}
      </div>
    `;
	}

	private renderOrpWord(
		orp: { before: string; pivot: string; after: string },
		rtl = false,
		contextColor = "",
	) {
		const guides = this.settings.showOrpGuides;
		const color = this.settings.highlightColor;

		const { before, pivot, after } = orp;

		const baseColor = contextColor || "oklch(var(--bc) / 0.8)";
		if (rtl) {
			return html`
				<div class="relative w-full flex flex-col items-center justify-center">
					${guides ? html`<div class="w-[2px] h-[0.45em] bg-base-content/30 rounded-[1px] mb-1.5 opacity-60"></div>` : ""}
					
					<div id="rtl-shifter" class="text-center transition-none" dir="rtl" style="font-size: 1.1em; will-change: transform; contain: layout;">
						<span id="rtl-measurer" class="inline-block whitespace-nowrap leading-none transition-none relative z-10 py-1">
							<span style="color:${baseColor}">${before}</span><span id="rtl-pivot" style="color:${color}; font-weight:700;">${pivot}</span><span style="color:${baseColor}">${after}</span>
						</span>
					</div>

					${guides ? html`<div class="w-[2px] h-[0.45em] bg-base-content/30 rounded-[1px] mt-1.5 opacity-60"></div>` : ""}
				</div>
			`;
		}

		return html`
			<div class="orp-container">
				<span class="orp-before" style="color:${baseColor}"><span class="orp-before-inner">${before}</span></span>
				<span class="orp-pivot-col">
					${guides ? html`<span class="orp-guide" style="color:${color}"></span>` : ""}
					<span style="color:${color}; font-weight:700; line-height:1">${pivot}</span>
					${guides ? html`<span class="orp-guide" style="color:${color}"></span>` : ""}
				</span>
				<span class="orp-after" style="color:${baseColor}">${after}</span>
			</div>
		`;
	}

	private renderBionicOrpWord(
		word: string,
		orp: { before: string; pivot: string; after: string } | null,
		contextColor = "",
	) {
		const color = this.settings.highlightColor;
		const guides = this.settings.showOrpGuides;

		if (!orp) {
			return unsafeHTML(
				`<span class="text-base-content/80">${applyBionicReading(word)}</span>`,
			);
		}

		const bionicBefore = applyBionicReading(orp.before.trimEnd());
		const bionicAfter = applyBionicReading(orp.after.trimStart());
		const baseColor = contextColor || "oklch(var(--bc) / 0.8)";

		return html`
      <div class="orp-container">
        <span class="orp-before" style="color:${baseColor}"><span class="orp-before-inner">${unsafeHTML(bionicBefore)}</span></span>
        <span class="orp-pivot-col">
          ${guides ? html`<span class="orp-guide" style="color:${color}"></span>` : ""}
          <span style="color:${color}; font-weight:700; line-height:1">${orp.pivot}</span>
          ${guides ? html`<span class="orp-guide" style="color:${color}"></span>` : ""}
        </span>
        <span class="orp-after" style="color:${baseColor}">${unsafeHTML(bionicAfter)}</span>
      </div>
    `;
	}

	private formatTimeRemaining(seconds: number): string {
		if (seconds <= 0) return "";
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const sec = seconds % 60;
		if (h > 0) return `${h}h ${m}m`;
		if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
		return `${sec}s`;
	}

	private renderControls(
		playing: boolean,
		wpm: number,
		remainingSeconds: number,
		remainingLabel: string,
	) {
		const step = this.settings.rewindStep ?? 5;
		return html`
      <div class="flex flex-wrap items-center justify-center gap-3 md:gap-4 max-w-2xl mx-auto w-full" role="toolbar" aria-label="Playback controls">

        <!-- Rewind N words -->
        <button
          type="button"
          class="btn btn-ghost btn-md btn-circle min-h-[44px] min-w-[44px] touch-manipulation"
          @click=${() => {
						this.engine.seekBy(-step);
					}}
          title="Back ${step} words (↑)"
          aria-label="Back ${step} words"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"/>
          </svg>
        </button>

        <!-- Play/Pause -->
        <button
          type="button"
          class="btn btn-primary btn-circle btn-lg min-h-[52px] min-w-[52px] touch-manipulation"
          @click=${this.togglePlay}
          title="Play/Pause (Space)"
          aria-label="${playing ? "Pause" : "Play"}"
          aria-pressed="${playing}"
        >
          ${
						playing
							? html`<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>`
							: html`<svg class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z"/>
              </svg>`
					}
        </button>

        <!-- Skip N words -->
        <button
          type="button"
          class="btn btn-ghost btn-md btn-circle min-h-[44px] min-w-[44px] touch-manipulation"
          @click=${() => {
						this.engine.seekBy(step);
					}}
          title="Skip ${step} words (↓)"
          aria-label="Skip ${step} words"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"/>
          </svg>
        </button>

        <!-- Stop/Reset -->
        <button
          type="button"
          class="btn btn-ghost btn-md btn-circle min-h-[44px] min-w-[44px] touch-manipulation"
          @click=${() => {
						this.engine.stop();
					}}
          title="Restart (R)"
          aria-label="Restart from beginning"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>
          </svg>
        </button>

        <!-- Spacer -->
        <div class="flex-1"></div>

        <!-- WPM Controls (desktop only — mobile uses settings panel) -->
        <div class="hidden md:flex items-center gap-1 md:gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-sm min-h-[44px] min-w-[44px] touch-manipulation"
            @click=${() => this.emit("settings-change", { wpm: Math.max(100, wpm - 25) })}
          >−</button>
          <div class="flex flex-col items-center w-14 md:w-16">
            <span class="font-mono text-sm md:text-base font-medium leading-none">${wpm}</span>
            <span class="text-xs text-base-content/60 leading-none mt-0.5">WPM</span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm min-h-[44px] min-w-[44px] touch-manipulation"
            @click=${() => this.emit("settings-change", { wpm: Math.min(1600, wpm + 25) })}
          >+</button>
        </div>

        <!-- Time remaining -->
        ${
					remainingSeconds > 0 && remainingLabel
						? html`
          <span class="text-sm text-base-content/55 font-mono" title="${remainingSeconds} seconds">
            ${remainingLabel} left
          </span>
        `
						: ""
				}

      </div>
    `;
	}

	private renderShortcutsModal() {
		const shortcuts = [
			["Space", "Play / Pause"],
			["F", "Toggle focus mode (immersive while playing)"],
			["Tap", "Pause — with focus mode on, shows controls again"],
			["←  →", "Speed −/+ 25 WPM"],
			["↑  ↓", "Back / Forward 5 words"],
			["R", "Restart from beginning"],
			["Esc", "Back to home"],
			["?", "Toggle this overlay"],
		];
		return html`
      <div
        class="fixed inset-0 bg-base-content/50 z-50 flex items-center justify-center p-4"
        @click=${() => {
					this.showShortcuts = false;
				}}
        aria-hidden="true"
      >
        <div
          class="card bg-base-100 w-full max-w-sm shadow-xl"
          @click=${(e: Event) => e.stopPropagation()}
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <div class="card-body">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-medium text-base-content">Keyboard Shortcuts</h3>
              <button class="btn btn-ghost btn-xs btn-circle" aria-label="Close shortcuts" @click=${() => {
								this.showShortcuts = false;
							}}>
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="flex flex-col gap-2">
              ${shortcuts.map(
								([key, desc]) => html`
                <div class="flex items-center justify-between">
                  <span class="text-sm text-base-content/60">${desc}</span>
                  <kbd class="kbd kbd-sm font-mono">${key}</kbd>
                </div>
              `,
							)}
            </div>
          </div>
        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"rsvp-reader": RsvpReader;
	}
}
