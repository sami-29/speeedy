import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
	ArrowLeft,
	BookOpen,
	Clock,
	Download,
	Play,
	Share2,
	Trash2,
	Upload,
	X,
} from "lucide";
import type {
	ParsedDocument,
	SavedDocument,
	UserProfile,
} from "../models/types.js";
import { AVATAR_EMOJIS } from "../services/defaults.js";
import {
	buildShareData,
	downloadProfileBackup,
	generateShareUrl,
	loadProfileFromFile,
} from "../services/profile-service.js";
import {
	formatDuration,
	formatNumber,
	getAverageWpm,
} from "../services/stats-service.js";
import {
	deleteSavedDocument,
	getSavedDocuments,
	saveDocument,
	saveProfile,
} from "../services/storage-service.js";
import { trackEvent } from "../utils/analytics.js";
import { emitProfileUpdated, navigate } from "../utils/events.js";
import { icon } from "../utils/icons.js";
import "./share-card.ts";
import "./ui/dialog.js";
import "./ui/file-uploader.js";
import "./ui/page-nav.js";
import "./ui/segmented.js";
import "./ui/stat-card.js";

@customElement("profile-page")
export class ProfilePage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) profile!: UserProfile;
	@state() private editingName = false;
	@state() private nameInput = "";
	@state() private showShareCard = false;
	@state() private shareUrl = "";
	@state() private shareIncludeAvatar = false;
	@state() private shareData: import("../models/types.js").ShareData | null =
		null;
	@state() private savingPng = false;
	@state() private activeSection: "profile" | "library" | "data" = "profile";
	@state() private savedDocs: SavedDocument[] = [];
	@state() private libraryPage = 1;
	@state() private docUploadError = "";
	@state() private docUploadSuccess = "";
	@state() private isUploadingAvatar = false;
	@state() private showAvatarCrop = false;
	@state() private pendingAvatarDataUrl: string | null = null;
	@state() private cropZoom = 1;
	@state() private cropOffsetX = 0;
	@state() private cropOffsetY = 0;
	@state() private sharePrivacyAcknowledged = false;
	private pendingImg: HTMLImageElement | null = null;
	private _dragActive = false;
	private _dragStartX = 0;
	private _dragStartY = 0;
	private _dragStartOffsetX = 0;
	private _dragStartOffsetY = 0;

	private handleDocFileParsed = async (
		e: CustomEvent<{ doc: ParsedDocument }>,
	): Promise<void> => {
		const doc = e.detail.doc;
		await saveDocument({
			title: doc.title,
			text: doc.text,
			wordCount: doc.wordCount,
			resumeWordIndex: 0,
			completionPercent: 0,
		});
		this.savedDocs = await getSavedDocuments();
		this.docUploadError = "";
		this.docUploadSuccess = `"${doc.title}" added to your library.`;
		setTimeout(() => {
			this.docUploadSuccess = "";
		}, 4000);
	};

	private handleDocFileError = (e: CustomEvent<{ message: string }>): void => {
		this.docUploadError = e.detail.message;
		this.docUploadSuccess = "";
	};

	override async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.savedDocs = await getSavedDocuments();

		const pendingTab = sessionStorage.getItem("speeedy:profile-tab");
		if (
			pendingTab === "library" ||
			pendingTab === "data" ||
			pendingTab === "profile"
		) {
			this.activeSection = pendingTab;
			sessionStorage.removeItem("speeedy:profile-tab");
		}
	}

	private updateProfile(partial: Partial<UserProfile>): void {
		const updated = { ...this.profile, ...partial };
		saveProfile(updated);
		emitProfileUpdated(updated);
	}

	override render() {
		return html`
      <div class="h-screen flex flex-col bg-base-100 overflow-hidden">
        ${this.renderNav()}
        <main class="flex-1 overflow-y-auto">
          <div class="max-w-2xl mx-auto px-4 py-5">
            ${this.renderSectionTabs()}
            <div class="mt-5">
              ${this.activeSection === "profile" ? this.renderProfileSection() : ""}
              ${this.activeSection === "library" ? this.renderLibrarySection() : ""}
              ${this.activeSection === "data" ? this.renderDataSection() : ""}
            </div>
          </div>
        </main>
      </div>

      ${this.showShareCard ? this.renderShareModal() : ""}
      ${this.showAvatarCrop && this.pendingAvatarDataUrl ? this.renderAvatarCropModal() : ""}
    `;
	}

	private renderNav() {
		return html`<speeedy-page-nav label="Profile" back-route="app"></speeedy-page-nav>`;
	}

	private renderSectionTabs() {
		const sections = [
			{ id: "profile", label: "Profile" },
			{ id: "library", label: "Library" },
			{ id: "data", label: "Data" },
		] as const;
		return html`
      <div class="tabs tabs-bordered">
        ${sections.map(
					(s) => html`
          <button
            class="tab ${this.activeSection === s.id ? "tab-active" : ""}"
            @click=${() => {
							this.activeSection = s.id;
						}}
          >${s.label}</button>
        `,
				)}
      </div>
    `;
	}

	private renderProfileSection() {
		const p = this.profile;
		const hasAvatarImage = Boolean(p.avatarImage);
		return html`
      <div class="flex flex-col gap-8 pb-8">

        <!-- Avatar & Name -->
        <div class="flex items-center gap-5 py-2">
          <div class="w-20 h-20 rounded-full bg-base-200 flex items-center justify-center overflow-hidden select-none shrink-0 border border-base-200">
            ${
							hasAvatarImage && p.avatarImage
								? html`<img src=${p.avatarImage} alt="Profile avatar" class="w-full h-full object-cover" />`
								: html`<span class="text-4xl">${p.avatarEmoji}</span>`
						}
          </div>
          <div class="flex flex-col gap-1 min-w-0">
            ${
							this.editingName
								? html`
            <div class="flex items-center gap-2">
              <label for="display-name-input" class="sr-only">Display name</label>
              <input
                id="display-name-input"
                type="text"
                class="input input-bordered input-sm w-40"
                .value=${this.nameInput}
                @input=${(e: InputEvent) => {
									this.nameInput = (e.target as HTMLInputElement).value;
								}}
                @keydown=${(e: KeyboardEvent) => {
									if (e.key === "Enter") {
										this.updateProfile({
											displayName: this.nameInput.trim() || p.displayName,
										});
										this.editingName = false;
									}
									if (e.key === "Escape") {
										this.editingName = false;
									}
								}}
                autofocus
              />
              <button class="btn btn-primary btn-sm" @click=${() => {
								this.updateProfile({
									displayName: this.nameInput.trim() || p.displayName,
								});
								this.editingName = false;
							}}>Save</button>
            </div>
          `
								: html`
            <button
              class="flex items-center gap-2 group w-fit"
              @click=${() => {
								this.nameInput = p.displayName;
								this.editingName = true;
							}}
              aria-label="Edit display name"
            >
              <span class="text-ui-title font-semibold">${p.displayName}</span>
              <svg class="w-3.5 h-3.5 text-ui-muted-subtle group-hover:text-ui-muted transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
              </svg>
            </button>
          `
						}
            <p class="text-ui-body text-ui-muted">
              Member since ${new Date(p.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long" })}
            </p>
          </div>
        </div>

        <!-- Avatar controls -->
        <div class="flex flex-col gap-5">
          <!-- Upload image -->
          <div class="flex flex-col gap-2">
            <span class="text-ui-body uppercase tracking-widest text-ui-muted font-semibold">Profile Image</span>
            <div class="flex items-center gap-2 flex-wrap">
              <label class="btn btn-outline btn-sm gap-2 cursor-pointer">
                ${icon(Upload, "w-4 h-4")}
                ${this.isUploadingAvatar ? "Uploading..." : hasAvatarImage ? "Change image" : "Upload image"}
                <input
                  type="file"
                  accept="image/*"
                  class="hidden"
                  @change=${(e: Event) => void this.handleAvatarUpload(e)}
                />
              </label>
              ${
								hasAvatarImage
									? html`
              <button
                class="btn btn-ghost btn-sm text-error"
                @click=${() => this.updateProfile({ avatarImage: null })}
              >
                Remove
              </button>
            `
									: ""
							}
            </div>
            <p class="text-ui-body text-ui-muted-subtle">
              Stored only in your browser.
            </p>
          </div>

          <!-- Emoji Picker -->
          <div class="flex flex-col gap-2">
            <span class="text-ui-body uppercase tracking-widest text-ui-muted font-semibold">Emoji Avatar</span>

            <!-- Quick presets -->
            <div class="flex flex-wrap gap-1.5">
              ${AVATAR_EMOJIS.map(
								(emoji) => html`
                  <button
                    class="text-xl w-9 h-9 rounded-lg flex items-center justify-center transition-all
                      ${
												p.avatarEmoji === emoji
													? "bg-primary/15 ring-1 ring-primary/50"
													: "bg-base-200/60 hover:bg-base-200"
											}"
                    @click=${() => this.updateProfile({ avatarEmoji: emoji })}
                    aria-label="Set avatar to ${emoji}"
                    aria-pressed="${p.avatarEmoji === emoji}"
                  >${emoji}</button>
                `,
							)}
            </div>

            <!-- Custom emoji input -->
            <div class="flex items-center gap-2 mt-1">
              <label for="custom-emoji-input" class="sr-only">Custom emoji</label>
              <input
                id="custom-emoji-input"
                type="text"
                maxlength="2"
                class="input input-bordered input-xs w-20 text-center text-lg"
                .value=${p.avatarEmoji}
                @input=${(e: InputEvent) => {
									const input = e.target as HTMLInputElement;
									const raw = input.value.trim();
									if (!raw) {
										input.value = p.avatarEmoji;
										return;
									}
									const chosen = raw.slice(-2);
									input.value = chosen;
									this.updateProfile({ avatarEmoji: chosen });
								}}
              />
              <span class="text-ui-body text-ui-muted">
                Or type / paste any emoji you like.
              </span>
            </div>
          </div>
        </div>

        <!-- Stats Summary -->
        <div class="flex flex-col gap-2">
          <span class="text-ui-body uppercase tracking-widest text-ui-muted font-semibold">Reading Stats</span>
          <div class="grid grid-cols-3 gap-3">
            <div class="border border-base-200 rounded-xl px-4 py-3 text-center">
              <div class="text-ui-title font-semibold tabular-nums">${formatNumber(p.totalWordsRead)}</div>
              <div class="text-ui-body text-ui-muted uppercase tracking-widest mt-0.5">Words</div>
            </div>
            <div class="border border-primary/20 bg-primary/5 rounded-xl px-4 py-3 text-center">
              <div class="text-ui-title font-semibold tabular-nums">${getAverageWpm(p) || "—"}</div>
              <div class="text-ui-body text-primary uppercase tracking-widest mt-0.5 font-semibold">Avg WPM</div>
            </div>
            <div class="border border-base-200 rounded-xl px-4 py-3 text-center">
              <div class="text-ui-title font-semibold tabular-nums">${formatDuration(p.totalTimeMs)}</div>
              <div class="text-ui-body text-ui-muted uppercase tracking-widest mt-0.5">Time</div>
            </div>
          </div>
        </div>

        <!-- Baseline + Improvement -->
        <div class="border border-base-200 rounded-xl p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-ui-body uppercase tracking-widest text-ui-muted font-semibold">Reading Progress</span>
            <a href="#/benchmark" class="text-ui-body text-primary hover:underline underline-offset-2 font-semibold">
              ${p.baselineWpm ? "Retest →" : "Take the test →"}
            </a>
          </div>
          ${
						p.baselineWpm
							? html`
            <div class="grid grid-cols-3 gap-3">
              <div class="text-center">
                <div class="text-ui-title font-semibold">${p.baselineWpm}</div>
                <div class="text-ui-body text-ui-muted mt-0.5">Baseline WPM</div>
              </div>
              <div class="text-center">
                <div class="text-ui-title font-semibold">${getAverageWpm(p) || "—"}</div>
                <div class="text-ui-body text-ui-muted mt-0.5">Current Avg WPM</div>
              </div>
              <div class="text-center">
                ${
									getAverageWpm(p) && getAverageWpm(p) > p.baselineWpm
										? html`
                  <div class="text-ui-title font-semibold text-success">
                    +${Math.round(((getAverageWpm(p) - p.baselineWpm) / p.baselineWpm) * 100)}%
                  </div>
                  <div class="text-ui-body text-success mt-0.5 font-semibold">Improvement</div>
                `
										: getAverageWpm(p) && getAverageWpm(p) < p.baselineWpm
											? html`
                  <div class="text-ui-title font-semibold text-ui-muted">—</div>
                  <div class="text-ui-body text-ui-muted mt-0.5">Keep reading!</div>
                `
											: html`
                  <div class="text-ui-title font-semibold text-ui-muted">—</div>
                  <div class="text-ui-body text-ui-muted mt-0.5">More sessions needed</div>
                `
								}
              </div>
            </div>
            ${
							p.baselineComprehension !== null
								? html`
              <div class="mt-2 pt-2 border-t border-base-200/60 text-ui-body text-ui-muted flex items-center justify-between">
                <span>Baseline comprehension</span>
                <span class="font-mono">${p.baselineComprehension}%</span>
              </div>
            `
								: ""
						}
          `
							: html`
            <p class="text-ui-body text-ui-muted">
              No baseline yet. Take the reading test to measure your WPM and comprehension — then track your improvement over time.
            </p>
          `
					}
        </div>

        <!-- Share -->
        <div class="flex flex-col gap-3">
          <span class="text-ui-body uppercase tracking-widest text-ui-muted font-semibold">Share Profile</span>

          <div class="rounded-xl border border-warning/35 bg-warning/8 px-4 py-3 flex flex-col gap-2">
            <p class="text-ui-body font-semibold uppercase tracking-widest text-warning">⚠ Privacy notice</p>
            <p class="text-ui-body text-ui-muted leading-relaxed">
              Shared profile links embed your selected stats directly in the URL.
              Analytics scripts, browser extensions, screenshots, or anyone you send the link to
              may be able to read any personal details included in that URL.
              Only share a link with personal information if you are comfortable with that.
            </p>
          </div>

          <!-- Acknowledgment checkbox -->
          <label class="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox checkbox-xs mt-0.5 shrink-0"
              .checked=${this.sharePrivacyAcknowledged}
              @change=${(event: Event) => {
								this.sharePrivacyAcknowledged = (
									event.target as HTMLInputElement
								).checked;
								if (!this.sharePrivacyAcknowledged)
									this.shareIncludeAvatar = false;
							}}
            />
            <span class="text-ui-body text-ui-muted leading-relaxed">
              I understand that personal details in a shared link may be visible to analytics tools or anyone with the URL.
            </span>
          </label>

          <!-- Avatar opt-in — only shown after acknowledgment -->
          ${
						this.sharePrivacyAcknowledged
							? html`
            <label class="flex items-start gap-2.5 cursor-pointer pl-1">
              <input
                type="checkbox"
                class="checkbox checkbox-xs mt-0.5 shrink-0"
                .checked=${this.shareIncludeAvatar}
                @change=${(event: Event) => {
									this.shareIncludeAvatar = (
										event.target as HTMLInputElement
									).checked;
								}}
              />
              <span class="text-ui-body text-ui-muted leading-relaxed">
                Include profile image in the shared card and link — increases privacy risk and may make the URL much longer.
              </span>
            </label>
          `
							: ""
					}

          <div class="flex gap-2 flex-wrap">
            <button
              class="btn btn-outline btn-sm gap-2"
              data-umami-event="share-card-generated"
              @click=${() => {
								const data = buildShareData(this.profile);
								if (
									this.shareIncludeAvatar &&
									this.sharePrivacyAcknowledged &&
									this.profile.avatarImage
								) {
									data.avatarImage = this.profile.avatarImage;
								}
								this.shareData = data;
								this.shareUrl = generateShareUrl(data);
								this.showShareCard = true;
								trackEvent("share-card-generated");
							}}
            >
              ${icon(Share2, "w-4 h-4")}
              Share Stats Card
            </button>
            <button
              class="btn btn-ghost btn-sm"
              @click=${() => navigate("stats")}
            >View Full Stats →</button>
          </div>

          ${
						!this.sharePrivacyAcknowledged
							? html`
            <p class="text-ui-body text-warning/90 font-normal">
              Acknowledge the privacy notice above to enable personal info in shared links.
            </p>
          `
							: ""
					}
        </div>
      </div>
    `;
	}

	private renderDataSection() {
		return html`
      <div class="flex flex-col gap-5 pb-8">
        <!-- Export -->
        <div class="border border-base-200 rounded-xl p-5">
            <h3 class="font-semibold mb-1 text-base-content">Export Profile</h3>
            <p class="text-ui-body text-ui-muted mb-4 leading-relaxed">Download a <code class="text-ui-body font-mono bg-base-200 px-1 py-0.5 rounded">.speeedy</code> backup file with all your settings, history, and stats.</p>
            <button
              class="btn btn-outline btn-sm w-fit gap-2"
              data-umami-event="profile-exported"
              @click=${() => {
								trackEvent("profile-exported");
								void downloadProfileBackup(this.profile);
							}}
            >
              ${icon(Download, "w-4 h-4")}
              Download .speeedy
            </button>
        </div>

        <!-- Import -->
        <div class="border border-base-200 rounded-xl p-5">
            <h3 class="font-semibold mb-1 text-base-content">Import Profile</h3>
            <p class="text-ui-body text-ui-muted mb-4 leading-relaxed">Restore from a previously exported <code class="text-ui-body font-mono bg-base-200 px-1 py-0.5 rounded">.speeedy</code> file. This will overwrite your current data.</p>
            <label class="btn btn-outline btn-sm w-fit gap-2 cursor-pointer">
              ${icon(Upload, "w-4 h-4")}
              Import .speeedy
              <input
                type="file"
                accept=".speeedy,.json"
                class="hidden"
                @change=${async (e: Event) => {
									const file = (e.target as HTMLInputElement).files?.[0];
									if (!file) return;
									const loaded = await loadProfileFromFile(file);
									trackEvent("profile-imported");
									emitProfileUpdated(loaded);
								}}
              />
            </label>
        </div>

        <!-- Reset -->
        <div class="border border-error/20 rounded-xl p-5">
            <h3 class="font-semibold text-error mb-1">Reset All Data</h3>
            <p class="text-ui-body text-ui-muted mb-4 leading-relaxed">Permanently delete all reading history, settings, and stats. This cannot be undone.</p>
            <button
              class="btn btn-error btn-outline btn-sm w-fit"
              @click=${async () => {
								if (
									confirm(
										"Are you sure? This will permanently delete all your data.",
									)
								) {
									const fresh = {
										...this.profile,
										sessions: [],
										totalWordsRead: 0,
										totalTimeMs: 0,
										currentStreak: 0,
										bestStreak: 0,
									};
									await saveProfile(fresh);
									emitProfileUpdated(fresh);
								}
							}}
            >Reset Data</button>
        </div>
      </div>
    `;
	}

	private renderLibrarySection() {
		const PAGE_SIZE = 10;
		const totalPages =
			Math.ceil(this.savedDocs.length / Math.max(PAGE_SIZE, 1)) || 1;
		const start = (this.libraryPage - 1) * PAGE_SIZE;
		const visibleDocs = this.savedDocs.slice(start, start + PAGE_SIZE);

		const uploaderBlock = html`
			<div class="mb-4">
				<speeedy-file-uploader
					compact
					label="Add a document to your library"
					hint="PDF · DOCX · TXT · EPUB · RTF · HTML · ODT · and more"
					@file-parsed=${this.handleDocFileParsed}
					@file-error=${this.handleDocFileError}
				></speeedy-file-uploader>
				${
					this.docUploadError
						? html`
					<p class="text-ui-body text-error mt-2 flex items-center gap-1.5 font-medium">
						<svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
						${this.docUploadError}
					</p>`
						: ""
				}
				${
					this.docUploadSuccess
						? html`
					<p class="text-ui-body text-success mt-2 flex items-center gap-1.5 font-medium">
						<svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
						${this.docUploadSuccess}
					</p>`
						: ""
				}
			</div>
		`;

		if (this.savedDocs.length === 0) {
			return html`
				<div class="flex flex-col gap-4 pb-8">
					${uploaderBlock}
					<div class="text-center py-8 opacity-60">
						${icon(BookOpen, "w-8 h-8 mx-auto mb-3 opacity-50")}
						<p class="text-ui-body text-ui-muted">Your library is empty.</p>
						<button class="btn btn-ghost btn-sm mt-2" @click=${() => navigate("app")}>Read something</button>
					</div>
				</div>
			`;
		}

		return html`
			<div class="flex flex-col gap-3 pb-8">
				${uploaderBlock}
				<div class="flex items-center justify-between mb-1 px-1">
					<div class="flex items-center gap-2">
						${icon(BookOpen, "w-4 h-4 text-ui-muted-subtle")}
						<span class="text-ui-body font-semibold text-base-content">Reading History</span>
					</div>
					<span class="text-ui-body text-ui-muted">${this.savedDocs.length} total</span>
				</div>

				<div class="flex flex-col gap-2">
					${visibleDocs.map((doc) => this.renderDocCard(doc))}
				</div>

				${
					totalPages > 1
						? html`
					<div class="flex items-center justify-between mt-4 px-2">
						<button
							class="btn btn-sm btn-ghost gap-1"
							?disabled=${this.libraryPage <= 1}
							@click=${() => {
								this.libraryPage--;
								window.scrollTo({ top: 0, behavior: "smooth" });
							}}
						>
							${icon(ArrowLeft, "w-3.5 h-3.5")} Prev
						</button>
						<span class="text-ui-body font-mono text-ui-muted bg-base-200 px-3 py-1 rounded-full">
							${this.libraryPage} / ${totalPages}
						</span>
						<button
							class="btn btn-sm btn-ghost gap-1"
							?disabled=${this.libraryPage >= totalPages}
							@click=${() => {
								this.libraryPage++;
								window.scrollTo({ top: 0, behavior: "smooth" });
							}}
						>
							Next <svg class="w-3.5 h-3.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
						</button>
					</div>
				`
						: ""
				}
			</div>
		`;
	}

	private renderDocCard(doc: SavedDocument) {
		const pct = doc.completionPercent;
		const resumeLabel =
			pct >= 98 ? "Read again" : pct > 0 ? `Resume ${pct}%` : "Start";
		const date = new Date(doc.savedAt).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});

		return html`
      <div class="flex items-center gap-3 px-4 py-3 rounded-xl border border-base-200 bg-base-100 hover:border-primary/30 transition-colors group">
        <div class="flex-1 min-w-0">
          <div class="text-ui-body font-semibold text-base-content truncate pr-4">${doc.title}</div>
          <div class="flex items-center gap-2 mt-1">
            ${icon(Clock, "w-3 h-3 text-ui-muted-subtle")}
            <span class="text-ui-body text-ui-muted">${date} · ${doc.wordCount.toLocaleString()} words</span>
          </div>
          ${
						pct > 0 && pct < 98
							? html`
            <div class="w-full max-w-[200px] h-1 bg-base-200 rounded-full mt-2 overflow-hidden">
              <div class="h-full bg-primary/60 rounded-full" style="width: ${pct}%"></div>
            </div>
          `
							: ""
					}
        </div>
        <div class="flex items-center gap-1.5 shrink-0 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            class="btn btn-ghost btn-sm btn-circle text-error/60 hover:text-error hover:bg-error/10"
            title="Delete"
            @click=${async () => {
							await deleteSavedDocument(doc.id);
							this.savedDocs = await getSavedDocuments();
							const maxPage = Math.ceil(this.savedDocs.length / 10) || 1;
							if (this.libraryPage > maxPage) this.libraryPage = maxPage;
						}}
          >
            ${icon(Trash2, "w-4 h-4")}
          </button>
          <button
            class="btn btn-primary btn-sm gap-2 rounded-lg ml-1"
            @click=${() => {
							const resumeIndex = pct >= 98 ? 0 : doc.resumeWordIndex;
							navigate(
								"reader",
								{ title: doc.title, text: doc.text, wordCount: doc.wordCount },
								doc.id,
								resumeIndex,
							);
						}}
          >
            ${icon(Play, "w-3.5 h-3.5")} ${resumeLabel}
          </button>
        </div>
      </div>
    `;
	}

	private renderShareModal() {
		if (!this.shareData) return null;
		return html`
      <speeedy-dialog
        ?open=${this.showShareCard}
        @speeedy-dialog-close=${() => {
					this.showShareCard = false;
				}}
      >
        <div class="bg-base-100 rounded-2xl w-full max-w-xl shadow-2xl border border-base-200">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-base-200">
            <h3 class="text-ui-title font-semibold text-base-content">Share Your Stats</h3>
            <button
              class="btn btn-ghost btn-xs btn-circle"
              aria-label="Close share modal"
              @click=${() => {
								this.showShareCard = false;
							}}
            >
              ${icon(X, "w-3.5 h-3.5")}
            </button>
          </div>

          <!-- Card preview — scrollable on small screens -->
          <div class="px-5 pt-5 overflow-x-auto">
            <share-card .data=${this.shareData}></share-card>
          </div>

          <!-- Actions -->
          <div class="px-5 py-4 flex flex-col gap-3">
            <!-- Save as PNG -->
            <button
              class="btn btn-sm btn-outline w-full gap-2"
              ?disabled=${this.savingPng}
              @click=${() => void this.saveCardAsPng()}
            >
              ${this.savingPng ? html`<span class="loading loading-spinner loading-xs"></span> Saving…` : "Save card as PNG"}
            </button>

            <!-- Shareable link -->
            <div class="flex flex-col gap-1.5">
              <span class="text-ui-body uppercase tracking-widest text-ui-muted font-semibold">Shareable Link</span>
              <div class="flex gap-2">
                <label for="share-url-input" class="sr-only">Shareable link</label>
                <input
                  id="share-url-input"
                  type="text"
                  class="input input-bordered input-sm flex-1 font-mono text-ui-body"
                  readonly
                  .value=${this.shareUrl}
                />
                <button
                  class="btn btn-sm btn-outline shrink-0"
                  aria-label="Copy shareable link"
                  @click=${() => void navigator.clipboard.writeText(this.shareUrl)}
                >Copy</button>
                <a
                  href=${this.shareUrl}
                  target="_blank"
                  rel="noopener"
                  class="btn btn-sm btn-ghost shrink-0"
                  aria-label="Preview share card in new tab"
                  title="Preview in new tab"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </speeedy-dialog>
    `;
	}

	private async saveCardAsPng(): Promise<void> {
		const cardEl =
			this.renderRoot.querySelector<HTMLElement>("#share-card-inner");
		if (!cardEl) return;
		this.savingPng = true;
		try {
			const { toPng } = await import("html-to-image");
			const dataUrl = await toPng(cardEl, { pixelRatio: 2 });
			const a = document.createElement("a");
			a.href = dataUrl;
			a.download = `speeedy-stats-${this.profile.displayName.replace(/\s+/g, "-")}.png`;
			a.click();
		} catch {
			alert("Could not save the image. Please try again.");
		} finally {
			this.savingPng = false;
		}
	}

	private async handleAvatarUpload(e: Event): Promise<void> {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			alert("Please choose an image file.");
			return;
		}

		this.isUploadingAvatar = true;
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = typeof reader.result === "string" ? reader.result : null;
			if (!dataUrl) {
				this.isUploadingAvatar = false;
				return;
			}

			const img = new Image();
			img.onload = () => {
				this.pendingImg = img;
				this.pendingAvatarDataUrl = dataUrl;
				this.showAvatarCrop = true;
				this.cropZoom = 1;
				this.cropOffsetX = 0;
				this.cropOffsetY = 0;
				this.isUploadingAvatar = false;
				requestAnimationFrame(() => this.drawCropPreview());
			};
			img.onerror = () => {
				alert("Could not read that image file.");
				this.isUploadingAvatar = false;
			};
			img.src = dataUrl;
		};
		reader.onerror = () => {
			alert("Could not read that image file.");
			this.isUploadingAvatar = false;
		};
		reader.readAsDataURL(file);
		(e.target as HTMLInputElement).value = "";
	}

	private drawCropPreview(): void {
		if (!this.pendingImg) return;
		const canvas = this.renderRoot.querySelector<HTMLCanvasElement>(
			"#avatar-crop-preview",
		);
		if (!canvas) return;
		drawCropToCanvas(
			canvas,
			this.pendingImg,
			this.cropZoom,
			this.cropOffsetX,
			this.cropOffsetY,
		);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const size = canvas.width;
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, size, size);
		ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2, true);
		ctx.fillStyle = "rgba(0,0,0,0.45)";
		ctx.fill("evenodd");
		ctx.beginPath();
		ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
		ctx.strokeStyle = "rgba(255,255,255,0.35)";
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();
	}

	private _onCropWheel = (e: WheelEvent) => {
		e.preventDefault();
		const delta = e.deltaY > 0 ? -0.06 : 0.06;
		this.cropZoom = Math.min(3, Math.max(1, this.cropZoom + delta));
		this.drawCropPreview();
	};

	private _onCropPointerDown = (e: PointerEvent) => {
		const canvas = e.currentTarget as HTMLCanvasElement;
		canvas.setPointerCapture(e.pointerId);
		this._dragActive = true;
		this._dragStartX = e.clientX;
		this._dragStartY = e.clientY;
		this._dragStartOffsetX = this.cropOffsetX;
		this._dragStartOffsetY = this.cropOffsetY;
		canvas.style.cursor = "grabbing";
	};

	private _onCropPointerMove = (e: PointerEvent) => {
		if (!this._dragActive || !this.pendingImg) return;
		const canvas = this.renderRoot.querySelector<HTMLCanvasElement>(
			"#avatar-crop-preview",
		);
		if (!canvas) return;
		const size = canvas.width;
		const baseScale =
			size / Math.min(this.pendingImg.width, this.pendingImg.height);
		const scale = baseScale * this.cropZoom;
		const drawWidth = this.pendingImg.width * scale;
		const drawHeight = this.pendingImg.height * scale;
		const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
		const maxOffsetY = Math.max(0, (drawHeight - size) / 2);

		const dx = e.clientX - this._dragStartX;
		const dy = e.clientY - this._dragStartY;

		const newX =
			maxOffsetX > 0
				? Math.min(1, Math.max(-1, this._dragStartOffsetX - dx / maxOffsetX))
				: 0;
		const newY =
			maxOffsetY > 0
				? Math.min(1, Math.max(-1, this._dragStartOffsetY - dy / maxOffsetY))
				: 0;

		this.cropOffsetX = newX;
		this.cropOffsetY = newY;
		this.drawCropPreview();
	};

	private _onCropPointerUp = (e: PointerEvent) => {
		this._dragActive = false;
		const canvas = e.currentTarget as HTMLCanvasElement;
		canvas.style.cursor = "grab";
	};

	private renderAvatarCropModal() {
		if (!this.pendingAvatarDataUrl) return null;

		return html`
      <speeedy-dialog
        ?open=${this.showAvatarCrop}
        @speeedy-dialog-close=${() => {
					this.showAvatarCrop = false;
				}}
      >
        <div class="bg-base-100 rounded-2xl w-full max-w-sm shadow-2xl border border-base-200 overflow-hidden flex flex-col">

          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-base-200/70">
            <div>
              <h3 class="text-ui-body font-semibold text-base-content leading-none">Adjust image</h3>
              <p class="text-ui-body text-ui-muted mt-1">Drag to reposition · scroll to zoom</p>
            </div>
            <button
              class="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100"
              aria-label="Close"
              @click=${() => {
								this.showAvatarCrop = false;
							}}
            >${icon(X, "w-3.5 h-3.5")}</button>
          </div>

          <!-- Canvas area -->
          <div class="flex items-center justify-center bg-base-200/40 py-7">
            <canvas
              id="avatar-crop-preview"
              width="240"
              height="240"
              class="rounded-full block"
              style="width:240px;height:240px;cursor:grab;touch-action:none;user-select:none;"
              @wheel=${this._onCropWheel}
              @pointerdown=${this._onCropPointerDown}
              @pointermove=${this._onCropPointerMove}
              @pointerup=${this._onCropPointerUp}
              @pointercancel=${this._onCropPointerUp}
            ></canvas>
          </div>

          <!-- Zoom slider -->
          <div class="px-5 pt-4 pb-2">
            <div class="flex items-center justify-between mb-2">
              <label for="crop-zoom" class="text-ui-body text-ui-muted uppercase tracking-widest font-semibold">Zoom</label>
              <span class="text-ui-body font-mono text-ui-muted-subtle">${Math.round(this.cropZoom * 100)}%</span>
            </div>
            <input
              id="crop-zoom"
              type="range" min="1" max="3" step="0.02"
              class="range range-xs range-primary w-full"
              .value=${String(this.cropZoom)}
              @input=${(e: InputEvent) => {
								this.cropZoom = Number((e.target as HTMLInputElement).value);
								this.drawCropPreview();
							}}
            />
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-between px-5 py-4">
            <button
              class="btn btn-ghost btn-sm text-base-content/50"
              @click=${() => {
								this.cropZoom = 1;
								this.cropOffsetX = 0;
								this.cropOffsetY = 0;
								this.drawCropPreview();
							}}
            >Reset</button>
            <div class="flex gap-2">
              <button
                class="btn btn-ghost btn-sm"
                @click=${() => {
									this.showAvatarCrop = false;
								}}
              >Cancel</button>
              <button
                class="btn btn-primary btn-sm px-5"
                @click=${() => void this.applyAvatarCrop()}
              >Apply</button>
            </div>
          </div>
        </div>
      </speeedy-dialog>
    `;
	}

	override updated(): void {
		if (this.showAvatarCrop) this.drawCropPreview();
	}

	private async applyAvatarCrop(): Promise<void> {
		if (!this.pendingImg) return;
		try {
			const offscreen = document.createElement("canvas");
			offscreen.width = 256;
			offscreen.height = 256;
			drawCropToCanvas(
				offscreen,
				this.pendingImg,
				this.cropZoom,
				this.cropOffsetX,
				this.cropOffsetY,
			);
			const dataUrl = offscreen.toDataURL("image/jpeg", 0.85);
			this.updateProfile({ avatarImage: dataUrl });
		} catch {
			alert("Could not process that image. Please try a smaller file.");
		} finally {
			this.showAvatarCrop = false;
			this.pendingAvatarDataUrl = null;
			this.pendingImg = null;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"profile-page": ProfilePage;
	}
}

function drawCropToCanvas(
	canvas: HTMLCanvasElement,
	img: HTMLImageElement,
	zoom: number,
	offsetX: number,
	offsetY: number,
): void {
	const size = canvas.width;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const baseScale = size / Math.min(img.width, img.height);
	const scale = baseScale * zoom;
	const drawWidth = img.width * scale;
	const drawHeight = img.height * scale;

	const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
	const maxOffsetY = Math.max(0, (drawHeight - size) / 2);

	const x = (size - drawWidth) / 2 - offsetX * maxOffsetX;
	const y = (size - drawHeight) / 2 - offsetY * maxOffsetY;

	ctx.clearRect(0, 0, size, size);
	ctx.drawImage(img, x, y, drawWidth, drawHeight);
}
