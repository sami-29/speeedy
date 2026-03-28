import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("global-tooltip")
export class GlobalTooltip extends LitElement {
	static styles = css`
    :host {
      display: block;
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease-out;
    }
    :host(.visible) {
      opacity: 1;
    }
    .tip-box {
      background: #1e1e1e;
      color: #fff;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 300;
      line-height: 1.5;
      max-width: 200px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      position: relative;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .arrow {
      position: absolute;
      width: 8px;
      height: 8px;
      background: #1e1e1e;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      border-right: 1px solid rgba(255,255,255,0.1);
      transform: rotate(45deg);
      bottom: -4px;
      left: calc(50% - 4px);
    }
    :host(.side-right) .arrow {
      left: -4px;
      bottom: auto;
      top: calc(50% - 4px);
      transform: rotate(135deg);
      border-bottom: 0;
      border-right: 0;
      border-top: 1px solid rgba(255,255,255,0.1);
      border-left: 1px solid rgba(255,255,255,0.1);
    }
  `;

	@state() private text = "";

	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener(
			"speeedy:show-tooltip",
			this.handleShow as EventListener,
		);
		window.addEventListener("speeedy:hide-tooltip", this.handleHide);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener(
			"speeedy:show-tooltip",
			this.handleShow as EventListener,
		);
		window.removeEventListener("speeedy:hide-tooltip", this.handleHide);
	}

	private handleShow = (
		e: CustomEvent<{ text: string; target: HTMLElement }>,
	) => {
		this.text = e.detail.text;
		const rect = e.detail.target.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const isMobile = vw < 768;

		this.classList.remove("side-right");

		if (isMobile) {
			const tipWidth = 200;
			const spaceRight = vw - rect.right - 12;

			if (spaceRight >= tipWidth) {
				this.style.left = `${rect.right + 8}px`;
				this.style.top = `${rect.top + rect.height / 2}px`;
				this.style.transformOrigin = "left center";
				this.style.transform = "translateY(-50%)";
				this.classList.add("side-right");
			} else {
				this.style.left = `${Math.min(rect.left + rect.width / 2, vw - tipWidth / 2 - 12)}px`;
				this.style.top = `${Math.max(rect.top - 8, 8)}px`;
				this.style.transformOrigin = "bottom center";
				this.style.transform = "translate(-50%, -100%)";
			}
		} else {
			const tipWidth = 200;
			let left = rect.left + rect.width / 2;
			left = Math.max(tipWidth / 2 + 8, Math.min(left, vw - tipWidth / 2 - 8));
			const top = Math.max(rect.top - 8, 8);
			this.style.left = `${left}px`;
			this.style.top = `${top}px`;
			this.style.transformOrigin = "bottom center";
			this.style.transform = "translate(-50%, -100%)";
			const arrowEl = this.shadowRoot?.querySelector(
				".arrow",
			) as HTMLElement | null;
			if (arrowEl) {
				const offset = rect.left + rect.width / 2 - left;
				arrowEl.style.left = `calc(50% + ${offset}px - 4px)`;
			}
		}

		requestAnimationFrame(() => {
			const box = this.getBoundingClientRect();
			if (box.top < 4) {
				this.style.top = `${rect.bottom + 8}px`;
				this.style.transformOrigin = "top center";
				this.style.transform = "translate(-50%, 0%)";
			}
			if (box.bottom > vh - 4) {
				this.style.top = `${vh - box.height - 8}px`;
				this.style.transform = "translate(-50%, 0%)";
			}
		});

		this.classList.add("visible");
	};

	private handleHide = () => {
		this.classList.remove("visible");
	};

	render() {
		return html`
      <div class="tip-box">
        ${this.text}
        <div class="arrow"></div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"global-tooltip": GlobalTooltip;
	}
}
