import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Info } from "lucide";
import { icon } from "../../utils/icons.js";

/**
 * <speeedy-info-tip tip="Your tooltip text here">
 *
 * A lightweight info button that shows a global tooltip on hover/focus.
 * Replaces the repeated renderInfo() helper in settings-panel.ts.
 */
@customElement("speeedy-info-tip")
export class SpeeedyInfoTip extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) tip = "";

	private showTip(e: MouseEvent | FocusEvent) {
		const target = e.currentTarget as HTMLElement;
		window.dispatchEvent(
			new CustomEvent("speeedy:show-tooltip", {
				detail: { text: this.tip, target },
			}),
		);
	}

	private hideTip() {
		window.dispatchEvent(new CustomEvent("speeedy:hide-tooltip"));
	}

	override render() {
		return html`
      <button
        type="button"
        aria-label="More information"
        class="btn btn-ghost btn-xs btn-circle text-base-content/30 hover:text-primary transition-colors"
        @mouseenter=${this.showTip}
        @mouseleave=${this.hideTip}
        @focus=${this.showTip}
        @blur=${this.hideTip}
      >
        ${icon(Info, "w-3 h-3")}
      </button>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-info-tip": SpeeedyInfoTip;
	}
}
