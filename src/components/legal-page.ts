import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GITHUB_URL } from "../config.js";
import "./ui/page-nav.js";

@customElement("legal-page")
export class LegalPage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) page!: "privacy" | "terms";

	override render() {
		const isPrivacy = this.page === "privacy";
		const title = isPrivacy ? "Privacy Policy" : "Terms of Service";
		return html`
      <div class="min-h-screen bg-base-100 flex flex-col">
        <speeedy-page-nav label=${title} back-href="#/"></speeedy-page-nav>
        <main class="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
          <h1 class="text-2xl font-semibold text-base-content mb-2">${title}</h1>
          <p class="text-sm text-ui-muted mb-10">Last updated: March 2026</p>
          <div class="flex flex-col gap-8 text-sm text-ui-muted leading-relaxed">
            ${isPrivacy ? this.renderPrivacy() : this.renderTerms()}
          </div>
        </main>
      </div>
    `;
	}

	private renderPrivacy() {
		return html`
      <section>
        <h2 class="text-base font-medium text-base-content mb-2">What Speeedy collects</h2>
        <p>
          Speeedy is a client-side application. Your reading content and uploaded files are
          processed entirely in your browser and are never sent to any server.
        </p>
        <p class="mt-3">
          Your settings, reading history, and statistics are stored in your browser's IndexedDB.
          This data never leaves your device unless you explicitly export it from the Profile page.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">Analytics — Umami</h2>
        <p>
          Speeedy uses <a href="https://umami.is" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">Umami</a>
          for anonymous usage analytics. Umami is cookieless and collects no personally identifiable information.
          It records page views and click events (e.g. "opened the reader", "took the benchmark test") to help
          understand which features are used. It does not track you across websites, does not fingerprint your
          device, and does not share data with third parties.
        </p>
        <p class="mt-3 text-xs text-ui-muted">
          Umami's privacy policy:
          <a href="https://umami.is/privacy" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">umami.is/privacy</a>
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">Hosting — Cloudflare Pages</h2>
        <p>
          Speeedy is hosted on Cloudflare Pages. Cloudflare may collect standard server access logs
          (IP address, user-agent, request timestamp) for security and performance purposes.
          These logs are governed by Cloudflare's own privacy policy and are not accessible to the Speeedy maintainer.
        </p>
        <p class="mt-3 text-xs text-ui-muted">
          Cloudflare's privacy policy:
          <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">cloudflare.com/privacypolicy</a>
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">Profile share links</h2>
        <p>
          If you choose to share your reading stats using the Share Stats Card feature, your selected data
          (display name, reading statistics, and optionally your profile image) is encoded directly into the
          URL fragment of the generated link.
        </p>
        <p class="mt-3">
          URL fragments are not sent to servers in standard HTTP requests, but they can be read by
          client-side analytics scripts (including Umami), browser extensions, or anyone who receives the link.
          If you include a profile image, it is embedded in full inside the URL.
        </p>
        <p class="mt-3">
          Sharing a profile link is entirely optional and requires explicit acknowledgment of this risk
          before personal information can be included. You can share anonymous stats (WPM, words read, streaks)
          without including any personal identity fields.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">Feedback form</h2>
        <p>
          If you submit feedback through the in-app form, your message and optional email address are sent to
          <a href="https://formspree.io" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">Formspree</a>.
          This data is used only to respond to your feedback and is not shared with third parties.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">Open source</h2>
        <p>
          Speeedy is open source under the MIT license. The full source code is available at
          <a href="${GITHUB_URL}" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">${GITHUB_URL}</a>.
          You can self-host the app and run it entirely without any third-party services.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">Contact</h2>
        <p>
          For privacy-related questions, open an issue on the
          <a href="${GITHUB_URL}/issues" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">GitHub repository</a>.
        </p>
      </section>
    `;
	}

	private renderTerms() {
		return html`
      <section>
        <h2 class="text-base font-medium text-base-content mb-2">1. Acceptance</h2>
        <p>
          By using Speeedy you agree to these terms. If you do not agree, do not use the service.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">2. What Speeedy is</h2>
        <p>
          Speeedy is a free, browser-based RSVP speed reading tool. You can paste text or upload files (PDF, DOCX, EPUB, TXT).
          All processing is done locally in your browser. No account is required.
        </p>
        <p class="mt-3">
          The source code is available at
          <a href="${GITHUB_URL}" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">${GITHUB_URL}</a>
          under the MIT license. You are free to use, modify, and self-host it.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">3. Your content</h2>
        <p>
          Text you paste or upload is processed entirely in your browser and is never transmitted to any server.
          You retain full ownership of your content. Speeedy does not claim any rights over it.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">4. Acceptable use</h2>
        <p>
          You agree not to use the service to process content that violates applicable laws or third-party rights.
          Do not attempt to disrupt, overload, or compromise the app or its hosting infrastructure.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">5. Disclaimer</h2>
        <p>
          The service is provided "as is" without warranty of any kind. We do not guarantee uninterrupted or
          error-free operation. Speed reading may not be suitable for everyone. If you experience eye strain
          or discomfort, stop and consult a medical professional if needed.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">6. Changes</h2>
        <p>
          These terms may be updated from time to time. Continued use after changes constitutes acceptance
          of the updated terms. Material changes will be noted in the
          <a href="#/changelog" class="text-ui-muted hover:text-base-content underline underline-offset-2">changelog</a>.
        </p>
      </section>

      <section>
        <h2 class="text-base font-medium text-base-content mb-2">7. Contact</h2>
        <p>
          For questions, open an issue on the
          <a href="${GITHUB_URL}/issues" target="_blank" rel="noopener" class="text-ui-muted hover:text-base-content underline underline-offset-2">GitHub repository</a>.
        </p>
      </section>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"legal-page": LegalPage;
	}
}
