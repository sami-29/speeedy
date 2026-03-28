import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

export interface SegmentedOption {
	value: string;
	label: string;
	/** Optional inline style string for colored options (e.g. Irlen tints) */
	style?: string;
}

/**
 * <speeedy-segmented
 *   .options=${[{value:"light",label:"☀️ Light"},{value:"dark",label:"🌙 Dark"}]}
 *   .value=${"light"}
 *   @change=${(e) => handler(e.detail.value)}
 * ></speeedy-segmented>
 *
 * A segmented button group / option picker.
 * Supports keyboard navigation (ArrowLeft/ArrowRight).
 * Emits 'change' with detail: { value: string }.
 */
@customElement("speeedy-segmented")
export class SpeeedySegmented extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ attribute: false }) options: SegmentedOption[] = [];
	@property({ type: String }) value = "";
	/** "buttons" (default) | "tabs" */
	@property({ type: String }) variant: "buttons" | "tabs" = "buttons";
	/** Accessible name for the button group (e.g. "Theme") */
	@property({ type: String, attribute: "group-label" }) groupLabel = "";

	private select(val: string) {
		if (val === this.value) return;
		this.value = val;
		this.dispatchEvent(
			new CustomEvent("change", {
				detail: { value: val },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleKeyDown(e: KeyboardEvent, currentIndex: number) {
		if (e.key === "ArrowRight" || e.key === "ArrowDown") {
			e.preventDefault();
			const next = (currentIndex + 1) % this.options.length;
			this.select(this.options[next].value);
			(this.querySelectorAll("button")[next] as HTMLElement)?.focus();
		} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
			e.preventDefault();
			const prev =
				(currentIndex - 1 + this.options.length) % this.options.length;
			this.select(this.options[prev].value);
			(this.querySelectorAll("button")[prev] as HTMLElement)?.focus();
		}
	}

	override render() {
		if (this.variant === "tabs") {
			return html`
        <div class="tabs tabs-bordered" role="tablist">
          ${this.options.map(
						(opt, i) => html`
            <button
              role="tab"
              class="tab ${this.value === opt.value ? "tab-active" : ""}"
              aria-selected=${this.value === opt.value}
              @click=${() => this.select(opt.value)}
              @keydown=${(e: KeyboardEvent) => this.handleKeyDown(e, i)}
            >${opt.label}</button>
          `,
					)}
        </div>
      `;
		}

		return html`
      <div class="flex gap-1.5 flex-wrap" role="group" aria-label=${this.groupLabel || undefined}>
        ${this.options.map(
					(opt, i) => html`
          <button
            type="button"
            class="btn btn-xs flex-1 ${this.value === opt.value ? "btn-primary" : "btn-ghost border border-base-300"}"
            style=${opt.style ?? ""}
            aria-pressed=${this.value === opt.value}
            @click=${() => this.select(opt.value)}
            @keydown=${(e: KeyboardEvent) => this.handleKeyDown(e, i)}
          >${opt.label}</button>
        `,
				)}
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-segmented": SpeeedySegmented;
	}
}
