import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BookOpen, Clock, Edit2, Play, Trash2 } from "lucide";
import type {
	ParsedDocument,
	SavedDocument,
	ThemeName,
	UserProfile,
} from "../models/types.js";
import {
	deleteSavedDocument,
	getSavedDocuments,
	saveDocument,
	saveProfile,
} from "../services/storage-service.js";
import { applyTheme, getResolvedTheme } from "../services/theme-service.js";
import { trackEvent } from "../utils/analytics.js";
import {
	emitProfileUpdated,
	navigate,
	openFeedback,
	showToast,
} from "../utils/events.js";
import { icon } from "../utils/icons.js";
import { countWords, estimateReadingMinutes } from "../utils/text-utils.js";
import "./donation-banner.ts";
import "./github-star-prompt.ts";
import "./ui/file-uploader.ts";
import "./ui/input.ts";

@customElement("app-page")
export class AppPage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) profile!: UserProfile;
	@state() private pastedText = "";
	@state() private error = "";
	@state() private inputTab: "file" | "text" = "file";
	@state() private loadedDocTitle = "";
	@state() private loadedDocText = "";
	@state() private customTitle = "";
	@state() private savedDocs: SavedDocument[] = [];
	@state() private welcomeDismissed = false;
	@state() private recentMinimized = false;

	private static readonly WELCOME_DISMISSED_KEY = "speeedy:welcome-dismissed";
	private static readonly RECENT_MINIMIZED_KEY = "speeedy:recent-minimized";

	override async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.welcomeDismissed =
			localStorage.getItem(AppPage.WELCOME_DISMISSED_KEY) !== null;
		this.recentMinimized =
			localStorage.getItem(AppPage.RECENT_MINIMIZED_KEY) === "1";
		this.savedDocs = await getSavedDocuments();

		const isFirstVisit =
			(this.profile?.sessions?.length ?? 0) === 0 &&
			this.savedDocs.length === 0;
		if (isFirstVisit) {
			this.pastedText = DEMO_TEXT;
			this.loadedDocTitle = "Demo: The Science of Speed Reading";
			this.loadedDocText = DEMO_TEXT;
			this.customTitle = "Demo: The Science of Speed Reading";
			this.inputTab = "text";
		}
	}

	private dismissWelcome(): void {
		localStorage.setItem(AppPage.WELCOME_DISMISSED_KEY, "1");
		this.welcomeDismissed = true;
	}

	private handleFileParsed = (
		e: CustomEvent<{ doc: ParsedDocument }>,
	): void => {
		const doc = e.detail.doc;
		this.pastedText = doc.text;
		this.loadedDocTitle = doc.title;
		this.loadedDocText = doc.text;
		this.customTitle = doc.title;
		this.error = "";
		this.inputTab = "text";
		const ext = doc.title.includes(".")
			? (doc.title.split(".").pop()?.toLowerCase() ?? "unknown")
			: "unknown";
		trackEvent("file-uploaded", { type: ext, words: doc.wordCount });
	};

	private handleFileError = (e: CustomEvent<{ message: string }>): void => {
		this.error = e.detail.message;
		showToast(e.detail.message, "error");
	};

	private handleStartReading = async (): Promise<void> => {
		const text = this.pastedText.trim();
		if (!text) {
			this.error = "Nothing to read yet. Paste some text or load a file first.";
			return;
		}
		const wordCount = countWords(text);
		const baseTitle =
			this.customTitle.trim() || this.loadedDocTitle || "Pasted Text";
		const isModified =
			this.loadedDocText.length > 0 && text !== this.loadedDocText;
		const title = isModified ? `${baseTitle} – modified` : baseTitle;
		const saved = await saveDocument({
			title,
			text,
			wordCount,
			resumeWordIndex: 0,
			completionPercent: 0,
		});
		trackEvent("reader-opened", {
			source: this.loadedDocTitle ? "file" : "paste",
			words: wordCount,
		});
		this.loadedDocTitle = "";
		this.loadedDocText = "";
		this.customTitle = "";
		this.pastedText = "";
		navigate(
			"reader",
			{ title: saved.title, text: saved.text, wordCount: saved.wordCount },
			saved.id,
			saved.resumeWordIndex,
		);
	};

	private cycleTheme(): void {
		const current: ThemeName = this.profile?.settings?.theme ?? "system";
		const effective =
			current === "system" ? getResolvedTheme(current) : current;
		const next: ThemeName = effective === "light" ? "dark" : "light";
		applyTheme(next);
		const updated: UserProfile = {
			...this.profile,
			settings: { ...this.profile.settings, theme: next },
		};
		saveProfile(updated);
		emitProfileUpdated(updated);
	}

	private themeIcon(theme: ThemeName) {
		const effective = theme === "system" ? getResolvedTheme(theme) : theme;
		if (effective === "dark") {
			return html`<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>`;
		}
		return html`<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M12 3v2m0 14v2M3 12H1m22 0h-2M4.929 4.929l1.414 1.414m11.314 11.314l1.414 1.414M4.929 19.071l1.414-1.414m11.314-11.314l1.414-1.414M12 8a4 4 0 100 8 4 4 0 000-8z"/>
            </svg>`;
	}

	override render() {
		const theme: ThemeName = this.profile?.settings?.theme ?? "system";
		const effectiveTheme = theme === "system" ? getResolvedTheme(theme) : theme;
		const themeTitle =
			effectiveTheme === "dark"
				? "Theme: Dark — click for light"
				: "Theme: Light — click for dark";
		return html`
      <div class="h-screen flex flex-col bg-base-100 overflow-hidden relative">

        <nav class="px-4 md:px-10 py-3 md:py-4 flex items-center justify-between shrink-0 gap-2 min-h-[48px]">
          <div class="flex items-center gap-2 md:gap-3 min-w-0">
            <a href="#/" class="btn btn-ghost btn-sm text-ui-muted gap-2 hover:text-base-content min-h-[44px] touch-manipulation">
              <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
              </svg>
              <span class="hidden sm:inline">Landing Page</span>
            </a>
            <span class="text-ui-muted-subtle text-sm select-none hidden sm:inline" aria-hidden="true">/</span>
            <span class="text-sm md:text-base tracking-[0.2em] md:tracking-[0.25em] font-light text-base-content select-none truncate">speeedy</span>
          </div>
          <div class="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <button type="button" class="btn btn-ghost btn-sm gap-1.5 min-h-[44px] min-w-[44px] touch-manipulation" @click=${() => navigate("profile")}>
              ${
								this.profile?.avatarImage
									? html`<img src=${this.profile.avatarImage} alt="Profile" class="w-6 h-6 rounded-full object-cover shrink-0" />`
									: html`<span class="text-base leading-none">${this.profile?.avatarEmoji ?? "📚"}</span>`
							}
              <span class="hidden sm:inline">${this.profile?.displayName ?? "Profile"}</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm gap-2 min-h-[44px] min-w-[44px] touch-manipulation" @click=${() => navigate("stats")}>
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
              </svg>
              <span class="hidden sm:inline">Stats</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm gap-2 min-h-[44px] min-w-[44px] touch-manipulation" @click=${openFeedback}>
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
              </svg>
              <span class="hidden sm:inline">Feedback</span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle min-h-[44px] min-w-[44px] touch-manipulation"
              title="${themeTitle}"
              aria-label="${themeTitle}"
              @click=${this.cycleTheme}
            >
              ${this.themeIcon(theme)}
            </button>
          </div>
        </nav>

        <github-star-prompt .profile=${this.profile}></github-star-prompt>
        <donation-banner .profile=${this.profile}></donation-banner>

        <main class="flex-1 flex flex-col items-center justify-center px-4 min-h-0 overflow-auto">

          <div class="mb-5 md:mb-6 text-center select-none">
            <h1 class="text-2xl sm:text-3xl font-extralight tracking-tight text-base-content leading-tight mb-1">
              What are you reading <span class="font-semibold">today?</span>
            </h1>
            ${
							(this.profile?.sessions?.length ?? 0) > 0
								? html`
              <p class="text-xs text-ui-muted-subtle font-light">
                Your avg: <span class="font-mono text-ui-muted">${Math.round((this.profile?.sessions?.reduce((sum, s) => sum + s.wpm, 0) ?? 0) / Math.max(this.profile?.sessions?.length ?? 1, 1))} WPM</span>
              </p>`
								: html`
              <p class="text-xs text-ui-muted-subtle font-light">
                Drop a file or paste text to start reading
              </p>`
						}
          </div>

          ${
						this.profile?.onboardingSeen &&
						(this.profile?.sessions?.length ?? 0) === 0
							? html`
            <div class="welcome-banner w-full max-w-xl mb-4 ${this.welcomeDismissed ? "dismissed" : ""}">
              <div class="rounded-xl bg-primary/8 border border-primary/20 px-4 py-3 flex items-start gap-3 relative">
                <div class="text-sm text-ui-muted font-light leading-relaxed pr-8">
                  A demo is loaded — hit <strong class="font-medium text-base-content">Begin Reading</strong> to try RSVP,
                  or paste your own text. <a href="#/benchmark" class="text-primary hover:underline underline-offset-2">Find your WPM →</a>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-circle absolute top-2 right-2 text-ui-muted-subtle hover:text-base-content"
                  aria-label="Dismiss hint"
                  @click=${this.dismissWelcome}
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
          `
							: ""
					}

          <div class="w-full max-w-xl">
            <div class="bg-base-100 border border-base-200 rounded-xl md:rounded-2xl shadow-sm overflow-hidden">
              <div class="flex border-b border-base-200">
                ${(["file", "text"] as const).map(
									(tab) => html`
                  <button
                    type="button"
                    class="flex-1 py-3.5 md:py-3 text-sm transition-colors min-h-[44px] touch-manipulation
                      ${
												this.inputTab === tab
													? "text-base-content font-medium border-b-2 border-primary -mb-px"
													: "text-ui-muted hover:text-base-content"
											}"
                    @click=${() => {
											this.inputTab = tab;
											this.error = "";
										}}
                  >${tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
                `,
								)}
              </div>

              <div class="p-4 md:p-6">
                ${this.inputTab === "file" ? this.renderFileTab() : ""}
                ${this.inputTab === "text" ? this.renderTextTab() : ""}
              </div>

              ${
								this.error
									? html`
                <div class="mx-5 mb-4 flex items-center gap-2 text-error text-sm">
                  <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  ${this.error}
                </div>`
									: ""
							}
            </div>
          </div>
        </main>

        ${this.savedDocs.length > 0 ? this.renderLibrary() : ""}

        <footer class="shrink-0 px-4 md:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-base-200/60">
          <span class="text-xs tracking-[0.3em] text-ui-muted-subtle font-light">speeedy</span>
          <div class="flex flex-wrap justify-center gap-4 sm:gap-6 text-xs">
            <a href="#/learn" class="text-ui-muted hover:text-base-content transition-colors">Learn more about RSVP</a>
            <a href="#/promote" class="text-ui-muted hover:text-base-content transition-colors underline decoration-primary/30 underline-offset-4">Speeedy for Bloggers</a>
            <a href="#/privacy" class="text-ui-muted hover:text-base-content transition-colors">Privacy</a>
            <a href="#/terms" class="text-ui-muted hover:text-base-content transition-colors">Terms</a>
          </div>
        </footer>
      </div>
    `;
	}

	private renderFileTab() {
		return html`
      <speeedy-file-uploader
        label="Drop a file, or click to browse"
        hint="PDF · DOCX · DOC · TXT · EPUB · RTF · HTML · ODT · and more · up to 50 MB"
        @file-parsed=${this.handleFileParsed}
        @file-error=${this.handleFileError}
      ></speeedy-file-uploader>
    `;
	}

	private loadDemoText(): void {
		this.pastedText = DEMO_TEXT;
		this.loadedDocTitle = "Demo: The Science of Speed Reading";
		this.loadedDocText = DEMO_TEXT;
		this.customTitle = "Demo: The Science of Speed Reading";
		trackEvent("demo-loaded");
	}

	private renderTextTab() {
		const words = countWords(this.pastedText);
		const wpm = this.profile?.settings.wpm ?? 300;
		const estTimeLabel = words > 0 ? estimateReadingMinutes(words, wpm) : "";
		const timeDisplay = estTimeLabel ? ` · ~${estTimeLabel} at ${wpm} WPM` : "";

		return html`
      <div class="flex flex-col gap-4">
        ${
					this.loadedDocTitle
						? html`
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/15">
            <svg class="w-3.5 h-3.5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span class="text-xs text-primary font-medium truncate">${this.loadedDocTitle}</span>
            <span class="text-xs text-ui-muted ml-auto shrink-0">extracted ✓</span>
          </div>
        `
						: ""
				}
        ${
					!this.pastedText
						? html`
          <button
            class="btn btn-outline btn-sm w-full gap-2 border-dashed"
            @click=${this.loadDemoText}
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            Try a demo text
          </button>
        `
						: ""
				}
        <speeedy-input
          id="doc-title-input"
          label="Title"
          placeholder="Pasted Text"
          .value=${this.customTitle}
          @change=${(e: CustomEvent<{ value: string }>) => {
						this.customTitle = e.detail.value;
					}}
        ></speeedy-input>
        <speeedy-textarea
          id="doc-text-input"
          label="Text to read"
          placeholder="Paste your text here…"
          .value=${this.pastedText}
          min-height="7rem"
          max-height="14rem"
          @change=${(e: CustomEvent<{ value: string }>) => {
						this.pastedText = e.detail.value;
					}}
        ></speeedy-textarea>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-ui-muted font-mono">
            ${words > 0 ? `${words.toLocaleString()} words${timeDisplay}` : ""}
          </span>
          <div class="flex gap-2">
            ${
							this.pastedText
								? html`
              <button class="btn btn-ghost btn-sm" @click=${() => {
								this.pastedText = "";
								this.loadedDocTitle = "";
								this.loadedDocText = "";
								this.customTitle = "";
							}}>Clear</button>
            `
								: ""
						}
            <button
              class="btn btn-primary btn-sm"
              data-umami-event="begin-reading"
              ?disabled=${!this.pastedText.trim()}
              @click=${() => void this.handleStartReading()}
            >Begin Reading</button>
          </div>
        </div>
      </div>
    `;
	}

	private renderLibrary() {
		return html`
      <div class="w-full max-w-xl mt-4 mb-4 px-4 md:ml-4">
        <div class="flex items-center justify-between mb-3 px-1">
          <div class="flex items-center gap-2">
            ${icon(BookOpen, "w-3.5 h-3.5 text-ui-muted-subtle")}
            <span class="text-xs uppercase tracking-widest text-ui-muted-subtle font-medium">Recent</span>
          <button
              class="btn btn-ghost btn-xs btn-circle ml-1"
              title="${this.recentMinimized ? "Show all" : "Minimize"}"
              aria-label="${this.recentMinimized ? "Show recent documents" : "Minimize recent documents"}"
              aria-expanded="${!this.recentMinimized}"
              @click=${() => {
								this.recentMinimized = !this.recentMinimized;
								localStorage.setItem(
									AppPage.RECENT_MINIMIZED_KEY,
									this.recentMinimized ? "1" : "0",
								);
							}}
            >
              <svg class="w-3.5 h-3.5 transition-transform duration-200 ${this.recentMinimized ? "rotate-180" : ""}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
          </div>
          ${
						this.savedDocs.length > 3 && !this.recentMinimized
							? html`
            <button class="btn btn-ghost btn-xs text-xs text-ui-muted" @click=${() => {
							sessionStorage.setItem("speeedy:profile-tab", "library");
							navigate("profile");
						}}>View All →</button>
          `
							: ""
					}
        </div>

        <div
          class="flex flex-col gap-1.5 overflow-y-auto pr-2 scrollbar-thin transition-all duration-300 ease-out"
          style="max-height: ${this.recentMinimized ? "0px" : "220px"}; opacity: ${this.recentMinimized ? "0" : "1"}; margin-top: ${this.recentMinimized ? "-1rem" : "0"}"
        >
          ${this.savedDocs.length > 0 ? this.savedDocs.slice(0, 15).map((doc) => this.renderDocCard(doc)) : ""}
        </div>
      </div>
    `;
	}

	private renderDocCard(doc: SavedDocument) {
		const pct = doc.completionPercent;
		const resumeLabel =
			pct >= 98 ? "Read again" : pct > 0 ? `Resume ${pct}%` : "Start";
		const date = new Date(doc.savedAt).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});

		return html`
      <div class="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-base-200 hover:border-primary/30 transition-colors group">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-base-content truncate">${doc.title}</div>
          <div class="flex items-center gap-2 mt-0.5">
            ${icon(Clock, "w-3 h-3 text-ui-muted-subtle")}
            <span class="text-xs text-ui-muted-subtle font-light">${date} · ${doc.wordCount.toLocaleString()} words</span>
          </div>
          ${
						pct > 0 && pct < 98
							? html`
            <div class="w-full h-0.5 bg-base-300 rounded-full mt-1.5 overflow-hidden">
              <div class="h-full bg-primary/50 rounded-full" style="width: ${pct}%"></div>
            </div>
          `
							: ""
					}
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100 transition-opacity text-ui-muted hover:text-base-content"
            title="Edit"
            aria-label="Edit ${doc.title}"
            @click=${() => {
							this.customTitle = doc.title;
							this.pastedText = doc.text;
							this.loadedDocTitle = doc.title;
							this.loadedDocText = doc.text;
							this.inputTab = "text";
							window.scrollTo({ top: 0, behavior: "smooth" });
						}}
          >
            ${icon(Edit2, "w-3.5 h-3.5")}
          </button>
          <button
            class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100 transition-opacity text-error/60 hover:text-error"
            title="Remove"
            aria-label="Remove ${doc.title}"
            @click=${async () => {
							await deleteSavedDocument(doc.id);
							this.savedDocs = await getSavedDocuments();
						}}
          >
            ${icon(Trash2, "w-3.5 h-3.5")}
          </button>
          <button
            class="btn btn-primary btn-xs gap-1.5 rounded-lg ml-1"
            data-umami-event="library-resume"
            @click=${() => {
							const resumeIndex = pct >= 98 ? 0 : doc.resumeWordIndex;
							trackEvent("reader-opened", {
								source: "library",
								words: doc.wordCount,
							});
							navigate(
								"reader",
								{ title: doc.title, text: doc.text, wordCount: doc.wordCount },
								doc.id,
								resumeIndex,
							);
						}}
          >
            ${icon(Play, "w-3 h-3")} ${resumeLabel}
          </button>
        </div>
      </div>
    `;
	}
}

