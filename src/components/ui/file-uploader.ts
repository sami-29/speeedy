import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ParsedDocument } from "../../models/types.js";
import { parseFile } from "../../services/text-parser.js";

/**
 * <speeedy-file-uploader
 *   label="Drop a file, or click to browse"
 *   hint="PDF · DOCX · TXT · EPUB · and more · up to 50 MB"
 *   max-bytes=${50 * 1024 * 1024}
 *   compact
 *   @file-parsed=${handler}
 *   @file-error=${handler}
 * ></speeedy-file-uploader>
 *
 * A Radix-UI-inspired drag-and-drop file uploader.
 * Supports PDF, DOCX, TXT, MD, EPUB, ZIP, RTF, HTML, ODT, CSV.
 *
 * Events:
 *   file-parsed  → CustomEvent<{ doc: ParsedDocument }>
 *   file-error   → CustomEvent<{ message: string }>
 *   file-loading → CustomEvent<{ loading: boolean }>
 */
@customElement("speeedy-file-uploader")
export class SpeeedyFileUploader extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	/** Main label shown in the drop zone */
	@property({ type: String }) label = "Drop a file, or click to browse";
	/** Hint text shown below the label */
	@property({ type: String }) hint =
		"PDF · DOCX · TXT · EPUB · and more · up to 50 MB";
	/** Max file size in bytes (default 50 MB) */
	@property({ type: Number, attribute: "max-bytes" }) maxBytes =
		50 * 1024 * 1024;
	/** Compact mode: smaller padding, no icon */
	@property({ type: Boolean }) compact = false;
	/** Disable the uploader */
	@property({ type: Boolean }) disabled = false;
	/** Extra classes forwarded to the drop zone wrapper */
	@property({ type: String, attribute: "zone-class" }) zoneClass = "";

	@state() private isDragging = false;
	@state() private loading = false;

	/** All accepted MIME types and extensions */
	private static readonly ACCEPT =
		".pdf,.docx,.doc,.txt,.md,.epub,.zip,.rtf,.html,.htm,.odt,.csv";

	private get inputId() {
		return `speeedy-file-input-${this._uid}`;
	}
	private _uid = Math.random().toString(36).slice(2, 7);

	async handleFiles(files: FileList | File[]): Promise<void> {
		const file = files[0];
		if (!file) return;

		if (file.size > this.maxBytes) {
			const mb = (file.size / 1024 / 1024).toFixed(1);
			const limit = (this.maxBytes / 1024 / 1024).toFixed(0);
			const msg = `That file is ${mb} MB — just over the ${limit} MB limit. Try a smaller file or paste the text directly.`;
			this._emitError(msg);
			return;
		}

		this.loading = true;
		this._emitLoading(true);

		try {
			const doc = await parseFile(file);
			this.dispatchEvent(
				new CustomEvent<{ doc: ParsedDocument }>("file-parsed", {
					detail: { doc },
					bubbles: true,
					composed: true,
				}),
			);
		} catch (e) {
			const msg =
				e instanceof Error
					? e.message
					: "We couldn't read that file. Try a different format or paste the text instead.";
			this._emitError(msg);
		} finally {
			this.loading = false;
			this._emitLoading(false);
			// Reset the input so the same file can be re-selected
			const input = this.renderRoot.querySelector<HTMLInputElement>(
				`#${this.inputId}`,
			);
			if (input) input.value = "";
		}
	}

	private _emitError(message: string) {
		this.dispatchEvent(
			new CustomEvent<{ message: string }>("file-error", {
				detail: { message },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _emitLoading(loading: boolean) {
		this.dispatchEvent(
			new CustomEvent<{ loading: boolean }>("file-loading", {
				detail: { loading },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleDrop = (e: DragEvent): void => {
		e.preventDefault();
		this.isDragging = false;
		if (this.disabled || this.loading) return;
		const files = e.dataTransfer?.files;
		if (files?.length) void this.handleFiles(files);
	};

	private handleDragOver = (e: DragEvent): void => {
		e.preventDefault();
		if (!this.disabled && !this.loading) this.isDragging = true;
	};

	private handleDragLeave = (): void => {
		this.isDragging = false;
	};

	private handleFileInput = (e: Event): void => {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) void this.handleFiles(input.files);
	};

	private handleClick = (): void => {
		if (this.disabled || this.loading) return;
		this.renderRoot
			.querySelector<HTMLInputElement>(`#${this.inputId}`)
			?.click();
	};

	private handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			this.handleClick();
		}
	};

	override render() {
		const dragging = this.isDragging;
		const pad = this.compact ? "p-4" : "p-7";

		const zoneBase = `
      border-2 border-dashed rounded-xl ${pad} text-center cursor-pointer
      transition-all duration-200 select-none outline-none
      focus-visible:ring-2 focus-visible:ring-primary/40
    `;
		const zoneState =
			this.disabled || this.loading
				? "border-base-300 opacity-60 cursor-not-allowed"
				: dragging
					? "border-primary bg-primary/5 scale-[1.01]"
					: "border-base-300 hover:border-base-content/40 hover:bg-base-200/40";

		return html`
      <div
        class="${zoneBase} ${zoneState} ${this.zoneClass}"
        role="button"
        tabindex="${this.disabled ? -1 : 0}"
        aria-label="${this.label}"
        aria-disabled="${this.disabled}"
        @dragover=${this.handleDragOver}
        @dragleave=${this.handleDragLeave}
        @drop=${this.handleDrop}
        @click=${this.handleClick}
        @keydown=${this.handleKeyDown}
      >
        <input
          id="${this.inputId}"
          type="file"
          accept="${SpeeedyFileUploader.ACCEPT}"
          class="hidden"
          ?disabled=${this.disabled}
          @change=${this.handleFileInput}
        />
        ${this.loading ? this._renderLoading() : this._renderIdle()}
      </div>
    `;
	}

	private _renderLoading() {
		return html`
      <div class="flex flex-col items-center gap-3">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <p class="text-xs text-ui-muted-subtle">Extracting text…</p>
      </div>
    `;
	}

	private _renderIdle() {
		if (this.compact) {
			return html`
        <div class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 text-ui-muted-subtle shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
          </svg>
          <div class="text-left">
            <p class="text-sm font-medium text-base-content">${this.label}</p>
            ${this.hint ? html`<p class="text-xs text-ui-muted-subtle mt-0.5">${this.hint}</p>` : ""}
          </div>
        </div>
      `;
		}

		return html`
      <div class="flex flex-col items-center gap-3">
        <svg class="w-8 h-8 text-ui-muted-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
        <div>
          <p class="text-sm font-medium text-base-content">${this.label}</p>
          ${this.hint ? html`<p class="text-xs text-ui-muted-subtle mt-1">${this.hint}</p>` : ""}
        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-file-uploader": SpeeedyFileUploader;
	}
}
