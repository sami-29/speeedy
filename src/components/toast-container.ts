import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
}

const TOAST_DURATION_MS = 4000;

@customElement("toast-container")
export class ToastContainer extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@state() private toasts: Toast[] = [];

	override connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("speeedy:toast", this.handleToast);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener("speeedy:toast", this.handleToast);
	}

	private handleToast = (e: Event): void => {
		const { message, type } = (
			e as CustomEvent<{ message: string; type: ToastType }>
		).detail;
		const id = crypto.randomUUID();
		this.toasts = [...this.toasts, { id, message, type }];
		setTimeout(() => this.dismiss(id), TOAST_DURATION_MS);
	};

	private dismiss(id: string): void {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	override render() {
		if (this.toasts.length === 0) return html``;

		return html`
      <div class="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
        ${this.toasts.map(
					(t) => html`
          <div class="alert shadow-lg pointer-events-auto max-w-sm w-max px-4 py-2.5
            ${t.type === "success" ? "alert-success" : ""}
            ${t.type === "error" ? "alert-error" : ""}
            ${t.type === "warning" ? "alert-warning" : ""}
            ${t.type === "info" ? "alert-info" : ""}
          ">
            ${this.renderIcon(t.type)}
            <span class="text-sm font-light">${t.message}</span>
            <button
              class="btn btn-ghost btn-xs btn-circle ml-1"
              @click=${() => this.dismiss(t.id)}
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        `,
				)}
      </div>
    `;
	}

	private renderIcon(type: ToastType) {
		const classes = "w-4 h-4 shrink-0";
		if (type === "success")
			return html`
      <svg class="${classes}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>`;
		if (type === "error")
			return html`
      <svg class="${classes}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>`;
		if (type === "warning")
			return html`
      <svg class="${classes}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>`;
		return html`
      <svg class="${classes}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"toast-container": ToastContainer;
	}
}
