import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Heart } from "lucide";
import type { UserProfile } from "../models/types.js";
import { icon } from "../utils/icons.js";

const SESSIONS_BEFORE_SHOW = 3;

@customElement("donation-banner")
export class DonationBanner extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) profile!: UserProfile;
	@state() private visible = false;

	override connectedCallback(): void {
		super.connectedCallback();
		this.visible = this.shouldShow();
	}

	private shouldShow(): boolean {
		const sessionCount = this.profile?.sessions?.length ?? 0;
		return sessionCount >= SESSIONS_BEFORE_SHOW;
	}

	override render() {
		if (!this.visible) return html``;

		return html`
      <div class="border-b border-base-200/80 bg-base-200/30 px-6 py-2.5">
        <div class="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">

          <div class="flex items-center gap-2.5 min-w-0">
            ${icon(Heart, "w-3 h-3 text-error shrink-0")}
            <p class="text-[0.7rem] uppercase tracking-wider text-base-content/50 font-medium">
              Speeedy is free & ad-free — consider a small donation to keep it running
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <a
              href="#/donate"
              class="btn btn-xs btn-outline border-error/30 text-error hover:bg-error hover:text-error-content hover:border-error gap-1.5 px-3"
              data-umami-event="donation-banner-click"
            >
              ${icon(Heart, "w-2.5 h-2.5")}
              Support
            </a>
          </div>

        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"donation-banner": DonationBanner;
	}
}
