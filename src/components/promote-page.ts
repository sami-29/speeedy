import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Check, Copy, ExternalLink, Link as LinkIcon } from "lucide";
import { showToast } from "../utils/events.js";
import { icon } from "../utils/icons.js";
import "./ui/input.js";
import "./ui/page-nav.js";

@customElement("promote-page")
export class PromotePage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@state() private text = "";
	@state() private generatedUrl = "";
	@state() private copied = false;

	private generate(): void {
		if (!this.text.trim()) {
			this.generatedUrl = "";
			return;
		}

		try {
			const bytes = new TextEncoder().encode(this.text.trim());
			let binary = "";
			for (let i = 0; i < bytes.length; i++)
				binary += String.fromCharCode(bytes[i]);

			const base64 = btoa(binary)
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");

			const base = window.location.origin + window.location.pathname;
			this.generatedUrl = `${base}#/read/${base64}`;
		} catch (_e) {
			showToast("Failed to generate link.", "error");
		}
	}

	private async copyUrl() {
		if (!this.generatedUrl) return;
		await navigator.clipboard.writeText(this.generatedUrl);
		this.copied = true;
		showToast("Link copied to clipboard!", "success");
		setTimeout(() => {
			this.copied = false;
		}, 2000);
	}

	override render() {
		return html`
      <div class="min-h-screen bg-base-100 flex flex-col">
        <speeedy-page-nav label="Speeedy for Bloggers" back-route="app"></speeedy-page-nav>

        <main class="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
          <header class="mb-10">
            <h1 class="text-3xl font-light text-base-content mb-3">Share your content</h1>
            <p class="text-sm text-ui-muted font-light leading-relaxed">
              Give your readers a "One-Click Read" link. 
              They'll be taken straight to our RSVP reader with your text pre-loaded—no accounts, no uploads, zero friction.
            </p>
          </header>

          <div class="flex flex-col gap-8">
            <div class="form-control">
              <speeedy-textarea
                label="Text content to read"
                hint="Markdown or plain text"
                placeholder="Paste your blog post or article text here..."
                .value=${this.text}
                min-height="12rem"
                @change=${(e: CustomEvent<{ value: string }>) => {
									this.text = e.detail.value;
									this.generate();
								}}
              ></speeedy-textarea>
            </div>

            ${
							this.generatedUrl
								? html`
              <div class="p-6 rounded-2xl bg-base-200/50 border border-base-200 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center gap-2 text-primary">
                    ${icon(LinkIcon, "w-4 h-4")}
                    <span class="text-xs font-semibold uppercase tracking-wider">Your share link</span>
                  </div>
                  <button 
                    class="btn btn-xs ${this.copied ? "btn-success" : "btn-primary"} gap-1.5"
                    @click=${this.copyUrl}
                  >
                    ${this.copied ? icon(Check, "w-3 h-3") : icon(Copy, "w-3 h-3")}
                    ${this.copied ? "Copied" : "Copy Link"}
                  </button>
                </div>
                
                <div class="bg-base-100 p-3 rounded-lg border border-base-300/40 text-[0.7rem] font-mono text-base-content break-all mb-4 select-all">
                  ${this.generatedUrl}
                </div>

                <div class="flex flex-wrap gap-2">
                  <a href=${this.generatedUrl} target="_blank" class="btn btn-ghost btn-xs gap-1.5 text-ui-muted hover:text-primary">
                    ${icon(ExternalLink, "w-3 h-3")}
                    Test link
                  </a>
                </div>
              </div>
            `
								: ""
						}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5 pt-8 border-t border-base-200">
              <div class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-base-content flex items-center gap-2">
                   Why use Speeedy?
                </h3>
                <ul class="text-xs text-ui-muted flex flex-col gap-2 font-light list-disc list-inside">
                  <li>Respects reader privacy (no cookies)</li>
                  <li>Great for long-form summaries</li>
                  <li>Works on any device (PWA)</li>
                  <li>Completely free & open access</li>
                </ul>
              </div>
              <div class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-base-content">Markdown support</h3>
                <p class="text-xs text-ui-muted font-light leading-relaxed">
                  You can include basic Markdown formatting in your text. Speeedy will preserve the structure while reading. 
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"promote-page": PromotePage;
	}
}
