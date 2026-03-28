import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ArrowLeft } from "lucide";
import type { Route } from "../../models/types.js";
import { navigate } from "../../utils/events.js";
import { icon } from "../../utils/icons.js";

/**
 * <speeedy-page-nav label="Profile" back-route="app" ?sticky=${true}>
 *
 * A consistent back-navigation header used across all sub-pages.
 * Replaces the repeated renderNav() helpers in profile-page, stats-dashboard,
 * donate-page, learn-page, and benchmark-test.
 */
@customElement("speeedy-page-nav")
export class SpeeedyPageNav extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	/** The page title shown next to the back button */
	@property({ type: String }) label = "";
	/** The route to navigate back to (passed to navigate()). Ignored if back-href is set. */
	@property({ type: String, attribute: "back-route" }) backRoute: Route = "app";
	/** Optional href for anchor-based back navigation (e.g. "#/"). If set, renders an <a> instead of <button>. */
	@property({ type: String, attribute: "back-href" }) backHref = "";
	/** If true, adds sticky top-0 with backdrop blur */
	@property({ type: Boolean }) sticky = false;

	private handleBack() {
		navigate(this.backRoute);
	}

	override render() {
		const stickyClasses = this.sticky
			? "sticky top-0 bg-base-100/90 backdrop-blur-md z-10"
			: "";

		const backBtn = this.backHref
			? html`<a href=${this.backHref} class="btn btn-ghost btn-sm btn-circle" aria-label="Go back">${icon(ArrowLeft, "w-4 h-4")}</a>`
			: html`<button class="btn btn-ghost btn-sm btn-circle" @click=${this.handleBack} aria-label="Go back">${icon(ArrowLeft, "w-4 h-4")}</button>`;

		return html`
      <nav class="px-6 py-4 flex items-center gap-3 border-b border-base-200 ${stickyClasses}">
        ${backBtn}
        <span class="text-sm text-ui-muted tracking-widest uppercase">${this.label}</span>
        <slot></slot>
      </nav>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-page-nav": SpeeedyPageNav;
	}
}
