import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ArrowRight, Heart, Zap } from "lucide";

const githubIcon = (cls: string) =>
	html`<svg class=${cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>`;

import { animate, hover, inView } from "motion";
import { GITHUB_URL } from "../config.js";
import type { ThemeName, UserProfile } from "../models/types.js";
import { saveProfile } from "../services/storage-service.js";
import { applyTheme, getResolvedTheme } from "../services/theme-service.js";
import { emitProfileUpdated } from "../utils/events.js";
import { icon } from "../utils/icons.js";
import { initDataReveal } from "../utils/scroll-reveal.js";
import "./hero-rsvp-demo.js";
import "./orp-demo.js";

const FEATURES = [
	[
		"ORP alignment",
		"Every word snaps to its Optimal Recognition Point — the exact letter where your brain reads fastest.",
	],
	[
		"Smart pauses",
		"Long words get extra milliseconds. Sentence-end pauses let working memory consolidate.",
	],
	[
		"Peripheral context",
		"1–3 context words dimmed above and below. Stay oriented without losing focus.",
	],
	[
		"Dyslexia & Irlen modes",
		"OpenDyslexic font, extra spacing, tinted overlays (peach, mint, parchment).",
	],
	[
		"Arabic & CJK",
		"Intl.Segmenter tokenizes non-Latin scripts. Arabic renders RTL with full ligatures.",
	],
	[
		"Local-first",
		"Your reading data stays in your browser. No account. Export .speeedy backup anytime.",
	],
	[
		"Full keyboard",
		"Space = play/pause. Arrows = speed. R = restart. No mouse needed.",
	],
	[
		"Bionic mode",
		"Bold first letters anchor your eye. Use with RSVP and ORP together.",
	],
];

