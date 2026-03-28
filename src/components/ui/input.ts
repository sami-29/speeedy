import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * <speeedy-input
 *   label="Title"
 *   placeholder="Pasted Text"
 *   .value=${val}
 *   @change=${handler}
 * ></speeedy-input>
 *
 * A Radix-UI-inspired text input with label, optional hint, and error state.
 * Emits a native 'change' event with detail: { value: string }.
 */
@customElement("speeedy-input")
export class SpeeedyInput extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) label = "";
	@property({ type: String }) value = "";
	@property({ type: String }) placeholder = "";
	@property({ type: String }) type: "text" | "email" | "number" | "password" =
		"text";
	@property({ type: String }) hint = "";
	@property({ type: String }) error = "";
	@property({ type: Boolean }) disabled = false;
	@property({ type: Boolean }) readonly = false;
	@property({ type: String }) size: "sm" | "md" = "md";
	@property({ type: String }) id = "";
	/** Extra classes forwarded to the <input> element */
	@property({ type: String, attribute: "input-class" }) inputClass = "";

	private handleInput(e: InputEvent) {
		const val = (e.target as HTMLInputElement).value;
		this.value = val;
		this.dispatchEvent(
			new CustomEvent("change", {
				detail: { value: val },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render() {
		const inputId =
			this.id || `speeedy-input-${Math.random().toString(36).slice(2, 7)}`;
		const sizeClass =
			this.size === "sm" ? "h-8 text-xs px-2.5" : "h-9 text-sm px-3";
		const stateClass = this.error
			? "border-error/60 focus:border-error focus:ring-error/20"
			: "border-base-content/15 focus:border-primary/60 focus:ring-primary/15";

		return html`
      <div class="flex flex-col gap-1.5">
        ${
					this.label
						? html`
          <label
            for=${inputId}
            class="text-xs font-medium text-ui-muted tracking-wide select-none"
          >${this.label}</label>
        `
						: ""
				}
        <input
          id=${inputId}
          type=${this.type}
          .value=${this.value}
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          ?readonly=${this.readonly}
          @input=${this.handleInput}
          class="
            w-full rounded-lg border bg-base-100
            ${sizeClass} ${stateClass} ${this.inputClass}
            font-light text-base-content placeholder:text-base-content/30
            transition-[border-color,box-shadow] duration-150
            focus:outline-none focus:ring-2
            disabled:opacity-50 disabled:cursor-not-allowed
            read-only:bg-base-200/50 read-only:cursor-default
          "
        />
        ${
					this.error
						? html`
          <p class="text-xs text-error">${this.error}</p>
        `
						: this.hint
							? html`
          <p class="text-xs text-ui-muted-subtle">${this.hint}</p>
        `
							: ""
				}
      </div>
    `;
	}
}

/**
 * <speeedy-textarea
 *   label="Text to read"
 *   placeholder="Paste your text here…"
 *   .value=${val}
 *   @change=${handler}
 * ></speeedy-textarea>
 *
 * A Radix-UI-inspired textarea with label and optional hint/error.
 * Emits a native 'change' event with detail: { value: string }.
 */
@customElement("speeedy-textarea")
export class SpeeedyTextarea extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: String }) label = "";
	@property({ type: String }) value = "";
	@property({ type: String }) placeholder = "";
	@property({ type: String }) hint = "";
	@property({ type: String }) error = "";
	@property({ type: Boolean }) disabled = false;
	@property({ type: Boolean }) readonly = false;
	@property({ type: String }) id = "";
	@property({ type: String }) minHeight = "7rem";
	@property({ type: String }) maxHeight = "14rem";
	/** Extra classes forwarded to the <textarea> element */
	@property({ type: String, attribute: "textarea-class" }) textareaClass = "";

	private handleInput(e: InputEvent) {
		const val = (e.target as HTMLTextAreaElement).value;
		this.value = val;
		this.dispatchEvent(
			new CustomEvent("change", {
				detail: { value: val },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render() {
		const inputId =
			this.id || `speeedy-textarea-${Math.random().toString(36).slice(2, 7)}`;
		const stateClass = this.error
			? "border-error/60 focus:border-error focus:ring-error/20"
			: "border-base-content/15 focus:border-primary/60 focus:ring-primary/15";

		return html`
      <div class="flex flex-col gap-1.5">
        ${
					this.label
						? html`
          <label
            for=${inputId}
            class="text-xs font-medium text-ui-muted tracking-wide select-none"
          >${this.label}</label>
        `
						: ""
				}
        <textarea
          id=${inputId}
          .value=${this.value}
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          ?readonly=${this.readonly}
          @input=${this.handleInput}
          style="min-height: ${this.minHeight}; max-height: ${this.maxHeight};"
          class="
            w-full rounded-lg border bg-base-100
            px-3 py-2.5 text-sm ${stateClass} ${this.textareaClass}
            font-light text-base-content placeholder:text-base-content/30
            leading-relaxed
            transition-[border-color,box-shadow] duration-150
            focus:outline-none focus:ring-2
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        ></textarea>
        ${
					this.error
						? html`
          <p class="text-xs text-error">${this.error}</p>
        `
						: this.hint
							? html`
          <p class="text-xs text-ui-muted-subtle">${this.hint}</p>
        `
							: ""
				}
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-input": SpeeedyInput;
		"speeedy-textarea": SpeeedyTextarea;
	}
}
