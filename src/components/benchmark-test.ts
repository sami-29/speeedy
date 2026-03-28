import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BenchmarkPassage } from "../data/benchmark-passages.js";
import { pickPassage } from "../data/benchmark-passages.js";
import type { UserProfile } from "../models/types.js";
import { saveProfile } from "../services/storage-service.js";
import {
	comprehensionBracket,
	trackEvent,
	wpmBracket,
} from "../utils/analytics.js";
import { emitProfileUpdated, navigate } from "../utils/events.js";
import "./ui/page-nav.js";

type Phase = "intro" | "reading" | "quiz" | "results";

@customElement("benchmark-test")
export class BenchmarkTest extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) profile!: UserProfile;

	@state() private phase: Phase = "intro";
	@state() private passage: BenchmarkPassage = pickPassage();
	@state() private readingStartTime = 0;
	@state() private answers: (number | null)[] = [];
	@state() private resultWpm = 0;
	@state() private resultComprehension = 0;

	private startReading() {
		this.answers = Array(this.passage.questions.length).fill(null);
		this.phase = "reading";
		this.readingStartTime = 0;
	}

	private beginTimer() {
		this.readingStartTime = Date.now();
	}

	private finishReading() {
		const elapsedMs = Date.now() - this.readingStartTime;
		const elapsedMinutes = elapsedMs / 60_000;
		this.resultWpm = Math.round(
			this.passage.wordCount / Math.max(elapsedMinutes, 0.1),
		);
		this.phase = "quiz";
	}

	private setAnswer(qIdx: number, aIdx: number) {
		this.answers = this.answers.map((a, i) => (i === qIdx ? aIdx : a));
	}

	private submitQuiz() {
		const correct = this.answers.filter(
			(a, i) => a === this.passage.questions[i].correct,
		).length;
		this.resultComprehension = Math.round(
			(correct / this.passage.questions.length) * 100,
		);
		this.phase = "results";
		this.saveResults();
		trackEvent("benchmark-completed", {
			wpm_bracket: wpmBracket(this.resultWpm),
			comprehension_bracket: comprehensionBracket(this.resultComprehension),
		});
	}

	private reset() {
		this.passage = pickPassage(this.passage.id);
		this.phase = "intro";
		this.readingStartTime = 0;
		this.answers = [];
		this.resultWpm = 0;
		this.resultComprehension = 0;
	}

	private saveResults() {
		const updated: UserProfile = {
			...this.profile,
			baselineWpm: this.resultWpm,
			baselineComprehension: this.resultComprehension,
			settings: { ...this.profile.settings, wpm: this.resultWpm },
		};
		saveProfile(updated);
		emitProfileUpdated(updated);
	}

	override render() {
		switch (this.phase) {
			case "intro":
				return this.renderIntro();
			case "reading":
				return this.renderReading();
			case "quiz":
				return this.renderQuiz();
			case "results":
				return this.renderResults();
		}
	}

	private renderIntro() {
		return html`
      <div class="min-h-screen bg-base-100 flex flex-col">
        <speeedy-page-nav label="Reading Baseline Test" back-href="#/"></speeedy-page-nav>

        <main class="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div class="max-w-md w-full flex flex-col gap-8">
            <div>
              <h1 class="text-3xl font-light text-base-content mb-3">Find your reading speed</h1>
              <p class="text-ui-muted text-sm font-light leading-relaxed">
                You'll read a short passage at your own pace.
                Press <strong class="font-medium text-base-content">Start</strong> when you're ready to begin,
                and <strong class="font-medium text-base-content">Done</strong> when you finish.
                Then answer 10 questions about what you read.
              </p>
            </div>

            <div class="grid grid-cols-3 gap-3">
              ${this.chip(`${this.passage.wordCount} words`, "passage length")}
              ${this.chip("Your pace", "no time pressure")}
              ${this.chip("10 Qs", "comprehension quiz")}
            </div>

            <p class="text-xs text-ui-muted-subtle -mt-2">Passage: <span class="text-ui-muted">${this.passage.title}</span></p>

            <button class="btn btn-primary btn-lg rounded-full w-full" data-umami-event="benchmark-start" @click=${this.startReading}>
              Start reading
            </button>
          </div>
        </main>
      </div>
    `;
	}

	private chip(value: string, label: string) {
		return html`
      <div class="rounded-xl border border-base-200 py-4 text-center">
        <div class="text-sm font-light text-base-content">${value}</div>
        <div class="text-xs text-ui-muted mt-0.5">${label}</div>
      </div>
    `;
	}

	private renderReading() {
		const started = this.readingStartTime > 0;
		return html`
      <div class="min-h-screen bg-base-100 flex flex-col">
        <div class="shrink-0 px-6 py-3 border-b border-base-200 flex items-center justify-between">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/8 text-primary text-xs font-medium tracking-wide">
            Reading Test
          </span>
          <span class="text-xs text-ui-muted">${this.passage.wordCount} words · ${this.passage.title}</span>
        </div>

        <main class="flex-1 max-w-2xl mx-auto w-full px-6 py-6">

          ${
						!started
							? html`
            <div class="flex flex-col items-center gap-2 mb-8">
              <button class="btn btn-primary btn-lg rounded-full px-14" @click=${this.beginTimer}>
                Start reading
              </button>
              <p class="text-xs text-ui-muted">The timer begins when you press this</p>
            </div>
          `
							: ""
					}

          <div class="prose prose-sm max-w-none leading-[1.95] text-base-content font-light text-[1.05rem] whitespace-pre-line select-none">
            ${this.passage.text}
          </div>

          ${
						started
							? html`
            <div class="flex flex-col items-center gap-2 mt-10 pb-8">
              <button class="btn btn-primary btn-lg rounded-full px-14" @click=${this.finishReading}>
                Done reading
              </button>
              <p class="text-xs text-ui-muted">The quiz starts next — 10 short questions</p>
            </div>
          `
							: ""
					}

        </main>
      </div>
    `;
	}

	private renderQuiz() {
		const answered = this.answers.filter((a) => a !== null).length;
		return html`
      <div class="min-h-screen bg-base-100 flex flex-col">
        <div class="shrink-0 px-6 py-3 border-b border-base-200 flex items-center justify-between">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning/10 text-warning text-xs font-medium tracking-wide">
            Comprehension Quiz
          </span>
          <span class="text-xs text-ui-muted font-mono">${answered} / ${this.passage.questions.length}</span>
        </div>

        <main class="flex-1 max-w-xl mx-auto w-full px-6 py-10 flex flex-col gap-10">
          ${this.passage.questions.map((q, qi) => this.renderQuestion(q, qi))}

          <div class="pb-16">
            <button
              class="btn btn-primary btn-lg w-full rounded-xl"
              data-umami-event="benchmark-submit"
              ?disabled=${this.answers.some((a) => a === null)}
              @click=${this.submitQuiz}
            >
              Submit answers
            </button>
            ${
							answered < this.passage.questions.length
								? html`
              <p class="text-xs text-center text-ui-muted mt-3">
                ${this.passage.questions.length - answered} question${this.passage.questions.length - answered > 1 ? "s" : ""} left
              </p>
            `
								: ""
						}
          </div>
        </main>
      </div>
    `;
	}

	private renderQuestion(
		q: { q: string; options: string[]; correct: number },
		qi: number,
	) {
		return html`
      <div class="flex flex-col gap-3">
        <p class="text-sm font-medium text-base-content leading-snug">
          <span class="text-ui-muted mr-2 font-mono">${qi + 1}.</span>${q.q}
        </p>
        <div class="flex flex-col gap-2">
          ${q.options.map((opt, oi) => {
						const selected = this.answers[qi] === oi;
						return html`
              <button
                class="text-left px-4 py-3 rounded-xl border text-sm transition-all
                  ${
										selected
											? "border-primary bg-primary/8 text-base-content font-medium"
											: "border-base-200 text-base-content hover:border-base-content/40"
									}"
                @click=${() => this.setAnswer(qi, oi)}
              >
                <span class="text-ui-muted font-mono text-xs mr-2">${String.fromCharCode(65 + oi)}.</span>${opt}
              </button>
            `;
					})}
        </div>
      </div>
    `;
	}

	private renderResults() {
		const correct = this.answers.filter(
			(a, i) => a === this.passage.questions[i].correct,
		).length;
		const wpmLabel =
			this.resultWpm < 200
				? "below average"
				: this.resultWpm < 300
					? "average"
					: this.resultWpm < 450
						? "above average"
						: "excellent";
		const comprLabel =
			this.resultComprehension < 50
				? "needs work"
				: this.resultComprehension < 70
					? "fair"
					: this.resultComprehension < 90
						? "good"
						: "excellent";

		return html`
      <div class="min-h-screen bg-base-100 flex flex-col">
        <nav class="px-6 py-4 border-b border-base-200 flex items-center justify-between">
          <span class="text-xs tracking-[0.4em] uppercase text-ui-muted">Your Results</span>
        </nav>

        <main class="flex-1 max-w-lg mx-auto w-full px-6 py-12 flex flex-col gap-10">

          <div class="grid grid-cols-2 gap-4">
            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-6 text-center">
              <div class="text-4xl font-light text-base-content mb-1">${this.resultWpm}</div>
              <div class="text-xs text-ui-muted-subtle mb-2">WPM</div>
              <span class="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">${wpmLabel}</span>
            </div>
            <div class="rounded-2xl border border-base-200 bg-base-200/30 p-6 text-center">
              <div class="text-4xl font-light text-base-content mb-1">${this.resultComprehension}%</div>
              <div class="text-xs text-ui-muted-subtle mb-2">Comprehension</div>
              <span class="inline-block px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-xs">${comprLabel}</span>
            </div>
          </div>

          <div class="rounded-xl border border-base-200 p-5 flex flex-col gap-3">
            <p class="text-xs uppercase tracking-widest text-ui-muted">How you compare</p>
            <div class="flex items-center justify-between text-sm">
              <span class="text-ui-muted font-light">Average adult</span>
              <span class="font-mono text-base-content">238 WPM</span>
            </div>
            <div class="flex items-center justify-between text-sm border-t border-base-200 pt-3">
              <span class="text-base-content font-medium">Your baseline</span>
              <span class="font-mono text-base-content font-semibold">${this.resultWpm} WPM</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-ui-muted font-light">RSVP-trained ceiling</span>
              <span class="font-mono text-base-content">600+ WPM</span>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <p class="text-xs uppercase tracking-widest text-ui-muted">${correct} / ${this.passage.questions.length} correct</p>
            <div class="flex gap-1.5 flex-wrap">
              ${this.passage.questions.map((_, qi) => {
								const ok =
									this.answers[qi] === this.passage.questions[qi].correct;
								return html`
                  <span class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono
                    ${ok ? "bg-success/15 text-success" : "bg-error/15 text-error"}">
                    ${qi + 1}
                  </span>`;
							})}
            </div>
          </div>

          <p class="text-xs text-ui-muted font-light leading-relaxed">
            Your baseline WPM has been saved to your profile and set as your starting speed in the app.
          </p>

          <div class="flex flex-col gap-3 pb-8">
            <a href="#/app" class="btn btn-primary btn-lg rounded-xl">Start reading →</a>
            <div class="flex gap-3">
              <button class="btn btn-ghost btn-sm flex-1" @click=${() => navigate("profile")}>View profile</button>
              <button class="btn btn-ghost btn-sm flex-1" @click=${this.reset}>Retest (new passage)</button>
            </div>
          </div>

        </main>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"benchmark-test": BenchmarkTest;
	}
}
