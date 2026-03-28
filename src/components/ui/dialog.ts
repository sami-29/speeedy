import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

/** Modal with shadow DOM + adopted document styles so slots and Tailwind work. */
@customElement("speeedy-dialog")
export class SpeeedyDialog extends LitElement {
	@property({ type: Boolean, reflect: true }) open = false;
	@property({ type: Boolean }) dismissible = true;

	private _previouslyFocused: HTMLElement | null = null;

	override connectedCallback() {
		super.connectedCallback();
		this._adoptDocumentStyles();
	}

	private _adoptDocumentStyles() {
		const shadow = this.shadowRoot;
		if (!shadow) return;

		const accessibleSheets = Array.from(document.styleSheets).filter((s) => {
			try {
				return s.cssRules !== null;
			} catch {
				return false;
			}
		});

		try {
			shadow.adoptedStyleSheets = accessibleSheets as CSSStyleSheet[];
			return;
		} catch {
			/* adopt failed */
		}

		try {
			const constructed = accessibleSheets.map((s) => {
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(
					Array.from(s.cssRules)
						.map((r) => r.cssText)
						.join("\n"),
				);
				return sheet;
			});
			shadow.adoptedStyleSheets = constructed;
		} catch {
			Array.from(document.styleSheets).forEach((s) => {
				if (s.href) {
					const link = document.createElement("link");
					link.rel = "stylesheet";
					link.href = s.href;
					shadow.appendChild(link);
				}
			});
		}
	}

	override updated(changed: Map<string | number | symbol, unknown>) {
		if (changed.has("open")) {
			if (this.open) {
				this._onOpen();
			} else {
				this._onClose();
			}
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this._removeListeners();
		this._unlockScroll();
	}

	private _onOpen() {
		this._previouslyFocused = document.activeElement as HTMLElement | null;
		this._lockScroll();
		this._addListeners();
		requestAnimationFrame(() => {
			const focusable = this._getFocusable();
			if (focusable.length > 0) {
				focusable[0].focus();
			} else {
				this.shadowRoot?.querySelector<HTMLElement>('[role="dialog"]')?.focus();
			}
		});
	}

	private _onClose() {
		this._removeListeners();
		this._unlockScroll();
		if (
			this._previouslyFocused &&
			typeof this._previouslyFocused.focus === "function"
		) {
			this._previouslyFocused.focus();
		}
		this._previouslyFocused = null;
	}

	private _addListeners() {
		document.addEventListener("keydown", this._handleKeyDown);
	}

	private _removeListeners() {
		document.removeEventListener("keydown", this._handleKeyDown);
	}

	private _lockScroll() {
		const scrollbarWidth =
			window.innerWidth - document.documentElement.clientWidth;
		document.body.style.overflow = "hidden";
		if (scrollbarWidth > 0) {
			document.body.style.paddingRight = `${scrollbarWidth}px`;
		}
	}

	private _unlockScroll() {
		document.body.style.overflow = "";
		document.body.style.paddingRight = "";
	}

	private _getFocusable(): HTMLElement[] {
		const selector = [
			"a[href]",
			"button:not([disabled])",
			"textarea:not([disabled])",
			"input:not([disabled])",
			"select:not([disabled])",
			'[tabindex]:not([tabindex="-1"])',
		].join(", ");
		return Array.from(this.querySelectorAll<HTMLElement>(selector));
	}

	private _handleKeyDown = (e: KeyboardEvent) => {
		if (!this.open) return;

		if (e.key === "Escape") {
			if (this.dismissible) {
				e.preventDefault();
				this._requestClose();
			}
			return;
		}

		if (e.key === "Tab") {
			const focusable = this._getFocusable();
			if (focusable.length === 0) {
				e.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}
	};

	private _handleBackdropClick = (e: MouseEvent) => {
		if (e.target === e.currentTarget && this.dismissible) {
			this._requestClose();
		}
	};

	private _requestClose() {
		this.dispatchEvent(
			new CustomEvent("speeedy-dialog-close", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render() {
		if (!this.open) return html``;

		return html`
      <style>:host { display: contents; }</style>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none"
      >
        <div
          class="absolute inset-0 bg-base-300/60 backdrop-blur-md pointer-events-auto"
          @click=${this._handleBackdropClick}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          class="relative pointer-events-auto"
          tabindex="-1"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <slot></slot>
        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"speeedy-dialog": SpeeedyDialog;
	}
}
