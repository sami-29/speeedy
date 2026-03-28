import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ShareData } from "../models/types.js";
import { decodeShareData } from "../services/profile-service.js";
import { navigate } from "../utils/events.js";
import "./share-card.ts";

@customElement("share-view")
export class ShareView extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) encoded = "";
	@state() private data: ShareData | null = null;
	@state() private error = false;

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.encoded) {
			this.data = decodeShareData(this.encoded);
			if (!this.data) this.error = true;
		}
	}

	override render() {
		return html`
      <div class="min-h-screen bg-base-100 flex flex-col items-center justify-center px-4 py-16">
        <div class="w-full max-w-lg overflow-x-auto">

          ${
						this.error || !this.data
							? html`
            <div class="text-center">
              <p class="text-ui-muted mb-4">Invalid or expired share link.</p>
              <button class="btn btn-primary btn-sm" @click=${() => navigate("app")}>
                Go to Speeedy
              </button>
            </div>
          `
							: html`
            <div class="mb-6 text-center">
              <p class="text-xs tracking-widest uppercase text-ui-muted-subtle mb-2">Reading Stats</p>
              <h1 class="text-2xl font-light text-base-content">${this.data.displayName}'s Profile</h1>
            </div>

            <share-card .data=${this.data}></share-card>

            <div class="mt-8 text-center flex flex-col gap-3">
              <p class="text-sm text-ui-muted">Want to track your own reading?</p>
              <button
                class="btn btn-primary"
                @click=${() => navigate("app")}
              >Try Speeedy for free →</button>
            </div>
          `
					}
        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"share-view": ShareView;
	}
}
