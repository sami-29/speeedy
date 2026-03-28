import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { OrpResult } from "../models/types.js";
import { DEFAULT_SETTINGS } from "../services/defaults.js";
import { RSVPEngine } from "../services/rsvp-engine.js";

const DEMO_TEXT =
	"Words appear one at a time. Your eyes stay still. No distractions. Just reading at light speed.";

const STATIC_WORD = { before: "ree", pivot: "a", after: "d" };

@customElement("hero-rsvp-demo")
export class HeroRsvpDemo extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	static styles = css`
		:host {
			display: block;
		}
	`;

	@state() private engine = new RSVPEngine();
	@state() private currentWord = "";
	@state() private currentOrp: OrpResult | null = null;
	@state() private isPaused = false;

	private get prefersReducedMotion(): boolean {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	private readonly settings = {
		...DEFAULT_SETTINGS,
		wpm: 320,
		showOrpGuides: true,
	};

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.prefersReducedMotion) {
			this.currentOrp = STATIC_WORD as OrpResult;
			this.isPaused = true;
			return;
		}
		this.engine.load(DEMO_TEXT, this.settings);
		this.engine.on("word", (s) => {
			this.currentWord = s.currentTokens.map((t) => t.text).join(" ");
			this.currentOrp = s.currentOrp;
		});
		this.engine.on("complete", () => {
			this.engine.stop();
			setTimeout(() => this.engine.play(this.settings), 800);
		});
		this.engine.play(this.settings);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.engine.stop();
	}

	private togglePause(): void {
		if (this.isPaused) {
			this.engine.play(this.settings);
			this.isPaused = false;
		} else {
			this.engine.stop();
			this.isPaused = true;
		}
	}

	override render() {
		const orp = this.currentOrp;
		const color = DEFAULT_SETTINGS.highlightColor;
		const guides = true;

		return html`
			<div
				role="img"
				aria-label="Live RSVP demo — words shown one at a time at the pivot point"
				class="reading-box flex flex-col items-center justify-center min-h-[120px] py-4"
				style="font-size: clamp(1.5rem, 4vw, 2.5rem); font-family: 'JetBrains Mono', monospace; line-height: 1;"
			>
				${
					orp
						? html`
							<div class="orp-container">
								<span class="orp-before text-base-content/70">${orp.before}</span>
								<span class="orp-pivot-col">
									${guides ? html`<span class="orp-guide" style="color:${color}"></span>` : ""}
									<span style="color:${color}; font-weight:700; line-height:1">${orp.pivot}</span>
									${guides ? html`<span class="orp-guide" style="color:${color}"></span>` : ""}
								</span>
								<span class="orp-after text-base-content/70">${orp.after}</span>
							</div>
						`
						: html`<span class="text-base-content/70">${this.currentWord || "…"}</span>`
				}
			</div>
			<div class="flex items-center justify-center gap-3 mt-2">
				<p class="text-xs text-base-content/45">Try it! paste your own text in the app</p>
				${
					!this.prefersReducedMotion
						? html`
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-base-content/70"
						aria-label=${this.isPaused ? "Play demo" : "Pause demo"}
						@click=${this.togglePause}
					>
						${
							this.isPaused
								? html`<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`
								: html`<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
						}
					</button>
				`
						: ""
				}
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"hero-rsvp-demo": HeroRsvpDemo;
	}
}