const DEMO_TEXT = `Every time you read a line of text, your eyes don't move smoothly, they jump. These rapid jumps are called saccades, and they happen three to four times per second. During each jump, you read nothing at all. That dead time adds up to roughly ten percent of every reading session, wasted on pure eye movement.

Rapid Serial Visual Presentation, or RSVP, eliminates saccades entirely. Instead of your eyes chasing words across a page, the words come to you, one at a time, at a fixed point on the screen. Your gaze stays perfectly still. The result is a significant reduction in the mechanical overhead of reading, which means more of your attention goes to understanding rather than scanning.

There is a second insight built into this app: the Optimal Recognition Point. Research by O'Regan and Jacobs showed that every word has a sweet spot, typically the letter just to the left of center, where the brain identifies the word fastest. Speeedy aligns every single word to this exact position. Your eye lands on the pivot, and recognition happens at peak efficiency, flash after flash.

Speed without comprehension is useless. That is why automatic pauses are inserted after punctuation, giving your working memory the fraction of a second it needs to consolidate each clause before the next one arrives. Combined with a gentle slow-start ramp at the beginning of each session, the experience is surprisingly comfortable even at speeds well above your normal reading pace.

The average adult reads at around two hundred and thirty-eight words per minute. With practice on RSVP, many readers comfortably reach four hundred words per minute while maintaining strong comprehension. You just experienced a small sample. Hit play on your own text and see what your number is.`;

declare global {
	interface HTMLElementTagNameMap {
		"app-page": AppPage;
	}
}
