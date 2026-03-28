import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { animate } from "motion";

const WORDS = ["The", "quick", "brown", "fox", "jumps", "over"];
const STOPS = [3, 17, 33, 50, 66, 82];
const FIXATION_MS = 220;
const SACCADE_MS = 60;
const RESTART_PAUSE_MS = 900;

@customElement("learn-saccade-demo")
export class LearnSaccadeDemo extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@state() private activeWord = -1;

	private _eyeEl: HTMLElement | null = null;
	private _raf: ReturnType<typeof setTimeout> | null = null;
	private _running = false;

	override connectedCallback(): void {
		super.connectedCallback();
		requestAnimationFrame(() => this._startLoop());
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this._running = false;
		if (this._raf) clearTimeout(this._raf);
	}

	private _startLoop(): void {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		this._eyeEl = this.querySelector<HTMLElement>("[data-saccade-eye]");
		if (!this._eyeEl) return;
		this._running = true;
		this._runStep(0);
	}

	private _runStep(stopIdx: number): void {
		if (!this._running || !this._eyeEl) return;
		const eye = this._eyeEl;
		const container = eye.parentElement;
		if (!container) return;

		const containerW = container.getBoundingClientRect().width;
		const targetLeft = (STOPS[stopIdx] / 100) * containerW;

		this.activeWord = stopIdx;

		animate(
			eye,
			{ left: [`${targetLeft}px`] },
			{ duration: SACCADE_MS / 1000, ease: [0.16, 1, 0.3, 1] },
		);

		animate(
			eye,
			{ scale: [1.4, 1], opacity: [0.6, 1] },
			{ duration: 0.18, ease: [0.25, 1, 0.5, 1] },
		);

		const isLast = stopIdx === STOPS.length - 1;
		const delay = isLast ? FIXATION_MS + RESTART_PAUSE_MS : FIXATION_MS;

		this._raf = setTimeout(() => {
			if (!this._running) return;
			if (isLast) {
				this.activeWord = -1;
				if (this._eyeEl) {
					const cw =
						this._eyeEl.parentElement?.getBoundingClientRect().width ?? 0;
					animate(
						this._eyeEl,
						{ left: [`${(STOPS[0] / 100) * cw}px`], opacity: [0, 1] },
						{ duration: 0.12, ease: [0.16, 1, 0.3, 1] },
					);
				}
				this._raf = setTimeout(() => this._runStep(0), 150);
			} else {
				this._runStep(stopIdx + 1);
			}
		}, delay);
	}

	override render() {
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;

		return html`
      <div class="rounded-2xl border border-base-300/50 bg-base-200/30 overflow-hidden mb-4">
        <div class="px-6 pt-6 pb-2">
          <p class="text-[0.6rem] tracking-[0.4em] uppercase text-ui-muted font-medium mb-5">Saccadic reading — your eye jumps</p>

          <div class="relative mb-2" style="height: 4rem;">
            <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center"
              style="font-family: 'JetBrains Mono', monospace; font-size: clamp(0.8rem, 2.2vw, 1rem);">
              ${WORDS.map(
								(w, i) => html`
                <span
                  class="transition-all duration-150 font-light"
                  style="
                    flex: 1;
                    text-align: center;
                    color: ${this.activeWord === i ? "oklch(var(--bc))" : "oklch(var(--bc) / 0.55)"};
                    font-weight: ${this.activeWord === i ? "500" : "300"};
                    text-shadow: ${this.activeWord === i ? "0 0 8px oklch(var(--p) / 0.3)" : "none"};
                  "
                >${w}</span>
              `,
							)}
            </div>

            ${
							!reduced
								? html`
              <div data-saccade-eye
                class="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                style="
                  width: 12px; height: 12px;
                  border-radius: 50%;
                  background: #e63946;
                  box-shadow: 0 0 0 4px rgba(230,57,70,0.15), 0 0 12px rgba(230,57,70,0.3);
                  left: ${STOPS[0]}%;
                  transform: translateY(-50%);
                ">
              </div>
            `
								: html`
              <div class="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                style="width: 12px; height: 12px; border-radius: 50%; background: #e63946; left: ${STOPS[2]}%; box-shadow: 0 0 0 4px rgba(230,57,70,0.15);">
              </div>
            `
						}
          </div>

          <div class="relative mb-4" style="height: 1.5rem;">
            <svg class="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
              ${STOPS.slice(0, -1).map(
								(x, i) => html`
                <line
                  x1="${x + 1}%" y1="40%"
                  x2="${STOPS[i + 1]}%" y2="40%"
                  stroke="rgba(230,57,70,0.2)"
                  stroke-width="1"
                  stroke-dasharray="4 4"
                />
              `,
							)}
              ${STOPS.map(
								(x, i) => html`
                <circle
                  cx="${x + 1}%" cy="40%" r="3"
                  fill="${this.activeWord === i ? "rgba(230,57,70,0.6)" : "oklch(var(--bc) / 0.15)"}"
                  style="transition: fill 0.15s ease;"
                />
              `,
							)}
            </svg>
          </div>
        </div>

        <div class="border-t border-base-300/40 px-6 py-4 bg-base-100/40">
          <p class="text-xs text-ui-muted font-light leading-relaxed">
            Each dot is a <em>fixation</em> — ~200ms. The jumps between them are <em>saccades</em> — you read nothing during them.
          </p>
        </div>
      </div>

      <div class="rounded-2xl border border-primary/20 bg-primary/5 overflow-hidden mb-4">
        <div class="px-6 pt-6 pb-2">
          <p class="text-[0.6rem] tracking-[0.4em] uppercase text-base-content font-medium mb-5">RSVP — your eye stays still</p>
          <div class="flex items-center justify-center min-h-14">
            <div class="flex items-center gap-4"
              style="font-family: 'JetBrains Mono', monospace; font-size: clamp(1.2rem, 3.5vw, 1.6rem);">
              <span class="text-ui-muted font-light">qu</span>
              <span style="color: #e63946; font-weight: 700; text-shadow: 0 0 16px rgba(230,57,70,0.45);">i</span>
              <span class="text-ui-muted font-light">ck</span>
            </div>
          </div>
          <p class="text-center text-[0.6rem] text-ui-muted mb-4 tracking-wider">one word · fixed point · no movement</p>
        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"learn-saccade-demo": LearnSaccadeDemo;
	}
}
