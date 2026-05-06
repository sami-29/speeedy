import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Check, Copy, ExternalLink, Heart, Star } from "lucide";
import QRCode from "qrcode";
import { DONATION_WALLETS, SUPPORTERS } from "../services/donation-service.js";
import { icon } from "../utils/icons.js";
import "./ui/page-nav.js";

const BOUNTIES = [
	{
		title: "Cloud library sync",
		desc: "Sync reading progress and library across devices via a self-hostable backend or Obsidian.",
		effort: "Large",
	},
	{
		title: "Browser extension",
		desc: "Select any text on any webpage and read it in Speeedy RSVP mode.",
		effort: "Medium",
	},
	{
		title: "Mobile app wrapper",
		desc: "A proper PWA-native mobile shell for iOS and Android with share integration.",
		effort: "Large",
	},
];

@customElement("donate-page")
export class DonatePage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@state() private copiedAddress = "";
	@state() private qrDataUrls: Record<string, string> = {};

	override async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.generateQrCodes();
	}

	private async generateQrCodes(): Promise<void> {
		const urls: Record<string, string> = {};
		for (const w of DONATION_WALLETS) {
			try {
				const dataUrl = await QRCode.toDataURL(w.address, {
					width: 140,
					margin: 1,
				});
				urls[w.address] = dataUrl;
			} catch {}
		}
		this.qrDataUrls = urls;
	}

	private async copyAddress(address: string): Promise<void> {
		await navigator.clipboard.writeText(address);
		this.copiedAddress = address;
		setTimeout(() => {
			this.copiedAddress = "";
		}, 2000);
	}

	override render() {
		return html`
      <div class="min-h-screen bg-base-100">
        <!-- Nav -->
        <speeedy-page-nav label="Support Speeedy" back-href="#/" sticky></speeedy-page-nav>

        <main class="max-w-2xl mx-auto px-6 py-14 flex flex-col gap-14">

          <!-- Hero -->
          <div class="flex flex-col gap-4">
            <p class="text-xs tracking-[0.5em] uppercase text-ui-muted-subtle font-medium">Open source · Free forever</p>
            <h1 class="text-3xl md:text-4xl font-extralight text-base-content leading-tight">
              Speeedy is built in the open.<br/>
              <span class="font-semibold">Your support keeps it that way.</span>
            </h1>
            <p class="text-ui-muted text-sm font-light leading-relaxed max-w-lg">
              No subscriptions. No ads. No cookies. Every feature is free and the source code is public.
              If Speeedy has saved you time or made reading more comfortable, any contribution is appreciated.
            </p>
          </div>

          <!-- Crypto donations (primary, open) -->
          <div class="flex flex-col gap-3">
            <p class="text-xs tracking-[0.5em] uppercase text-ui-muted-subtle font-medium">Crypto donation</p>
            <div class="border border-base-200 rounded-xl p-5 flex flex-col gap-4">
              <p class="text-xs text-ui-muted font-light">Instant and onchain. Copy an address or scan the QR code.</p>
              <div class="flex flex-col gap-3">
                ${DONATION_WALLETS.map((w) => this.renderWallet(w))}
              </div>
            </div>
          </div>

          <!-- Bank / Other -->
          <div class="border border-base-200 rounded-xl p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-base-content">Bank transfer or other</span>
              <span class="text-xs text-ui-muted-subtle font-light">Get in touch</span>
            </div>
            <p class="text-sm text-ui-muted font-light leading-relaxed">
              Prefer a bank transfer, PayPal, or another method? Send an email and we can sort it out.
            </p>
            <a
              href="mailto:sami.bentaleb.dev@gmail.com?subject=Speeedy%20Support"
              class="btn btn-outline btn-sm w-fit gap-2"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
              sami.bentaleb.dev@gmail.com
            </a>
          </div>

          <!-- Other ways to contribute -->
          <div class="border border-base-200 rounded-xl p-5 flex flex-col gap-3">
            <span class="text-sm font-medium text-base-content">Other ways to contribute</span>
            <ul class="flex flex-col gap-2">
              ${[
								"Star the repo on GitHub so more people can find it.",
								"Report bugs or suggest features. Every piece of feedback shapes the next release.",
								"Share your reading progress in ADHD, study, or productivity communities.",
								"Contribute code. Pull requests are welcome.",
							].map(
								(item) => html`
                  <li class="flex items-start gap-2.5 text-sm text-ui-muted font-light leading-relaxed">
                    <span class="text-primary mt-0.5 shrink-0">+</span>
                    <span>${item}</span>
                  </li>
                `,
							)}
            </ul>
          </div>

          <!-- Feature Bounties -->
          ${this.renderBounties()}

          ${this.renderSupportersWall()}

          <div class="border border-base-200/60 rounded-xl p-5 flex flex-col gap-3 bg-base-200/20">
            <p class="text-xs tracking-[0.4em] uppercase text-ui-muted-subtle font-medium">Appear on the supporters wall</p>
            <ol class="flex flex-col gap-2.5">
              ${[
								"Send any amount to one of the crypto addresses above, or via bank transfer.",
								"Email sami.bentaleb.dev@gmail.com with your preferred display name after contributing.",
							].map(
								(step, i) => html`
                <li class="flex items-start gap-3 text-sm text-ui-muted font-light leading-relaxed">
                  <span class="font-mono text-xs text-ui-muted-subtle mt-0.5 shrink-0 w-4">${i + 1}.</span>
                  <span>${step}</span>
                </li>
              `,
							)}
            </ol>
          </div>

        </main>
      </div>
    `;
	}

	private renderBounties() {
		return html`
      <div class="flex flex-col gap-4">
        <div>
          <p class="text-xs tracking-[0.5em] uppercase text-ui-muted-subtle font-medium mb-1">Fund future features</p>
          <p class="text-sm text-ui-muted font-light leading-relaxed">
            These are features on the roadmap. Contributions help fund the time needed to build them.
          </p>
        </div>
        <div class="flex flex-col gap-3">
          ${BOUNTIES.map(
						(b) => html`
            <div class="rounded-xl border border-base-200 px-4 py-3 flex items-start justify-between gap-4">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  ${icon(Star, "w-3 h-3 text-warning shrink-0")}
                  <span class="text-sm font-medium text-base-content">${b.title}</span>
                </div>
                <p class="text-xs text-ui-muted font-light leading-relaxed">${b.desc}</p>
              </div>
              <span class="text-[0.65rem] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border border-base-200 text-ui-muted-subtle shrink-0 whitespace-nowrap">${b.effort}</span>
            </div>
          `,
					)}
        </div>
        <a
          href="mailto:sami.bentaleb.dev@gmail.com?subject=Speeedy%20feature%20bounty"
          class="btn btn-primary btn-sm rounded-full w-fit gap-2 self-start"
          data-umami-event="donate-bounty-cta-click"
        >
          ${icon(Heart, "w-3.5 h-3.5")} Email about funding a feature
        </a>
      </div>
    `;
	}

	private renderWallet(w: (typeof DONATION_WALLETS)[0]) {
		const isCopied = this.copiedAddress === w.address;
		const qrUrl = this.qrDataUrls[w.address];
		return html`
      <div class="flex flex-col gap-2 border-t border-base-200/60 pt-3 first:border-t-0 first:pt-0">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm font-semibold text-base-content">${w.symbol}</span>
            <span class="text-xs text-ui-muted-subtle font-light">${w.label}</span>
          </div>
          <a
            href="${w.explorerUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-ghost btn-xs gap-1 text-ui-muted"
            aria-label="View ${w.symbol} wallet on explorer"
          >
            ${icon(ExternalLink, "w-3 h-3")}
          </a>
        </div>
        <div class="flex items-start gap-3">
          ${
						qrUrl
							? html`
            <div class="shrink-0 p-1.5 bg-white rounded-md border border-base-200">
              <img src="${qrUrl}" alt="QR code for ${w.symbol} address" class="w-[72px] h-[72px]" />
            </div>
          `
							: ""
					}
          <div class="flex-1 flex flex-col gap-1.5 min-w-0">
            <div class="flex items-center gap-2">
              <code class="flex-1 font-mono text-xs text-base-content bg-base-200/50 px-2.5 py-1.5 rounded-lg overflow-x-auto whitespace-nowrap select-all">
                ${w.address}
              </code>
              <button
                class="btn btn-sm btn-ghost shrink-0"
                @click=${() => void this.copyAddress(w.address)}
                title="Copy ${w.symbol} address"
                aria-label="${isCopied ? "Copied!" : `Copy ${w.symbol} address`}"
              >
                ${
									isCopied
										? html`${icon(Check, "w-4 h-4 text-success")}`
										: html`${icon(Copy, "w-4 h-4")}`
								}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
	}

	private renderSupportersWall() {
		return html`
      <div class="flex flex-col gap-5">
        <p class="text-xs tracking-[0.5em] uppercase text-ui-muted-subtle font-medium">Supporters</p>

        ${
					SUPPORTERS.length === 0
						? html`
          <div class="rounded-2xl border border-dashed border-base-300 p-10 text-center">
            <p class="text-sm text-ui-muted font-light">
              No supporters yet. Be the first.
            </p>
          </div>
        `
						: html`
          <div class="grid sm:grid-cols-2 gap-3">
            ${SUPPORTERS.map(
							(s) => html`
              <div class="rounded-xl border border-base-200 px-4 py-3 flex items-center justify-between gap-3">
                <div class="flex flex-col min-w-0">
                  <span class="text-sm font-medium text-base-content truncate">${s.name}</span>
                  <span class="text-xs text-ui-muted font-mono">${s.chain} · ${s.amount}</span>
                </div>
                ${
									s.txHash
										? html`
                  <a
                    href="${
											s.chain === "ETH"
												? `https://etherscan.io/tx/${s.txHash}`
												: s.chain === "SOL"
													? `https://solscan.io/tx/${s.txHash}`
													: s.chain === "BTC"
														? `https://mempool.space/tx/${s.txHash}`
														: ""
										}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn btn-ghost btn-xs"
                    title="View on-chain"
                  >
                    ${icon(ExternalLink, "w-3 h-3")}
                  </a>
                `
										: ""
								}
              </div>
            `,
						)}
          </div>
        `
				}
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"donate-page": DonatePage;
	}
}
