import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { audioService } from "../../services/audio-service.js";
import "./info-tip.js";

/**
 * <speeedy-toggle label="Bionic reading" ?checked=${val} tip="..." @change=${handler}>
 * </speeedy-toggle>
 *
 * A labeled toggle row with optional inline info tooltip.
 * Emits a native 'change' event with detail: { value: boolean }.
 */
@customElement("speeedy-toggle")
export class SpeeedyToggle extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) label = "";
	@property({ type: Boolean }) checked = false;
	@property({ type: String }) hint = "";
	@property({ type: Boolean }) disabled = false;
	/** Tooltip text — when set, renders an inline info-tip icon next to the label. */
	@property({ type: String }) tip = "";

	private handleChange(e: Event) {
		e.stopPropagation();
		const checked = (e.target as HTMLInputElement).checked;
		this.checked = checked;
		audioService.playClick();
		this.dispatchEvent(
			new CustomEvent("change", {
				detail: { value: checked },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render() {
		return html`
      <label class="flex items-start justify-between gap-2 cursor-pointer">
        <div class="min-w-0 pr-2">
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-base-content">${this.label}</span>
            ${this.tip ? html`<speeedy-info-tip tip=${this.tip}></speeedy-info-tip>` : ""}
          </div>
          ${this.hint ? html`<p class="text-xs text-ui-muted-subtle">${this.hint}</p>` : ""}
        </div>
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-sm mt-0.5 shrink-0"
          .checked=${this.checked}
          ?disabled=${this.disabled}
          @change=${this.handleChange}
        />
      </label>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-toggle": SpeeedyToggle;
	}
}
