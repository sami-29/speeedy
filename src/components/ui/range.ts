import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import "./info-tip.js";

/**
 * <speeedy-range label="Speed" min="100" max="1600" step="25" .value=${wpm} unit="WPM" tip="..." @change=${handler}>
 *
 * A labeled range slider with min/max labels, current value display, and optional inline tooltip.
 * Emits 'change' with detail: { value: number }.
 */
@customElement("speeedy-range")
export class SpeeedyRange extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) label = "";
	@property({ type: Number }) min = 0;
	@property({ type: Number }) max = 100;
	@property({ type: Number }) step = 1;
	@property({ type: Number }) value = 0;
	/** Suffix appended to the displayed value (e.g. "WPM", "px", "em", "×") */
	@property({ type: String }) unit = "";
	/** Optional min label override (defaults to `min + unit`) */
	@property({ type: String, attribute: "min-label" }) minLabel = "";
	/** Optional max label override (defaults to `max + unit`) */
	@property({ type: String, attribute: "max-label" }) maxLabel = "";
	/** "primary" | "secondary" */
	@property({ type: String }) color: "primary" | "secondary" = "primary";
	/** Custom display formatter — if provided, overrides the default value+unit display */
	@property({ attribute: false }) format?: (v: number) => string;
	/** Tooltip text — when set, renders an inline info-tip icon next to the label. */
	@property({ type: String }) tip = "";

	private readonly _uid = Math.random().toString(36).slice(2, 9);
	private get rangeId(): string {
		return `speeedy-range-${this._uid}`;
	}

	private get displayValue(): string {
		if (this.format) return this.format(this.value);
		return `${this.value}${this.unit}`;
	}

	private handleInput(e: InputEvent) {
		const val = Number((e.target as HTMLInputElement).value);
		this.value = val;
		this.dispatchEvent(
			new CustomEvent("change", {
				detail: { value: val },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render() {
		const minLbl = this.minLabel || `${this.min}${this.unit}`;
		const maxLbl = this.maxLabel || `${this.max}${this.unit}`;

		return html`
      <div>
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <label
              class="label-text text-xs uppercase tracking-widest text-ui-muted cursor-pointer"
              for=${this.rangeId}
            >${this.label}</label>
            ${this.tip ? html`<speeedy-info-tip tip=${this.tip}></speeedy-info-tip>` : ""}
          </div>
          <span class="font-mono text-sm font-medium text-base-content" aria-hidden="true">${this.displayValue}</span>
        </div>
        <input
          id=${this.rangeId}
          type="range"
          min=${this.min}
          max=${this.max}
          step=${this.step}
          .value=${String(this.value)}
          @input=${this.handleInput}
          class="range range-${this.color} range-xs w-full"
        />
        <div class="flex justify-between text-xs text-ui-muted-subtle mt-1">
          <span>${minLbl}</span><span>${maxLbl}</span>
        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-range": SpeeedyRange;
	}
}
