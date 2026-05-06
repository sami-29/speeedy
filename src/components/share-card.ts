import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ShareData } from "../models/types.js";
import { formatDuration, formatNumber } from "../services/stats-service.js";

@customElement("share-card")
export class ShareCard extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) data!: ShareData;

	override render() {
		const d = this.data;
		const wpms = d.recentWpms ?? [];

		return html`
      <div
        id="share-card-inner"
        class="rounded-2xl font-sans overflow-hidden"
        style="
          background: linear-gradient(145deg, #0a0a14 0%, #111128 50%, #0d0d1f 100%);
          width: 480px;
          padding: 32px;
          box-sizing: border-box;
        "
      >
        <!-- Header: avatar + name -->
        <div class="flex items-center gap-4 mb-8">
          ${
						d.avatarImage
							? html`
              <div style="
                width: 72px; height: 72px; border-radius: 50%;
                overflow: hidden; flex-shrink: 0;
                border: 2px solid rgba(255,255,255,0.15);
                box-shadow: 0 0 0 4px rgba(255,255,255,0.05);
              ">
                <img src=${d.avatarImage} alt="Avatar" style="width:100%;height:100%;object-fit:cover;" />
              </div>`
							: html`
              <div style="
                width: 72px; height: 72px; border-radius: 50%; flex-shrink: 0;
                background: rgba(255,255,255,0.07);
                border: 2px solid rgba(255,255,255,0.12);
                display: flex; align-items: center; justify-content: center;
                font-size: 36px; line-height: 1;
              ">${d.avatarEmoji}</div>`
					}
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 22px; font-weight: 600; color: #fff; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${d.displayName}</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 0.18em; margin-top: 4px; text-transform: uppercase;">Speeedy Reader</div>
          </div>
          <!-- Wordmark -->
          <div style="font-size: 13px; font-weight: 300; letter-spacing: 0.3em; color: rgba(255,255,255,0.15); flex-shrink: 0;">speeedy</div>
        </div>

        <!-- Hero stat: Avg WPM -->
        ${
					d.avgWpm > 0
						? html`
          <div style="
            background: linear-gradient(135deg, rgba(230,57,70,0.15) 0%, rgba(230,57,70,0.05) 100%);
            border: 1px solid rgba(230,57,70,0.25);
            border-radius: 16px;
            padding: 20px 24px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          ">
            <div>
              <div style="font-size: 48px; font-weight: 200; color: #fff; line-height: 1; letter-spacing: -0.02em;">${d.avgWpm}</div>
              <div style="font-size: 11px; color: rgba(255,255,255,0.4); letter-spacing: 0.15em; margin-top: 6px; text-transform: uppercase;">Words per minute</div>
            </div>
            <div style="font-size: 40px; opacity: 0.6;">⚡</div>
          </div>`
						: ""
				}

        <!-- Stats grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px;">
          ${this.renderStat(formatNumber(d.totalWordsRead), "Words Read", "📖")}
          ${this.renderStat(formatDuration(d.totalTimeMs), "Time Spent", "⏱")}
          ${this.renderStat(d.currentStreak > 0 ? `${d.currentStreak}` : "—", "Day Streak", "🔥")}
        </div>

        <!-- Best streak row -->
        ${
					d.bestStreak > 0
						? html`
          <div style="
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 12px;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
          ">
            <span style="font-size: 12px; color: rgba(255,255,255,0.4); letter-spacing: 0.1em; text-transform: uppercase;">Best Streak</span>
            <span style="font-size: 18px; font-weight: 300; color: #fff;">${d.bestStreak} days 🏆</span>
          </div>`
						: ""
				}

        <!-- Mini WPM chart -->
        ${wpms.length >= 2 ? this.renderMiniChart(wpms) : ""}

        <!-- Footer -->
        <div style="margin-top: 20px; font-size: 10px; color: rgba(255,255,255,0.18); text-align: center; letter-spacing: 0.25em; text-transform: uppercase;">speeedy.pages.dev · read faster, every day</div>
      </div>
    `;
	}

	private renderStat(value: string, label: string, emoji: string) {
		return html`
      <div style="
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 14px;
        padding: 16px 12px;
        text-align: center;
      ">
        <div style="font-size: 11px; margin-bottom: 6px;">${emoji}</div>
        <div style="font-size: 20px; font-weight: 300; color: #fff; line-height: 1;">${value}</div>
        <div style="font-size: 10px; color: rgba(255,255,255,0.35); margin-top: 5px; letter-spacing: 0.1em; text-transform: uppercase;">${label}</div>
      </div>
    `;
	}

	private renderMiniChart(wpms: number[]) {
		const max = Math.max(...wpms);
		const min = Math.min(...wpms);
		const range = max - min || 1;
		const w = 416; // matches 480px card - 2*32px padding
		const h = 52;
		const pts = wpms
			.map((v, i) => {
				const x = (i / (wpms.length - 1)) * w;
				const y = h - ((v - min) / range) * (h - 4) - 2;
				return `${x},${y}`;
			})
			.join(" ");

		const firstPt = wpms[0];
		const firstX = 0;
		const lastX = w;
		const firstY = h - ((firstPt - min) / range) * (h - 4) - 2;
		const areaPath = `M${firstX},${firstY} ${pts} L${lastX},${h} L${firstX},${h} Z`;

		return html`
      <div style="margin-bottom: 4px;">
        <div style="font-size: 10px; color: rgba(255,255,255,0.25); letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 8px;">WPM Trend</div>
        <svg viewBox="0 0 ${w} ${h}" style="width: 100%; height: 52px; display: block;">
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#e63946" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="#e63946" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#chart-fill)" />
          <polyline
            points="${pts}"
            fill="none"
            stroke="#e63946"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"share-card": ShareCard;
	}
}
