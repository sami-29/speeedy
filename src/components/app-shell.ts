import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ParsedDocument, Route, UserProfile } from "../models/types.js";
import { audioService } from "../services/audio-service.js";
import { loadProfile, saveProfile } from "../services/storage-service.js";
import { createDocFromText } from "../services/text-parser.js";
import { applyTheme } from "../services/theme-service.js";

import "./app-page.ts";
import "./benchmark-test.ts";
import "./changelog-page.ts";
import "./donate-page.ts";
import "./feedback-modal.ts";
import "./learn-page.ts";
import "./legal-page.ts";
import "./marketing-page.ts";
import "./profile-page.ts";
import "./promote-page.ts";
import "./global-tooltip.ts";
import "./rsvp-reader.ts";
import "./share-view.ts";
import "./stats-dashboard.ts";
import "./toast-container.ts";
import "./onboarding-modal.ts";
import { trackPageview } from "../utils/analytics.js";
import { showToast } from "../utils/events.js";

@customElement("app-shell")
export class AppShell extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@state() private route: Route = "landing";
	@state() private shareParam = "";
	@state() private pendingDoc: ParsedDocument | null = null;
	@state() private pendingSavedDocId: string | null = null;
	@state() private pendingResumeIndex = 0;
	@state() private profile: UserProfile | null = null;

	override async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.profile = await loadProfile();
		applyTheme(this.profile.settings.theme);
		this.handleHashChange();
		window.addEventListener("hashchange", this.handleHashChange);
		window.addEventListener("speeedy:navigate", this.handleNavigate);
		window.addEventListener(
			"speeedy:profile-updated",
			this.handleProfileUpdated,
		);
		window.addEventListener(
			"unhandledrejection",
			this.handleUnhandledRejection,
		);
		document.addEventListener("pointerdown", this.handleGlobalClick, {
			capture: true,
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener("hashchange", this.handleHashChange);
		window.removeEventListener("speeedy:navigate", this.handleNavigate);
		window.removeEventListener(
			"speeedy:profile-updated",
			this.handleProfileUpdated,
		);
		window.removeEventListener(
			"unhandledrejection",
			this.handleUnhandledRejection,
		);
		document.removeEventListener("pointerdown", this.handleGlobalClick, {
			capture: true,
		});
	}

	private handleGlobalClick = (e: PointerEvent): void => {
		audioService.initOnInteraction();

		if (!this.profile) return;
		const s = this.profile.settings;
		if (!(s.clickSoundEnabled ?? false)) return;

		const el = e.target as Element | null;
		if (!el) return;
		const btn = el.closest(
			"button, a[href], [role='button'], [role='switch'], label[for]",
		) as HTMLElement | null;
		if (
			!btn ||
			btn.hasAttribute("disabled") ||
			(btn as HTMLButtonElement).disabled
		)
			return;

		if (
			btn.hasAttribute("data-mute-toggle") ||
			btn.closest("[data-mute-toggle]")
		)
			return;

		const overrideType = btn.getAttribute("data-click-sound");
		if (
			overrideType === "tick" ||
			overrideType === "comma" ||
			overrideType === "sentence"
		) {
			audioService.playTick(overrideType, s.clickSoundPitch ?? 1.0);
			return;
		}
		if (
			btn.closest(".rsvp-open-btn") ||
			btn.closest(".rsvp-done-btn") ||
			btn.classList.contains("theme-button") ||
			btn.tagName === "A"
		) {
			audioService.playTick("sentence", s.clickSoundPitch ?? 1.0);
			return;
		}
		if (
			btn.classList.contains("hud-tool-btn") ||
			btn.closest(".hud-tool-btn") ||
			btn.closest(".rsvp-prefs-menu")
		) {
			audioService.playTick("tick", s.clickSoundPitch ?? 1.0);
			return;
		}
		audioService.playTick("comma", s.clickSoundPitch ?? 1.0);
	};

	private handleHashChange = (): void => {
		const hash = window.location.hash.replace("#/", "").replace("#", "");
		if (hash.startsWith("share/")) {
			this.shareParam = hash.replace("share/", "");
			this.route = "share";
		} else if (hash.startsWith("read/")) {
			const encoded = hash.replace("read/", "");
			try {
				const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
				const binary = atob(base64);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
				const text = new TextDecoder().decode(bytes);

				this.pendingDoc = createDocFromText(text, "Shared Reading");
				this.route = "reader";
			} catch (e) {
				console.error("Failed to parse read link:", e);
				this.route = "landing";
			}
		} else if (hash === "app") {
			this.route = "app";
		} else if (hash === "benchmark") {
			this.route = "benchmark";
		} else if (hash === "stats") {
			this.route = "stats";
		} else if (hash === "profile") {
			this.route = "profile";
		} else if (hash === "reader") {
			this.route = "reader";
		} else if (hash === "privacy") {
			this.route = "privacy";
		} else if (hash === "terms") {
			this.route = "terms";
		} else if (hash === "learn") {
			this.route = "learn";
		} else if (hash === "donate") {
			this.route = "donate";
		} else if (hash === "promote") {
			this.route = "promote";
		} else if (hash === "changelog") {
			this.route = "changelog";
		} else {
			this.route = "landing";
		}
		window.scrollTo(0, 0);
		// Hash SPA: Umami only auto-tracks the first load.
		const path = hash ? `/${hash.split("/")[0]}` : "/";
		trackPageview(path);
	};

	private handleNavigate = (e: Event): void => {
		const ce = e as CustomEvent<{
			route: Route;
			doc?: ParsedDocument;
			savedDocId?: string;
			resumeWordIndex?: number;
		}>;
		if (ce.detail.doc) this.pendingDoc = ce.detail.doc;
		if (ce.detail.savedDocId != null)
			this.pendingSavedDocId = ce.detail.savedDocId;
		if (ce.detail.resumeWordIndex != null)
			this.pendingResumeIndex = ce.detail.resumeWordIndex;
		window.location.hash = `/${ce.detail.route}`;
	};

	private handleUnhandledRejection = (e: PromiseRejectionEvent): void => {
		const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
		if (msg) showToast(msg, "error");
	};

	private handleProfileUpdated = async (e: Event): Promise<void> => {
		const ce = e as CustomEvent<{ profile: UserProfile }>;
		this.profile = ce.detail.profile;
		await saveProfile(this.profile);
		applyTheme(this.profile.settings.theme);
	};

	override render() {
		if (!this.profile) {
			return html`
        <div class="flex items-center justify-center min-h-screen">
          <span class="loading loading-ring loading-lg text-primary"></span>
        </div>
      `;
		}

		return html`
      <div class="page-shell">
        <div class="page-enter">
          ${this.renderRoute()}
        </div>

        <feedback-modal></feedback-modal>
        <toast-container></toast-container>
        <global-tooltip></global-tooltip>
        <onboarding-modal .profile=${this.profile} .currentRoute=${this.route}></onboarding-modal>
      </div>
    `;
	}

	private renderRoute() {
		switch (this.route) {
			case "app":
				return html`<app-page .profile=${this.profile}></app-page>`;
			case "benchmark":
				return html`<benchmark-test .profile=${this.profile}></benchmark-test>`;
			case "reader":
				return html`
          <rsvp-reader
            .profile=${this.profile}
            .pendingDoc=${this.pendingDoc}
            .savedDocId=${this.pendingSavedDocId}
            .resumeWordIndex=${this.pendingResumeIndex}
          ></rsvp-reader>
        `;
			case "stats":
				return html`<stats-dashboard .profile=${this.profile}></stats-dashboard>`;
			case "profile":
				return html`<profile-page .profile=${this.profile}></profile-page>`;
			case "share":
				return html`<share-view .encoded=${this.shareParam}></share-view>`;
			case "privacy":
				return html`<legal-page page="privacy"></legal-page>`;
			case "terms":
				return html`<legal-page page="terms"></legal-page>`;
			case "learn":
				return html`<learn-page></learn-page>`;
			case "donate":
				return html`<donate-page></donate-page>`;
			case "promote":
				return html`<promote-page></promote-page>`;
			case "changelog":
				return html`<changelog-page></changelog-page>`;
			default:
				return html`<marketing-page .profile=${this.profile}></marketing-page>`;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"app-shell": AppShell;
	}
}
