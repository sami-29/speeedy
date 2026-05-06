import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Star, X } from "lucide";
import { GITHUB_URL } from "../config.js";
import type { UserProfile } from "../models/types.js";
import { saveProfile } from "../services/storage-service.js";
import { emitProfileUpdated } from "../utils/events.js";
import { icon } from "../utils/icons.js";

@customElement("github-star-prompt")
export class GithubStarPrompt extends LitElement {
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
		if (this.profile?.githubStarPromptDismissed) return false;
		const sessions = this.profile?.sessions?.length ?? 0;
		const goodBenchmark =
			this.profile?.baselineWpm != null &&
			(this.profile?.baselineComprehension ?? 0) >= 70;
		return sessions >= 5 || goodBenchmark;
	}

	private dismiss(): void {
		this.visible = false;
		const updated: UserProfile = {
			...this.profile,
			githubStarPromptDismissed: true,
		};
		saveProfile(updated);
		emitProfileUpdated(updated);
	}

	override render() {
		if (!this.visible) return html``;

		return html`
      <div
        class="border-b border-base-200/80 bg-amber-500/5 px-6 py-2.5"
        data-umami-event="github-star-prompt-shown"
      >
        <div class="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">

          <div class="flex items-center gap-2.5 min-w-0">
            ${icon(Star, "w-3 h-3 text-amber-400 shrink-0")}
            <p class="text-[0.7rem] uppercase tracking-wider text-base-content/50 font-medium">
              Liking Speeedy? Star us on GitHub — it helps people find it.
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <a
              href=${GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-xs btn-outline border-amber-400/30 text-amber-400 hover:bg-amber-400/10 hover:border-amber-400 gap-1.5 px-3"
              data-umami-event="github-star-prompt-click"
              @click=${this.dismiss}
            >
              ${icon(Star, "w-2.5 h-2.5")}
              Star
            </a>
            <button
              class="btn btn-xs btn-ghost text-base-content/30 hover:text-base-content/60 btn-circle"
              aria-label="Dismiss"
              data-umami-event="github-star-prompt-dismiss"
              @click=${this.dismiss}
            >
              ${icon(X, "w-3 h-3")}
            </button>
          </div>

        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"github-star-prompt": GithubStarPrompt;
	}
}
