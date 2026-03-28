import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

interface WpmRow {
	range: string;
	label: string;
	pct: number; // bar width %
	color: "green" | "amber" | "red" | "base";
}

const ROWS: WpmRow[] = [
	{ range: "50–150", label: "Struggling or new reader", pct: 10, color: "red" },
	{
		range: "200–250",
		label: "Average adult (Brysbaert, 2019)",
		pct: 28,
		color: "base",
	},
	{ range: "250–300", label: "College student", pct: 36, color: "base" },
	{
		range: "300–400",
		label: "Academic / professional",
		pct: 48,
		color: "green",
	},
	{
		range: "350–500",
		label: "RSVP-trained reader (with pausing)",
		pct: 62,
		color: "green",
	},
	{
		range: "500–700",
		label: "Advanced RSVP — comprehension trade-offs likely",
		pct: 80,
		color: "amber",
	},
	{
		range: "700+",
		label: "Competition skimming — significant comprehension loss",
		pct: 100,
		color: "red",
	},
];

const COLOR_MAP = {
	green: "oklch(0.72 0.17 145)",
	amber: "oklch(0.75 0.15 75)",
	red: "oklch(0.65 0.2 25)",
	base: "oklch(0.65 0.04 250)",
};

@customElement("learn-wpm-chart")
export class LearnWpmChart extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	private _obs: IntersectionObserver | null = null;

	override connectedCallback(): void {
		super.connectedCallback();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this._obs?.disconnect();
	}

	protected override firstUpdated(): void {
		requestAnimationFrame(() => requestAnimationFrame(() => this._initBars()));
	}

	private _initBars(): void {
		const fills = Array.from(
			this.querySelectorAll<HTMLElement>(".learn-bar-fill"),
		);
		if (!fills.length) return;

		this._obs = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						fills.forEach((el, i) => {
							setTimeout(() => el.classList.add("visible"), i * 80);
						});
						this._obs?.disconnect();
					}
				}
			},
			{ threshold: 0.05, rootMargin: "0px 0px -20px 0px" },
		);
		const container = this.querySelector(".wpm-chart-container");
		if (container) this._obs.observe(container);
		else this._obs.observe(fills[0]);
	}

	override render() {
		return html`
      <div class="wpm-chart-container mb-4" style="display: flex; flex-direction: column; gap: 6px;">
        ${ROWS.map(
					(row) => html`
          <div style="display: flex; align-items: center; gap: 10px; height: 22px;">
            <span class="font-mono text-xs text-ui-muted font-medium shrink-0 text-right" style="width: 5rem;">${row.range}</span>
            <div style="flex: 1; height: 18px; border-radius: 3px; overflow: hidden; background: oklch(var(--bc) / 0.08);">
              <div
                class="learn-bar-fill"
                style="--bar-width: ${row.pct}%; background: ${COLOR_MAP[row.color]}; opacity: 0.8; height: 100%; border-radius: 3px;"
              ></div>
            </div>
            <span class="wpm-label text-xs text-ui-muted font-light" style="width: 14rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${row.label}</span>
          </div>
        `,
				)}
      </div>
      <div class="sm:hidden space-y-1 mb-4">
        ${ROWS.map(
					(row) => html`
          <div class="flex items-start gap-2 text-xs text-ui-muted font-light">
            <span class="font-mono text-ui-muted font-medium shrink-0 w-20 text-right">${row.range}</span>
            <span>${row.label}</span>
          </div>
        `,
				)}
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"learn-wpm-chart": LearnWpmChart;
	}
}