@customElement("marketing-page")
export class MarketingPage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) profile!: UserProfile;

	private cycleTheme(): void {
		const current: ThemeName = this.profile?.settings?.theme ?? "system";
		const effective =
			current === "system" ? getResolvedTheme(current) : current;
		const next: ThemeName = effective === "light" ? "dark" : "light";
		applyTheme(next);
		const updated: UserProfile = {
			...this.profile,
			settings: { ...this.profile.settings, theme: next },
		};
		saveProfile(updated);
		emitProfileUpdated(updated);
	}

	override connectedCallback(): void {
		super.connectedCallback();
		requestAnimationFrame(() => this._initMotion());
	}

	private _initMotion(): void {
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		initDataReveal(this);
		if (reduced) return;

		const heroEls = Array.from(
			this.querySelectorAll<HTMLElement>("[data-hero-item]"),
		);
		if (heroEls.length) {
			for (const el of heroEls) {
				el.style.opacity = "0";
				el.style.transform = "translateY(30px)";
			}
			for (let i = 0; i < heroEls.length; i++) {
				animate(
					heroEls[i],
					{
						opacity: [0, 1],
						transform: ["translateY(30px)", "translateY(0px)"],
					},
					{ delay: i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] },
				);
			}
		}

		const featRows = Array.from(
			this.querySelectorAll<HTMLElement>("[data-feat-row]"),
		);
		if (featRows.length) {
			for (const row of featRows) {
				row.style.opacity = "0";
				row.style.transform = "translateX(-16px)";
			}
			inView(
				this.querySelector("[data-feat-container]") ?? featRows[0],
				() => {
					for (let i = 0; i < featRows.length; i++) {
						animate(
							featRows[i],
							{
								opacity: [0, 1],
								transform: ["translateX(-16px)", "translateX(0px)"],
							},
							{ delay: i * 0.07, duration: 0.5, ease: [0.25, 1, 0.5, 1] },
						);
					}
				},
				{ amount: 0.1 },
			);
		}

		for (const el of this.querySelectorAll<HTMLElement>("[data-count-to]")) {
			const target = Number.parseInt(el.dataset.countTo ?? "0", 10);
			el.style.opacity = "0";
			inView(
				el,
				() => {
					animate(el, { opacity: [0, 1] }, { duration: 0.3 });
					let start = 0;
					const dur = 1400;
					const startTime = performance.now();
					const tick = (now: number) => {
						const elapsed = now - startTime;
						const progress = Math.min(elapsed / dur, 1);
						const eased = progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
						start = Math.round(eased * target);
						el.textContent = start.toString();
						if (progress < 1) requestAnimationFrame(tick);
						else el.textContent = el.dataset.countDisplay ?? target.toString();
					};
					requestAnimationFrame(tick);
				},
				{ amount: 0.5 },
			);
		}

		for (const row of this.querySelectorAll<HTMLElement>("[data-feat-row]")) {
			hover(row, () => {
				animate(
					row,
					{ transform: "translateX(6px)" },
					{ duration: 0.2, ease: [0.25, 1, 0.5, 1] },
				);
				return () =>
					animate(row, { transform: "translateX(0px)" }, { duration: 0.2 });
			});
		}

		const ctaBtn = this.querySelector<HTMLElement>("[data-cta-btn]");
		if (ctaBtn) {
			hover(ctaBtn, () => {
				animate(
					ctaBtn,
					{ transform: "scale(1.04)" },
					{ duration: 0.2, ease: [0.25, 1, 0.5, 1] },
				);
				return () =>
					animate(ctaBtn, { transform: "scale(1)" }, { duration: 0.15 });
			});
		}
	}

	private themeIcon(theme: ThemeName) {
		const effective = theme === "system" ? getResolvedTheme(theme) : theme;
		return effective === "dark"
			? html`<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
			: html`<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
	}

	private getBadgeUrls(theme: "light" | "dark") {
		return {
			ufind: `https://ufind.best/badges/ufind-best-badge-${theme === "dark" ? "dark" : "light"}.svg`,
			productHunt: `https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=speeedy&theme=${theme}`,
		};
	}

	override render() {
		const theme: ThemeName = this.profile?.settings?.theme ?? "system";
		const effectiveTheme = theme === "system" ? getResolvedTheme(theme) : theme;
		const badgeUrls = this.getBadgeUrls(effectiveTheme);
		const themeTitle =
			effectiveTheme === "dark" ? "Switch to light" : "Switch to dark";

		return html`
      <div class="min-h-screen flex flex-col bg-base-100 overflow-x-hidden">

        <!-- ── Nav ── -->
        <nav class="sticky top-0 z-50 px-6 md:px-12 py-4 flex items-center justify-between border-b border-base-300/60 bg-base-100/90 backdrop-blur-md">
          <div class="flex items-center gap-2">
            ${icon(Zap, "w-4 h-4 text-primary")}
            <span class="text-ui-body tracking-[0.25em] font-semibold text-base-content select-none uppercase">speeedy</span>
          </div>
          <div class="flex items-center gap-2">
            <a href=${GITHUB_URL} target="_blank" rel="noopener" class="btn btn-ghost btn-sm btn-circle" title="GitHub" aria-label="GitHub">
              ${githubIcon("w-6 h-6")}
            </a>
            <button class="btn btn-ghost btn-sm btn-circle" title=${themeTitle} @click=${this.cycleTheme} type="button">
              ${this.themeIcon(theme)}
            </button>
            <a href="#/app" class="btn btn-primary btn-sm rounded-full px-5 gap-1.5">
              Open app ${icon(ArrowRight, "w-3.5 h-3.5")}
            </a>
          </div>
        </nav>

        <!-- Hero -->
        <section class="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
          style="background: oklch(var(--b3, var(--b2)));">

          <!-- Background grid texture -->
          <div class="absolute inset-0 pointer-events-none"
            style="background-image: radial-gradient(color-mix(in oklab, var(--color-base-content) 8%, transparent) 1px, transparent 1px); background-size: 24px 24px;"></div>

          <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div style="width: 700px; height: 500px; background: radial-gradient(ellipse at center, oklch(var(--p) / 0.12) 0%, oklch(0.75 0.15 60 / 0.04) 50%, transparent 70%); border-radius: 50%;"></div>
          </div>

          <div class="relative z-10 flex flex-col items-center text-center px-6 py-20 w-full max-w-5xl mx-auto">

            <div data-hero-item class="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-4 py-1.5 text-ui-body tracking-[0.35em] uppercase text-primary font-semibold mkt-badge-shimmer">
              ${icon(Zap, "w-3 h-3 text-primary")}
              Rapid Serial Visual Presentation
            </div>

            <h1 data-hero-item class="mb-6 select-none text-ui-hero font-semibold text-base-content" style="letter-spacing: -0.02em;">
              <span class="block text-ui-muted-subtle font-normal">Read at</span>
              <span class="block font-mono">
                light<span class="text-primary">_</span>speed
              </span>
            </h1>

            <p data-hero-item class="text-ui-body text-ui-muted max-w-sm mb-10">
              One word. One fixed point.<br/>No eye movement. No distractions.
            </p>

            <div data-hero-item class="w-full max-w-2xl mb-10 rounded-2xl border border-primary/15 bg-base-100/5 backdrop-blur-sm px-8 py-10 overflow-hidden"
              style="box-shadow: 0 0 80px color-mix(in oklab, var(--color-primary) 12%, transparent), 0 0 30px color-mix(in oklab, var(--color-primary) 6%, transparent), inset 0 1px 0 color-mix(in oklab, var(--color-base-content) 8%, transparent);">
              <div class="mkt-hero-demo-wrap" style="max-width: 100%; overflow: hidden;">
                <hero-rsvp-demo></hero-rsvp-demo>
              </div>
            </div>

            <!-- CTAs -->
            <div data-hero-item class="flex flex-col sm:flex-row items-center gap-3">
              <a href="#/benchmark" data-cta-btn
                data-umami-event="marketing-benchmark-click"
                class="btn btn-primary btn-lg rounded-full px-12 gap-2 mkt-cta-glow"
                style="box-shadow: 0 0 30px color-mix(in oklab, var(--color-primary) 35%, transparent), 0 4px 16px color-mix(in oklab, var(--color-primary) 20%, transparent);">
                Take the speed test ${icon(ArrowRight, "w-4 h-4")}
              </a>
              <a href="#/app" class="btn btn-ghost btn-lg text-ui-muted hover:text-base-content text-ui-body">
                Open the reader
              </a>
            </div>

            <div data-hero-item class="mt-8 flex flex-wrap items-center justify-center gap-2">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-base-content/15 bg-base-content/5 px-3 py-1 text-ui-body tracking-wide text-ui-muted font-normal">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500/70 inline-block"></span>
                Free forever
              </span>
              <span class="inline-flex items-center gap-1.5 rounded-full border border-base-content/15 bg-base-content/5 px-3 py-1 text-ui-body tracking-wide text-ui-muted font-normal">
                <span class="w-1.5 h-1.5 rounded-full bg-sky-400/70 inline-block"></span>
                No account
              </span>
              <span class="inline-flex items-center gap-1.5 rounded-full border border-base-content/15 bg-base-content/5 px-3 py-1 text-ui-body tracking-wide text-ui-muted font-normal">
                <span class="w-1.5 h-1.5 rounded-full bg-violet-400/70 inline-block"></span>
                Open source · MIT
              </span>
              <span class="inline-flex items-center gap-1.5 rounded-full border border-base-content/15 bg-base-content/5 px-3 py-1 text-ui-body tracking-wide text-ui-muted font-normal">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-400/70 inline-block"></span>
                Reading data stays local
              </span>
            </div>
          </div>


        </section>

        <!-- Stats -->
        <section class="border-b border-base-300/60 py-0">
          <div class="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-base-300/60">

            <div class="py-14 px-10 flex flex-col items-center sm:items-start gap-1" data-reveal>
              <div class="flex items-end gap-2">
                <span class="text-ui-hero font-semibold tabular-nums leading-none font-mono"
                  style="color: oklch(0.72 0.14 55);"
                  data-count-to="238" data-count-display="238">238</span>
                <span class="text-ui-title font-normal mb-1 text-base-content">WPM</span>
              </div>
              <p class="text-ui-body text-ui-muted tracking-wide">average adult reading speed</p>
            </div>

            <div class="py-14 px-10 flex flex-col items-center sm:items-start gap-1 bg-primary/5" data-reveal>
              <div class="flex items-end gap-2">
                <span class="text-ui-hero font-semibold tabular-nums leading-none font-mono text-primary"
                  data-count-to="400" data-count-display="400+">400+</span>
                <span class="text-ui-title font-normal mb-1 text-primary/80">WPM</span>
              </div>
              <p class="text-ui-body text-ui-muted tracking-wide">with consistent RSVP practice</p>
            </div>

            <div class="py-14 px-10 flex flex-col items-center sm:items-start gap-1" data-reveal>
              <div class="flex items-end gap-2">
                <span class="text-ui-hero font-semibold tabular-nums leading-none font-mono"
                  style="color: oklch(0.72 0.08 195);"
                  data-count-to="10" data-count-display="~10%">~10%</span>
              </div>
              <p class="text-ui-body text-ui-muted tracking-wide">of reading time is pure eye movement</p>
            </div>

          </div>
          <div class="px-10 py-4 border-t border-base-300/50">
            <p class="text-ui-body text-ui-muted-subtle italic">Brysbaert (2019) · Rayner et al. (2016) · Masson (1983)</p>
          </div>
        </section>

        <!-- ORP Demo -->
        <section class="border-b border-base-300/60 py-20 px-6 md:px-12">
          <div class="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">

            <!-- Left: explanation -->
            <div data-reveal>
              <p class="text-ui-body tracking-[0.35em] uppercase mb-4 font-semibold text-primary/90">The pivot</p>
              <h2 class="text-ui-hero font-semibold text-base-content leading-tight mb-5">
                Every word has<br/><span class="font-semibold">a sweet spot.</span>
              </h2>
              <p class="text-ui-body text-ui-muted leading-[1.9] mb-4">
                O'Regan and Jacobs (1992) showed that word recognition is fastest when your eye lands on a specific letter —
                typically 1–2 letters left of center. Speeedy aligns every word on this
                <strong class="font-semibold text-base-content">Optimal Recognition Point</strong> so your brain processes each flash with less effort.
              </p>
              <a href="#/learn" class="text-ui-body text-primary underline underline-offset-2 hover:decoration-2">
                Read the full science →
              </a>
            </div>

            <!-- Right: interactive ORP demo -->
            <div data-reveal>
              <speeedy-orp-demo tone="accent" hint="hover any word"></speeedy-orp-demo>
            </div>
          </div>
        </section>

        <!-- Features -->
        <section class="py-24 px-6 md:px-12 border-b border-base-300/60 bg-base-200/25">
          <div class="max-w-5xl mx-auto">
            <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
              <div>
                <p class="text-ui-body tracking-[0.35em] uppercase text-primary/80 mb-3 font-semibold" data-reveal>What's inside</p>
                <h2 class="text-ui-hero font-semibold text-base-content leading-tight" data-reveal>
                  Everything you need,<br/><span class="font-semibold">nothing you don't.</span>
                </h2>
              </div>
              <a href="#/app" class="btn btn-outline btn-sm rounded-full px-6 self-start md:self-end shrink-0" data-reveal>
                Open the reader →
              </a>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0" data-feat-container>
              ${FEATURES.map(
								([title, desc], i) => html`
                <div data-feat-row
                  class="flex gap-0 items-stretch py-6 group cursor-default
                    ${i % 2 === 0 ? "md:pr-8 md:border-r border-base-300/50" : "md:pl-8"}
                    ${i < FEATURES.length - 2 ? "md:border-b border-base-300/50" : ""}
                    border-b border-base-300/50 md:border-b-0
                  ">
                  <!-- Accent line -->
                  <div class="w-0.5 mr-5 shrink-0 rounded-full overflow-hidden bg-base-300/50 relative">
                    <div class="absolute inset-0 origin-top scale-y-0 group-hover:scale-y-100 transition-transform duration-300"
                      style="background: oklch(var(--p));"></div>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline gap-2.5 mb-1">
                      <span class="text-ui-body font-mono select-none transition-colors duration-200 group-hover:text-primary/70 text-ui-muted-subtle">${String(i + 1).padStart(2, "0")}</span>
                      <h3 class="text-ui-title font-semibold text-base-content transition-colors duration-200 group-hover:text-primary">${title}</h3>
                    </div>
                    <p class="text-ui-body text-ui-muted leading-[1.85]">${desc}</p>
                  </div>
                </div>
              `,
							)}
            </div>
          </div>
        </section>

        <section class="py-28 px-6 border-b border-base-300/60 bg-base-200/25">
          <div class="max-w-3xl mx-auto">
            <div class="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-10 items-center">
              <div>
                <p class="text-ui-body tracking-[0.35em] uppercase text-primary/80 mb-4 font-semibold" data-reveal>Baseline test</p>
                <h2 class="text-ui-hero font-semibold text-base-content leading-tight mb-4" data-reveal>
                  What's your<br/><span class="font-semibold">reading speed?</span>
                </h2>
                <p class="text-ui-body text-ui-muted max-w-sm mb-8" data-reveal>
                  Read a short passage at your own pace, then answer 10 comprehension questions.
                  Your WPM and accuracy are saved as your baseline.
                </p>
                <div class="flex flex-wrap gap-3" data-reveal>
                  <a href="#/benchmark" data-cta-btn
                    data-umami-event="marketing-benchmark-click"
                    class="btn btn-primary btn-lg rounded-full px-12 gap-2 mkt-cta-glow">
                    Take the reading test ${icon(ArrowRight, "w-4 h-4")}
                  </a>
                </div>
                <p class="text-ui-body text-ui-muted-subtle mt-4" data-reveal>~3 minutes · no timer · no pressure</p>
              </div>
              <div class="hidden md:flex flex-col items-center select-none text-primary/25" aria-hidden="true">
                <span class="font-semibold tabular-nums font-mono text-ui-hero" style="font-size: 5rem; line-height: 1;">
                  ?
                </span>
                <span class="text-ui-body font-semibold tracking-widest uppercase text-ui-muted-subtle">WPM</span>
              </div>
            </div>
          </div>
        </section>

        <section class="py-16 px-6 md:px-12 border-b border-base-300/60 bg-base-200/25">
          <div class="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
            <div data-reveal>
              <p class="text-ui-body tracking-[0.35em] uppercase text-primary/80 mb-3 font-semibold">Open source</p>
              <h2 class="text-ui-hero font-semibold text-base-content leading-tight mb-3">
                MIT license, public repo.
              </h2>
              <p class="text-ui-body text-ui-muted leading-relaxed max-w-md">
                Source is on GitHub. No ads or paid tiers, no tracking cookies. Reading data stays in your browser unless you export it.
              </p>
            </div>
            <div class="flex flex-wrap gap-3 shrink-0" data-reveal>
              <a href=${GITHUB_URL} target="_blank" rel="noopener" class="btn btn-outline btn-sm rounded-full px-7 gap-2">
                ${githubIcon("w-3.5 h-3.5")} View on GitHub
              </a>
              <a href="#/donate" class="btn btn-outline border-error/40 text-error hover:bg-error/10 hover:border-error btn-sm rounded-full px-7 gap-2">
                ${icon(Heart, "w-3.5 h-3.5")} Donate
              </a>
            </div>
          </div>
        </section>

        <!-- ── Footer ── -->
        <footer class="py-14 px-6 md:px-12">
          <div class="max-w-5xl mx-auto">
            <div class="grid grid-cols-2 sm:grid-cols-[1fr_auto_auto_auto] gap-10 mb-10">
              <div class="col-span-2 sm:col-span-1">
                <div class="flex items-center gap-2 mb-2">
                  ${icon(Zap, "w-3.5 h-3.5 text-primary")}
                  <span class="text-ui-body tracking-[0.25em] font-semibold text-base-content uppercase select-none">speeedy</span>
                </div>
                <p class="text-ui-body text-ui-muted leading-relaxed max-w-[18ch]">
                  Free, open-source RSVP speed reader.
                </p>
              </div>
              <div class="flex flex-col gap-2.5">
                <span class="text-ui-body uppercase tracking-widest text-ui-muted-subtle font-semibold">Product</span>
                <a href="#/app" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">App</a>
                <a href="#/benchmark" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">Reading Test</a>
                <a href="#/learn" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">How it works</a>
                <a href="#/promote" class="text-ui-body text-ui-muted hover:text-base-content transition-colors underline decoration-primary/30 underline-offset-4">Speeedy for Bloggers</a>
                <a href="#/changelog" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">Changelog</a>
              </div>
              <div class="flex flex-col gap-2.5">
                <span class="text-ui-body uppercase tracking-widest text-ui-muted-subtle font-semibold">Project</span>
                <a href=${GITHUB_URL} target="_blank" rel="noopener" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">GitHub</a>
                <a href="#/donate" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">Support</a>
                <a href="#/privacy" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">Privacy</a>
                <a href="#/terms" class="text-ui-body text-ui-muted hover:text-base-content transition-colors">Terms</a>
              </div>
            </div>
            <div class="flex flex-col sm:flex-row items-center justify-between gap-6 pt-8 border-t border-base-300/50">
              <p class="text-ui-body text-ui-muted-subtle">
                MIT License · No ads · No cookies · No account required
              </p>
              <div class="flex flex-wrap items-center justify-center gap-6 opacity-30 hover:opacity-70 transition-opacity grayscale hover:grayscale-0">
                <a href="https://ufind.best/products/speeedy?utm_source=ufind.best" target="_blank" rel="noopener">
                  <img src=${badgeUrls.ufind} alt="Featured on ufind.best" width="100" />
                </a>
                <a href="https://www.producthunt.com/products/speeedy?utm_source=other&utm_medium=social" target="_blank" rel="noopener">
                  <img src=${badgeUrls.productHunt} alt="Speeedy - Featured on Product Hunt" width="140" style="height: 30px;" />
                </a>
              </div>
            </div>
          </div>
        </footer>

      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"marketing-page": MarketingPage;
	}
}
