import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ReaderSettings } from "../models/types.js";
import { audioService } from "../services/audio-service.js";
import { trackEvent } from "../utils/analytics.js";
import "./ui/dialog.js";

type Phase = "reading" | "break" | "longbreak";

interface TimerSessionState {
	phase: Phase;
	secondsLeft: number;
	pomodoroActive: boolean;
	completedSessions: number;
}

const SESSION_STORAGE_KEY = "speeedy:pomodoro-state";

@customElement("wellness-overlay")
export class WellnessOverlay extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Boolean }) playing = true;

	@property({ type: Object }) settings: Partial<ReaderSettings> = {};

	@state() private pomodoroActive = false;
	@state() private phase: Phase = "reading";
	@state() private secondsLeft = 0;
	@state() private completedSessions = 0;
	@state() private showConfig = false;
	@state() private showBreakOverlay = false;
	@state() private eyeRestVisible = false;

	private timerId: ReturnType<typeof setInterval> | null = null;
	private eyeRestFiredThisPhase = false;
	private breakOverlayTimer: ReturnType<typeof setTimeout> | null = null;
	private resumeCountdownTimer: ReturnType<typeof setTimeout> | null = null;

	private get readMinutes() {
		return this.settings.pomodoroReadMinutes ?? 25;
	}
	private get breakMinutes() {
		return this.settings.pomodoroBreakMinutes ?? 5;
	}
	private get longBreakMinutes() {
		return this.settings.pomodoroLongBreakMinutes ?? 20;
	}
	private get sessionsBeforeLongBreak() {
		return this.settings.pomodoroSessionsBeforeLongBreak ?? 4;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.restoreState();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.stopInterval();
		this.saveState();
		if (this.breakOverlayTimer) clearTimeout(this.breakOverlayTimer);
		if (this.resumeCountdownTimer) clearTimeout(this.resumeCountdownTimer);
	}

	override updated(changed: Map<string, unknown>): void {
		if (changed.has("playing") && this.pomodoroActive) {
			if (this.playing) {
				this.startInterval();
			} else {
				this.stopInterval();
			}
		}
	}

	private saveState(): void {
		if (!this.pomodoroActive) {
			sessionStorage.removeItem(SESSION_STORAGE_KEY);
			return;
		}
		const state: TimerSessionState = {
			phase: this.phase,
			secondsLeft: this.secondsLeft,
			pomodoroActive: this.pomodoroActive,
			completedSessions: this.completedSessions,
		};
		sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
	}

	private restoreState(): void {
		try {
			const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
			if (!raw) return;
			const state: TimerSessionState = JSON.parse(raw);
			if (!state.pomodoroActive || state.secondsLeft <= 0) return;
			this.pomodoroActive = true;
			this.phase = state.phase;
			this.secondsLeft = state.secondsLeft;
			this.completedSessions = state.completedSessions ?? 0;
			if (this.playing) this.startInterval();
		} catch {
			/* ignore corrupt state */
		}
	}

	private startInterval(): void {
		if (this.timerId) return;
		this.timerId = setInterval(() => this.tick(), 1000);
	}

	private stopInterval(): void {
		if (this.timerId) {
			clearInterval(this.timerId);
			this.timerId = null;
		}
	}

	private startTimer(): void {
		this.phase = "reading";
		this.secondsLeft = this.readMinutes * 60;
		this.completedSessions = 0;
		this.eyeRestFiredThisPhase = false;
		this.pomodoroActive = true;
		this.showBreakOverlay = false;
		if (this.playing) this.startInterval();
		this.saveState();
		trackEvent("pomodoro-started", {
			focus_minutes: this.readMinutes,
			break_minutes: this.breakMinutes,
		});
	}

	private stopTimer(): void {
		this.stopInterval();
		this.pomodoroActive = false;
		this.showBreakOverlay = false;
		this.eyeRestVisible = false;
		this.completedSessions = 0;
		sessionStorage.removeItem(SESSION_STORAGE_KEY);
	}

	private skipBreak(): void {
		this.showBreakOverlay = false;
		if (this.breakOverlayTimer) clearTimeout(this.breakOverlayTimer);
		if (this.resumeCountdownTimer) clearTimeout(this.resumeCountdownTimer);
		this.phase = "reading";
		this.secondsLeft = this.readMinutes * 60;
		this.eyeRestFiredThisPhase = false;
		this.saveState();
		this.dispatchEvent(
			new CustomEvent("pomodoro-resume", { bubbles: true, composed: true }),
		);
	}

	private extendBreak(): void {
		this.secondsLeft += 5 * 60;
		this.saveState();
	}

	private tick(): void {
		this.secondsLeft = Math.max(0, this.secondsLeft - 1);

		if (this.phase === "reading" && !this.eyeRestFiredThisPhase) {
			const elapsed = this.readMinutes * 60 - this.secondsLeft;
			if (elapsed >= 20 * 60 && this.readMinutes >= 20) {
				this.eyeRestFiredThisPhase = true;
				this.eyeRestVisible = true;
				setTimeout(() => {
					this.eyeRestVisible = false;
				}, 8000);
			}
		}

		if (this.secondsLeft <= 0) {
			this.onPhaseEnd();
		}

		if (this.secondsLeft % 10 === 0) this.saveState();
	}

	private onPhaseEnd(): void {
		this.stopInterval();

		if (this.phase === "reading") {
			this.completedSessions++;
			const isLongBreak =
				this.completedSessions % this.sessionsBeforeLongBreak === 0;
			this.phase = isLongBreak ? "longbreak" : "break";
			this.secondsLeft = isLongBreak
				? this.longBreakMinutes * 60
				: this.breakMinutes * 60;
			this.eyeRestFiredThisPhase = false;
			audioService.playChime(isLongBreak ? "longbreak" : "break");
			this.showBreakOverlay = true;
			this.dispatchEvent(
				new CustomEvent("pomodoro-break-start", {
					bubbles: true,
					composed: true,
				}),
			);
			if (this.playing) this.startInterval();
		} else {
			this.showBreakOverlay = false;
			this.phase = "reading";
			this.secondsLeft = this.readMinutes * 60;
			this.eyeRestFiredThisPhase = false;
			audioService.playChime("focus");
			this.saveState();
			this.dispatchEvent(
				new CustomEvent("pomodoro-resume", { bubbles: true, composed: true }),
			);
			if (this.playing) this.startInterval();
		}
		this.saveState();
	}

	private formatTime(s: number): string {
		const m = Math.floor(Math.abs(s) / 60);
		const sec = Math.abs(s) % 60;
		return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
	}

	private renderRing(pct: number, color: string) {
		const r = 8;
		const circ = 2 * Math.PI * r;
		const dash = (pct / 100) * circ;
		return html`
			<svg width="22" height="22" viewBox="0 0 22 22" class="shrink-0" aria-hidden="true">
				<circle cx="11" cy="11" r="${r}" fill="none" stroke="currentColor" stroke-width="2" class="opacity-15"/>
				<circle cx="11" cy="11" r="${r}" fill="none" stroke="${color}" stroke-width="2"
					stroke-dasharray="${dash} ${circ}"
					stroke-dashoffset="${circ / 4}"
					stroke-linecap="round"
					style="transition: stroke-dasharray 1s linear;"
				/>
			</svg>
		`;
	}

	override render() {
		const totalSeconds =
			this.phase === "reading"
				? this.readMinutes * 60
				: this.phase === "longbreak"
					? this.longBreakMinutes * 60
					: this.breakMinutes * 60;
		const pct =
			totalSeconds > 0
				? ((totalSeconds - this.secondsLeft) / totalSeconds) * 100
				: 0;

		const isBreak = this.phase === "break" || this.phase === "longbreak";
		const phaseColor = isBreak ? "oklch(var(--su))" : "oklch(var(--p))";
		const phaseLabel =
			this.phase === "longbreak" ? "Long break" : isBreak ? "Break" : "Focus";

		return html`
			<div class="flex items-center gap-2">

				${
					this.pomodoroActive
						? html`
					<!-- Active timer: ring + time + label + stop -->
					<div class="flex items-center gap-1.5 select-none">
						${this.renderRing(pct, phaseColor)}
						<div class="flex flex-col leading-none">
							<span class="font-mono text-xs font-medium tabular-nums" style="color: ${phaseColor}">
								${this.formatTime(this.secondsLeft)}
							</span>
							<span class="text-[9px] text-base-content/40 uppercase tracking-wide">${phaseLabel}</span>
						</div>
						${
							this.completedSessions > 0
								? html`<span class="text-[10px] text-base-content/35 font-mono tabular-nums">${this.completedSessions}/${this.sessionsBeforeLongBreak}</span>`
								: ""
						}
						<button
							class="btn btn-ghost btn-xs px-1 min-h-0 h-6 text-base-content/30 hover:text-error transition-colors"
							@click=${this.stopTimer}
							title="Stop timer"
							aria-label="Stop Pomodoro timer"
						>
							<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
							</svg>
						</button>
					</div>
				`
						: html`
					<!-- Inactive: subtle timer button -->
					<button
						class="btn btn-ghost btn-xs gap-1.5 text-base-content/35 hover:text-base-content/60 transition-colors"
						@click=${() => {
							this.showConfig = true;
						}}
						title="Start Pomodoro timer"
						aria-label="Open Pomodoro timer settings"
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
						</svg>
						<span class="hidden sm:inline text-xs">Timer</span>
					</button>
				`
				}
			</div>

			<!-- Config dialog using speeedy-dialog -->
			<speeedy-dialog
				?open=${this.showConfig}
				@speeedy-dialog-close=${() => {
					this.showConfig = false;
				}}
			>
				<div class="bg-base-100 rounded-2xl shadow-2xl border border-base-200/60 w-80 overflow-hidden">
					<!-- Header -->
					<div class="flex items-center justify-between px-5 py-4 border-b border-base-200/60">
						<div class="flex items-center gap-2.5">
							<div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
								<svg class="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
								</svg>
							</div>
							<h3 class="font-semibold text-sm text-base-content">Pomodoro Timer</h3>
						</div>
						<button
							class="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-base-content"
							@click=${() => {
								this.showConfig = false;
							}}
							aria-label="Close"
						>
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
							</svg>
						</button>
					</div>

					<!-- Body -->
					<div class="px-5 py-4 flex flex-col gap-4">
						<!-- Timer grid -->
						<div class="grid grid-cols-2 gap-3">
							<label class="flex flex-col gap-1.5">
								<span class="text-xs font-medium text-base-content/50 uppercase tracking-wide">Focus</span>
								<div class="relative">
									<input
										type="number" min="5" max="120"
										class="input input-bordered input-sm w-full text-center font-mono pr-8"
										.value=${String(this.readMinutes)}
										@change=${(e: Event) => {
											const v = Math.max(
												5,
												Math.min(
													120,
													Number((e.target as HTMLInputElement).value),
												),
											);
											this.dispatchEvent(
												new CustomEvent("settings-change", {
													detail: { pomodoroReadMinutes: v },
													bubbles: true,
													composed: true,
												}),
											);
										}}
									/>
									<span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-base-content/30 pointer-events-none font-mono">min</span>
								</div>
							</label>
							<label class="flex flex-col gap-1.5">
								<span class="text-xs font-medium text-base-content/50 uppercase tracking-wide">Break</span>
								<div class="relative">
									<input
										type="number" min="1" max="60"
										class="input input-bordered input-sm w-full text-center font-mono pr-8"
										.value=${String(this.breakMinutes)}
										@change=${(e: Event) => {
											const v = Math.max(
												1,
												Math.min(
													60,
													Number((e.target as HTMLInputElement).value),
												),
											);
											this.dispatchEvent(
												new CustomEvent("settings-change", {
													detail: { pomodoroBreakMinutes: v },
													bubbles: true,
													composed: true,
												}),
											);
										}}
									/>
									<span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-base-content/30 pointer-events-none font-mono">min</span>
								</div>
							</label>
							<label class="flex flex-col gap-1.5">
								<span class="text-xs font-medium text-base-content/50 uppercase tracking-wide">Long break</span>
								<div class="relative">
									<input
										type="number" min="5" max="60"
										class="input input-bordered input-sm w-full text-center font-mono pr-8"
										.value=${String(this.longBreakMinutes)}
										@change=${(e: Event) => {
											const v = Math.max(
												5,
												Math.min(
													60,
													Number((e.target as HTMLInputElement).value),
												),
											);
											this.dispatchEvent(
												new CustomEvent("settings-change", {
													detail: { pomodoroLongBreakMinutes: v },
													bubbles: true,
													composed: true,
												}),
											);
										}}
									/>
									<span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-base-content/30 pointer-events-none font-mono">min</span>
								</div>
							</label>
							<label class="flex flex-col gap-1.5">
								<span class="text-xs font-medium text-base-content/50 uppercase tracking-wide">Sessions</span>
								<div class="relative">
									<input
										type="number" min="2" max="8"
										class="input input-bordered input-sm w-full text-center font-mono pr-8"
										.value=${String(this.sessionsBeforeLongBreak)}
										@change=${(e: Event) => {
											const v = Math.max(
												2,
												Math.min(
													8,
													Number((e.target as HTMLInputElement).value),
												),
											);
											this.dispatchEvent(
												new CustomEvent("settings-change", {
													detail: { pomodoroSessionsBeforeLongBreak: v },
													bubbles: true,
													composed: true,
												}),
											);
										}}
									/>
									<span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-base-content/30 pointer-events-none font-mono">×LB</span>
								</div>
							</label>
						</div>

						${
							this.readMinutes < 20
								? html`
							<p class="text-xs text-base-content/40 leading-relaxed bg-base-200/50 rounded-lg px-3 py-2">
								Set focus to 20+ min to enable the 20-20-20 eye rest reminder.
							</p>
						`
								: ""
						}

						<!-- Actions -->
						<div class="flex gap-2 pt-1">
							<button
								class="btn btn-ghost btn-sm flex-1"
								@click=${() => {
									this.showConfig = false;
								}}
							>Cancel</button>
							<button
								class="btn btn-primary btn-sm flex-1"
								@click=${() => {
									this.showConfig = false;
									this.startTimer();
								}}
							>
								<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
								</svg>
								Start
							</button>
						</div>
					</div>
				</div>
			</speeedy-dialog>

			<!-- Break overlay — shown when a break starts -->
			${
				this.showBreakOverlay
					? html`
				<div class="fixed inset-0 z-40 flex items-center justify-center bg-base-100/95 backdrop-blur-sm">
					<div class="flex flex-col items-center gap-6 max-w-sm text-center px-6">
						<div class="text-6xl">${this.phase === "longbreak" ? "🌿" : "☕"}</div>
						<div>
							<h2 class="text-2xl font-bold text-base-content mb-1">
								${this.phase === "longbreak" ? "Long Break!" : "Break Time!"}
							</h2>
							<p class="text-base-content/60 text-sm">
								${
									this.phase === "longbreak"
										? `Session ${this.completedSessions} done. Take ${this.longBreakMinutes} minutes to fully recharge.`
										: `Great focus session! Rest for ${this.breakMinutes} minutes.`
								}
							</p>
						</div>

						<!-- Break countdown ring -->
						<div class="relative flex items-center justify-center">
							<svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
								<circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" stroke-width="4" class="opacity-10"/>
								${(() => {
									const total =
										(this.phase === "longbreak"
											? this.longBreakMinutes
											: this.breakMinutes) * 60;
									const r = 40;
									const circ = 2 * Math.PI * r;
									const elapsed = total - this.secondsLeft;
									const dash = (elapsed / total) * circ;
									return html`
										<circle cx="48" cy="48" r="40" fill="none"
											stroke="oklch(var(--su))" stroke-width="4"
											stroke-dasharray="${dash} ${circ}"
											stroke-dashoffset="${circ / 4}"
											stroke-linecap="round"
											style="transition: stroke-dasharray 1s linear;"
										/>
									`;
								})()}
							</svg>
							<div class="absolute flex flex-col items-center">
								<span class="font-mono text-2xl font-bold text-base-content">${this.formatTime(this.secondsLeft)}</span>
								<span class="text-xs text-base-content/40 uppercase tracking-wide">remaining</span>
							</div>
						</div>

						<div class="flex gap-3">
							<button
								class="btn btn-ghost btn-sm"
								@click=${this.extendBreak}
								title="Add 5 more minutes"
							>+5 min</button>
							<button
								class="btn btn-primary btn-sm"
								@click=${this.skipBreak}
							>Skip Break</button>
						</div>

						${
							this.completedSessions > 0
								? html`
							<div class="flex gap-1 items-center">
								${Array.from(
									{ length: this.sessionsBeforeLongBreak },
									(_, i) => html`
									<div class="w-2.5 h-2.5 rounded-full ${i < this.completedSessions % this.sessionsBeforeLongBreak || (this.completedSessions % this.sessionsBeforeLongBreak === 0 && i < this.sessionsBeforeLongBreak) ? "bg-primary" : "bg-base-300"}"></div>
								`,
								)}
							</div>
							<p class="text-xs text-base-content/40 -mt-3">
								${this.completedSessions} session${this.completedSessions !== 1 ? "s" : ""} completed
							</p>
						`
								: ""
						}
					</div>
				</div>
			`
					: ""
			}

			<!-- 20-20-20 eye rest toast -->
			${
				this.eyeRestVisible
					? html`
				<div class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
					<div class="alert shadow-lg max-w-xs border border-base-200 bg-base-100/95 backdrop-blur-sm">
						<span class="text-lg">👁</span>
						<div>
							<div class="font-medium text-sm">Eye Rest Reminder</div>
							<div class="text-xs text-base-content/60">Look 20 feet away for 20 seconds.</div>
						</div>
					</div>
				</div>
			`
					: ""
			}
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"wellness-overlay": WellnessOverlay;
	}
}
