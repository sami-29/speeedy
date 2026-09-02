import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { X } from "lucide";
import { tokenize } from "../services/rsvp-engine.js";
import { icon } from "../utils/icons.js";
import "./ui/dialog.ts";

export interface PreviewParagraph {
	text: string;
	startWordIndex: number;
	wordCount: number;
}

/** Split text into paragraphs with word indices matching RSVP tokenize(). */
export function buildPreviewParagraphs(text: string): PreviewParagraph[] {
	const normalized = text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (!normalized) return [];

	const paras = normalized
		.split(/\n\n+/)
		.map((p) => p.trim())
		.filter(Boolean);

	let startIndex = 0;
	return paras.map((p) => {
		const wordCount = tokenize(p).length;
		const result: PreviewParagraph = {
			text: p,
			startWordIndex: startIndex,
			wordCount,
		};
		startIndex += wordCount;
		return result;
	});
}

/**
 * Pre-read preview: scroll past front matter, click a paragraph, start RSVP there.
 */
@customElement("start-preview-dialog")
export class StartPreviewDialog extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Boolean }) open = false;
	@property({ type: String }) title = "";
	@property({ type: String }) text = "";

	@state() private selectedStartIndex = 0;
	@state() private paragraphs: PreviewParagraph[] = [];
	@state() private totalWords = 0;

	override updated(changed: Map<string | number | symbol, unknown>): void {
		if (changed.has("text") || (changed.has("open") && this.open)) {
			this.paragraphs = buildPreviewParagraphs(this.text);
			this.totalWords = this.paragraphs.reduce(
				(sum, p) => sum + p.wordCount,
				0,
			);
			this.selectedStartIndex = 0;
		}
	}

	private close = (): void => {
		this.dispatchEvent(
			new CustomEvent("preview-close", { bubbles: true, composed: true }),
		);
	};

	private selectParagraph(startWordIndex: number): void {
		this.selectedStartIndex = startWordIndex;
	}

	private startFrom(index: number): void {
		this.dispatchEvent(
			new CustomEvent("preview-start", {
				detail: { startWordIndex: index },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private snippet(text: string, max = 220): string {
		const flat = text.replace(/\s+/g, " ").trim();
		if (flat.length <= max) return flat;
		return `${flat.slice(0, max).trimEnd()}…`;
	}

	override render() {
		const selectedPara = this.paragraphs.find(
			(p) => p.startWordIndex === this.selectedStartIndex,
		);
		const remaining =
			this.totalWords > 0
				? Math.max(0, this.totalWords - this.selectedStartIndex)
				: 0;

		return html`
      <speeedy-dialog
        .open=${this.open}
        @speeedy-dialog-close=${this.close}
      >
        <div
          class="bg-base-100 rounded-2xl w-[min(40rem,calc(100vw-1.5rem))] max-h-[min(85vh,720px)] shadow-2xl border border-base-200 flex flex-col overflow-hidden"
          role="document"
        >
          <header class="flex items-start justify-between gap-3 px-5 py-4 border-b border-base-200 shrink-0">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-base-content truncate">
                ${this.title.trim() || "Choose where to start"}
              </h2>
              <p class="text-xs text-ui-muted font-light mt-0.5">
                Scroll past copyright and front matter, then click the paragraph where the book starts.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle shrink-0"
              aria-label="Close preview"
              @click=${this.close}
            >
              ${icon(X, "w-4 h-4")}
            </button>
          </header>

          <div
            class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2 scrollbar-thin"
            role="listbox"
            aria-label="Document paragraphs"
          >
            ${
							this.paragraphs.length === 0
								? html`<p class="text-sm text-ui-muted text-center py-8">No text to preview.</p>`
								: this.paragraphs.map(
										(para, i) => html`
                  <button
                    type="button"
                    role="option"
                    aria-selected=${para.startWordIndex === this.selectedStartIndex}
                    class="w-full text-left rounded-xl px-3.5 py-3 transition-colors border touch-manipulation
                      ${
												para.startWordIndex === this.selectedStartIndex
													? "bg-primary/10 border-primary/40"
													: "bg-transparent border-transparent hover:bg-base-200/80 hover:border-base-300"
											}"
                    @click=${() => this.selectParagraph(para.startWordIndex)}
                  >
                    <div class="flex items-baseline justify-between gap-2 mb-1">
                      <span class="text-[10px] uppercase tracking-wider text-ui-muted-subtle font-medium">
                        ¶ ${i + 1}
                      </span>
                      <span class="text-[10px] font-mono text-ui-muted-subtle">
                        word ${para.startWordIndex.toLocaleString()}
                      </span>
                    </div>
                    <p class="text-sm text-base-content/80 font-light leading-relaxed whitespace-pre-wrap">
                      ${this.snippet(para.text)}
                    </p>
                  </button>
                `,
									)
						}
          </div>

          <footer class="shrink-0 border-t border-base-200 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <p class="text-xs text-ui-muted font-mono">
              ${
								this.selectedStartIndex === 0
									? `Start at beginning · ${this.totalWords.toLocaleString()} words`
									: `From word ${this.selectedStartIndex.toLocaleString()} · ${remaining.toLocaleString()} left`
							}
              ${
								selectedPara && this.selectedStartIndex > 0
									? html`<span class="text-ui-muted-subtle"> · ¶ ${this.paragraphs.indexOf(selectedPara) + 1}</span>`
									: ""
							}
            </p>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                @click=${() => this.startFrom(0)}
              >From beginning</button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                data-umami-event="preview-start"
                ?disabled=${this.paragraphs.length === 0}
                @click=${() => this.startFrom(this.selectedStartIndex)}
              >Start from here</button>
            </div>
          </footer>
        </div>
      </speeedy-dialog>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"start-preview-dialog": StartPreviewDialog;
	}
}
