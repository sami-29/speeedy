import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ORP_DEMO_WORDS } from "../data/orp-demo-words.js";

const PIVOT_COLOR = "#e63946";
const PIVOT_GLOW = "0 0 12px rgba(230,57,70,0.35)";
const PIVOT_GLOW_LG = "0 0 20px rgba(230,57,70,0.45)";
const MUTED_WORD =
	"color-mix(in oklab, var(--color-base-content) 65%, transparent)";

@customElement("speeedy-orp-demo")
export class SpeeedyOrpDemo extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) tone: "accent" | "surface" = "surface";

	@property({ type: String }) hint = "hover any word";

	@state() private hovered = -1;

	override render() {
		const frame =
			this.tone === "accent"
				? "rounded-2xl border border-primary/20 bg-primary/[0.04] px-6 py-8 flex flex-col items-center gap-5 shadow-[0_0_40px_color-mix(in_oklab,var(--color-primary)_10%,transparent)]"
				: "border border-base-300/60 rounded-2xl px-6 py-8 flex flex-col items-center gap-5 w-full";

		const hintClass =
			this.tone === "accent"
				? "text-ui-body tracking-[0.3em] uppercase font-semibold text-primary/80"
				: "text-ui-body tracking-[0.3em] uppercase font-semibold text-ui-muted";

		return html`
      <div class=${frame}>
        <p class=${hintClass}>${this.hint}</p>

        <div class="flex flex-wrap justify-center gap-x-2 gap-y-1 font-mono text-ui-title">
          ${ORP_DEMO_WORDS.map(
						([word], i) => html`
              <span
                class="cursor-default select-none rounded px-0.5 transition-all duration-150"
                style="color: ${this.hovered === i ? PIVOT_COLOR : MUTED_WORD}; font-weight: ${this.hovered === i ? "600" : "400"}; text-shadow: ${this.hovered === i ? PIVOT_GLOW : "none"};"
                @mouseenter=${() => {
									this.hovered = i;
								}}
                @mouseleave=${() => {
									this.hovered = -1;
								}}
              >${word}</span>
            `,
					)}
        </div>

        <div class="relative flex flex-col items-center justify-center w-full" style="height: 7rem;">
          <p
            class="absolute inset-0 flex items-center justify-center text-ui-body text-ui-muted-subtle transition-opacity duration-200 pointer-events-none select-none"
            style="opacity: ${this.hovered >= 0 ? "0" : "1"};"
          >
            ← hover a word above
          </p>

          <div
            class="absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-200"
            style="opacity: ${this.hovered >= 0 ? "1" : "0"};"
          >
            <div
              class="grid select-none font-mono text-ui-hero font-semibold leading-none w-[14ch]"
              style="grid-template-columns: 1fr auto 1fr;"
            >
              <span class="text-right text-ui-muted-subtle font-normal"
                >${this.hovered >= 0 ? ORP_DEMO_WORDS[this.hovered][1] : ""}</span
              >
              <span
                style="color: ${PIVOT_COLOR}; font-weight: 700; text-shadow: ${PIVOT_GLOW_LG};"
                >${this.hovered >= 0 ? ORP_DEMO_WORDS[this.hovered][2] : ""}</span
              >
              <span class="text-left text-ui-muted-subtle font-normal"
                >${this.hovered >= 0 ? ORP_DEMO_WORDS[this.hovered][3] : ""}</span
              >
            </div>
            <div class="grid mt-2" style="grid-template-columns: 1fr auto 1fr; width: 14ch;">
              <span></span>
              <span class="flex flex-col items-center gap-0.5">
                <span class="w-px h-3 rounded-full" style="background: rgba(230,57,70,0.4);"></span>
                <span class="text-ui-body whitespace-nowrap font-normal tracking-wider text-primary/80">ORP</span>
              </span>
              <span></span>
            </div>
          </div>
        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-orp-demo": SpeeedyOrpDemo;
	}
}
