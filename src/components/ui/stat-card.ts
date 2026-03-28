import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { IconNode } from "lucide";
import { icon } from "../../utils/icons.js";

/**
 * <speeedy-stat-card value="238" label="avg adult WPM" .icon=${BookOpen}>
 *
 * A stat display card with an optional icon, value, and label.
 * Replaces the repeated renderStatCard() helpers in stats-dashboard, profile-page,
 * benchmark-test, and learn-page.
 *
 * Variants:
 *   "default" — card with border, icon, value, label (stats-dashboard style)
 *   "compact" — text-center, no border, no icon (profile-page style)
 */
@customElement("speeedy-stat-card")
export class SpeeedyStatCard extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) value = "";
	@property({ type: String }) label = "";
	@property({ attribute: false }) icon?: IconNode;
	@property({ type: String }) variant: "default" | "compact" = "default";

	override render() {
		if (this.variant === "compact") {
			return html`
        <div class="text-center">
          <div class="text-xl font-light">${this.value}</div>
          <div class="text-xs uppercase tracking-widest text-base-content/60 mt-0.5">${this.label}</div>
        </div>
      `;
		}

		return html`
      <div class="border border-base-200 rounded-xl py-4 px-5">
        ${this.icon ? html`<div class="text-base-content/45 mb-2">${icon(this.icon, "w-4 h-4")}</div>` : ""}
        <div class="text-2xl font-light tabular-nums">${this.value}</div>
        <div class="text-xs uppercase tracking-widest text-base-content/55 mt-0.5">${this.label}</div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-stat-card": SpeeedyStatCard;
	}
}
