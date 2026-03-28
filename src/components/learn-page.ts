import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./ui/page-nav.js";
import "./learn/learn-saccade-demo.js";
import "./learn/learn-wpm-chart.js";
import "./orp-demo.js";
import {
	initDataReveal,
	initTipReveal,
	prefersReducedMotion,
} from "../utils/scroll-reveal.js";

const SCRAMBLE_CHARS = "✦◆▸◉✺⬡◈▲◇✸⬢◐▹◑";

interface TipItem {
	title: string;
	body: string;
	open: boolean;
}

@customElement("learn-page")
export class LearnPage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@state() private scrollProgress = 0;
	@state() private tips: TipItem[] = [
		{
			title: "Start slow, ramp up",
			body: "Set the reader to a speed that feels slightly uncomfortable, not painful. Your brain adapts in a few sessions. Starting too fast leads to frustration and poor comprehension. Speeedy's speed ramp starts slow and builds automatically.",
			open: false,
		},
		{
			title: "Use punctuation pauses",
			body: "Turn on sentence and comma pauses. That gives working memory the consolidation window it needs, especially for complex or technical text.",
			open: false,
		},
		{
			title: "Take a reading speed test first",
			body: "Before guessing your WPM, take a proper reading test. Read a passage at your natural pace, then answer 10 comprehension questions. Your actual baseline is often different from what you expect.",
			open: false,
		},
		{
			title: "Read every day",
			body: "Short daily sessions work better than occasional long ones. 15–20 minutes a day with RSVP builds the pattern recognition your brain uses to process words faster.",
			open: false,
		},
		{
			title: "Use peripheral context for difficult text",
			body: "Show 1–3 context words before and after the current word, dimmed. For complex or technical material, this keeps sentence flow and reduces the load of losing your place.",
			open: false,
		},
		{
			title: "Use RSVP for comfort, not just speed",
			body: "If reading feels tiring or hard to track, try RSVP at a moderate pace, below 300 WPM. Some readers find the fixed focal point easier to sustain than scanning across lines, regardless of speed.",
			open: false,
		},
	];

	private _scrollHandler = () => {
		const el = this.querySelector("article");
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const total = el.scrollHeight - window.innerHeight;
		const scrolled = Math.max(0, -rect.top);
		this.scrollProgress = total > 0 ? Math.min(1, scrolled / total) : 0;
	};

	override connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("scroll", this._scrollHandler, { passive: true });
		requestAnimationFrame(() => {
			this._initDecodeHeadings();
			this._initScrollReveal();
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener("scroll", this._scrollHandler);
	}

	private _initScrollReveal(): void {
		initDataReveal(this);
		initTipReveal(this);
	}

	private _initDecodeHeadings(): void {
		if (prefersReducedMotion()) return;

		const headings = this.querySelectorAll<HTMLElement>("h2[data-decode]");
		const obs = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						obs.unobserve(entry.target);
						this._decodeText(entry.target as HTMLElement);
					}
				}
			},
			{ threshold: 0.3 },
		);
		for (const h of headings) obs.observe(h);
	}

	private _decodeText(el: HTMLElement): void {
		const original = el.dataset.decode ?? el.textContent ?? "";
		const chars = original.split("");
		const total = chars.length;
		let frame = 0;
		const totalFrames = Math.ceil(total * 1.5);

		const tick = () => {
			const progress = frame / totalFrames;
			const revealed = Math.floor(progress * total);
			const html = chars
				.map((c, i) => {
					if (c === " ") return " ";
					if (i < revealed) return c;
					const scrambleChar =
						SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
					return `<span class="learn-heading-scramble" aria-hidden="true">${scrambleChar}</span>`;
				})
				.join("");
			el.innerHTML = html;
			frame++;
			if (frame <= totalFrames) requestAnimationFrame(tick);
			else el.textContent = original;
		};
		requestAnimationFrame(tick);
	}

	private _toggleTip(i: number): void {
		this.tips = this.tips.map((t, idx) => ({
			...t,
			open: idx === i ? !t.open : t.open,
		}));
	}

	override render() {
		return html`
      <!-- Scroll progress bar -->
      <div class="learn-progress-bar" style="--scroll-progress: ${this.scrollProgress};"></div>

      <div class="learn-reading-surface">

        <!-- Nav -->
        <speeedy-page-nav label="How reading works" back-href="#/" sticky></speeedy-page-nav>

        <!-- Article -->
        <article class="max-w-2xl mx-auto px-6 py-14" @scroll=${this._scrollHandler}>

          <!-- Header -->
          <p class="text-ui-body tracking-[0.35em] uppercase text-base-content mb-4 font-semibold" data-reveal>Science</p>
          <h1 class="text-ui-hero font-semibold text-base-content leading-tight mb-5" data-reveal>
            What is speed reading?<br/>
            <span class="font-semibold">RSVP, ORP, and the mechanics of reading faster.</span>
          </h1>
          <p class="text-ui-body text-ui-muted leading-relaxed mb-14" data-reveal>
            The average adult reads at about 238 WPM. With RSVP practice, many readers reach 400 or more WPM.
            Comprehension drops for most people above about 450 WPM. Here is how it works and what the research shows.
          </p>

          <!-- Animated stats -->
          <div class="grid grid-cols-3 border border-base-300/60 rounded-2xl overflow-hidden mb-3" data-reveal>
            ${this.statCell("238", "avg adult WPM", false)}
            ${this.statCell("400+", "WPM with RSVP", true)}
            ${this.statCell("~10%", "lost to eye movement", false)}
          </div>
          <p class="text-ui-body text-ui-muted mb-14" data-reveal>Brysbaert (2019) · Rayner et al. (2016) · Masson (1983)</p>

          <h2 class="text-ui-title font-semibold text-base-content mb-4" data-reveal data-decode="The real bottleneck is your eyes, not your brain">
            The real bottleneck is your eyes, not your brain
          </h2>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-5" data-reveal>
            When you read a line of text, your eyes don't glide smoothly. They jump 3–4 times per line in rapid bursts called
            <em>saccades</em>. During each saccade you read nothing — it's pure motor overhead. Between saccades you fixate
            for roughly 200–250ms per word group, and sometimes regress (jump backward) to re-read.
          </p>

          <!-- Saccade visualization -->
          <div class="mb-5" data-reveal>
            <learn-saccade-demo></learn-saccade-demo>
          </div>

          <p class="text-ui-body text-ui-muted leading-[1.9] mb-2" data-reveal>
            The brain itself can process language significantly faster than 238 WPM. The bottleneck is the eye movement
            pipeline, not cognition. Speed reading techniques target that pipeline.
          </p>
          <p class="text-ui-body text-ui-muted mb-14" data-reveal>Rayner, K. (1998). Eye movements in reading and information processing. Psychological Bulletin, 124(3), 372–422.</p>

          <h2 class="text-ui-title font-semibold text-base-content mb-4" data-reveal data-decode="What is RSVP?">
            What is RSVP?
          </h2>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-4" data-reveal>
            <strong class="font-semibold text-base-content">RSVP</strong> — Rapid Serial Visual Presentation — eliminates saccades entirely.
            Instead of your eyes scanning across a page, words appear one at a time in a single fixed position on screen.
            Your eyes stay still; the words move to you.
          </p>
          <div class="rounded-xl border-l-4 border-primary bg-primary/5 px-5 py-4 mb-4" data-reveal>
            <p class="text-ui-body text-base-content leading-[1.85]">
              One word. One fixed point. No eye movement. Studies show RSVP readers can reach 300–500+ WPM with
              comprehension similar to normal reading. Above about 450 WPM, comprehension drops for most readers.
              Good retention at high speeds takes practice and pausing.
            </p>
          </div>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-2" data-reveal>
            RSVP works well for <strong class="font-semibold text-base-content">linear text</strong> like articles, books,
            and reports. It's less suited for reference material where you need to jump around or skim headings.
          </p>
          <p class="text-ui-body text-ui-muted mb-14" data-reveal>Masson, M. E. J. (1983). Conceptual processing of text during skimming and rapid sequential reading. Memory &amp; Cognition, 11(3), 262–274.</p>

          <h2 class="text-ui-title font-semibold text-base-content mb-4" data-reveal data-decode="RSVP beyond speed">
            RSVP beyond speed
          </h2>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-4" data-reveal>
            Speed is usually how RSVP gets marketed, but it's not always the main benefit. For readers with dyslexia,
            ADHD, or visual stress conditions like Irlen syndrome, RSVP removes the mechanical burden of tracking lines.
            Your eyes don't have to find where the next word is.
          </p>
          <div class="rounded-xl border-l-4 border-primary bg-primary/5 px-5 py-4 mb-4" data-reveal>
            <p class="text-ui-body text-base-content leading-[1.85]">
              In a small study, a reader with dyslexia completed passages at 3× their normal speed with the same comprehension
              on a single RSVP pass. Another reader said RSVP felt less exhausting than regular reading, even when they needed
              multiple passes to understand the same amount. Comfort and comprehension are different measures. Both matter.
            </p>
          </div>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-14" data-reveal>
            Speeedy includes OpenDyslexic font support, configurable letter spacing, tinted Irlen overlays (visible in
            light and dark themes), and full play/pause control so you can stop whenever you need to without losing your place.
          </p>

          <h2 class="text-ui-title font-semibold text-base-content mb-4" data-reveal data-decode="The Optimal Recognition Point (ORP)">
            The Optimal Recognition Point (ORP)
          </h2>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-6" data-reveal>
            O'Regan and Jacobs (1992) showed that word recognition is fastest when your eye lands on a specific letter —
            not the first letter or the middle. They called this the <strong class="font-semibold text-base-content">Optimal Viewing Position</strong>,
            typically 1–2 letters left of center. In speed reading apps it is called the
            <strong class="font-semibold text-base-content">Optimal Recognition Point (ORP)</strong>.
            Speeedy lines up every word on this letter so your brain processes each word with less effort.
          </p>

          <div class="mb-3" data-reveal>
            <speeedy-orp-demo tone="surface" hint="hover any word to see its ORP"></speeedy-orp-demo>
          </div>
          <p class="text-ui-body text-ui-muted mb-14" data-reveal>O'Regan, J. K., &amp; Jacobs, A. M. (1992). Optimal viewing position effect in word recognition. J. Experimental Psychology.</p>

          <h2 class="text-ui-title font-semibold text-base-content mb-4" data-reveal data-decode="What is a normal reading speed?">
            What is a normal reading speed?
          </h2>
          <div class="mb-4" data-reveal>
            <learn-wpm-chart></learn-wpm-chart>
          </div>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-14" data-reveal>
            Your baseline WPM matters more than the comparison. The goal is to comfortably absorb more in less time, not to hit an arbitrary number.
          </p>

          <h2 class="text-ui-title font-semibold text-base-content mb-4" data-reveal data-decode="Does speed reading hurt comprehension?">
            Does speed reading hurt comprehension?
          </h2>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-4" data-reveal>
            The honest answer is: it depends on speed. Rayner et al. (2016) found that
            doubling reading speed from about 250 to 500+ WPM reliably hurts comprehension for most readers.
            Pure skimming techniques that claim 1000+ WPM drop comprehension to around 50%.
            <strong class="font-semibold text-base-content">RSVP with pauses and moderate speeds</strong> behaves differently.
          </p>
          <div class="rounded-xl border-l-4 border-primary bg-primary/5 px-5 py-4 mb-4" data-reveal>
            <p class="text-ui-body text-base-content leading-[1.85]">
              Just &amp; Carpenter (1987) showed that comprehension depends on working memory consolidation at clause
              boundaries. RSVP with automatic pauses at commas and full stops gives you that window. Most readers
              keep good comprehension up to about 400–450 WPM with pausing. Beyond that, expect some trade-off.
            </p>
          </div>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-2" data-reveal>
            A note on subvocalization: the inner voice is often described as a habit to eliminate. Research suggests it's actually
            useful for complex text, helping you hold syntax in working memory. Don't try to suppress it on difficult material.
            Let the speed ramp do its job instead.
          </p>
          <p class="text-ui-body text-ui-muted mb-14" data-reveal>Just &amp; Carpenter (1987), The Psychology of Reading and Language Comprehension. · Rayner et al. (2016), Psychological Science in the Public Interest.</p>

          <h2 class="text-ui-title font-semibold text-base-content mb-4" data-reveal data-decode="What is bionic reading?">
            What is bionic reading?
          </h2>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-4" data-reveal>
            <strong class="font-semibold text-base-content">Bionic reading</strong> bolds the first letters of each word.
            The theory is that your brain uses the bolded anchors to predict and fill in the rest of the word faster.
          </p>
          <div class="rounded-xl border border-base-300/60 bg-base-200/30 px-5 py-4 mb-4" data-reveal>
            <p class="text-ui-body text-ui-muted leading-[1.85]">
              <strong class="font-semibold text-base-content">Note:</strong> Current peer-reviewed research has not found
              a measurable benefit to reading speed or comprehension from bionic formatting for general readers
              (Acta Psychologica, 2024). Some readers find it helpful at high speeds. Try it and see.
            </p>
          </div>
          <p class="text-ui-body text-ui-muted leading-[1.9] mb-14" data-reveal>
            In Speeedy you can use bionic mode together with RSVP and ORP. The feature is there as an option, not a promise.
          </p>

          <h2 class="text-ui-title font-semibold text-base-content mb-6" data-reveal data-decode="How to improve your reading speed">
            How to improve your reading speed
          </h2>
          <div class="space-y-0 divide-y divide-base-300/50 mb-14" data-reveal>
            ${this.tips.map(
							(tip, i) => html`
              <div class="py-0" data-tip-item>
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-4 py-4 text-left group"
                  @click=${() => this._toggleTip(i)}
                  aria-expanded=${tip.open}
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="font-mono text-ui-body shrink-0 w-5 transition-colors duration-200 ${tip.open ? "text-base-content" : "text-ui-muted-subtle"}">${i + 1}.</span>
                    <span class="text-ui-body font-semibold transition-colors duration-200 text-base-content">${tip.title}</span>
                  </div>
                  <svg class="w-4 h-4 shrink-0 transition-all duration-300 ${tip.open ? "rotate-45 text-base-content" : "text-ui-muted-subtle"}"
                    fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
                <div class="learn-tip-body ${tip.open ? "open" : ""}">
                  <div class="learn-tip-inner">
                    <p class="text-ui-body text-ui-muted leading-[1.85] pb-4 pl-8">${tip.body}</p>
                  </div>
                </div>
              </div>
            `,
						)}
          </div>

          <!-- CTA -->
          <div class="border border-primary/20 rounded-2xl p-8 text-center bg-primary/3" data-reveal
            style="box-shadow: 0 0 40px color-mix(in oklab, var(--color-primary) 8%, transparent);">
            <p class="text-ui-body tracking-[0.35em] uppercase text-base-content mb-4 font-semibold">Ready to start?</p>
            <h2 class="text-ui-hero font-semibold text-base-content mb-3">Find your reading speed</h2>
            <p class="text-ui-body text-ui-muted leading-relaxed mb-7 max-w-xs mx-auto">
              Read at your own pace, answer 10 comprehension questions, and get your WPM and score saved to your profile. Takes about 3 minutes.
            </p>
            <div class="flex flex-col sm:flex-row gap-3 justify-center">
              <a href="#/benchmark" class="btn btn-primary rounded-full px-8">Take the reading test</a>
              <a href="#/app" class="btn btn-ghost text-ui-muted hover:text-base-content">Open app</a>
            </div>
          </div>

        </article>
      </div>
    `;
	}

	private statCell(value: string, label: string, accent: boolean) {
		const labelTone = accent ? "text-ui-muted font-medium" : "text-ui-muted";
		return html`
      <div class="py-6 px-4 text-center ${accent ? "border-x border-base-300/60" : ""}">
        <div class="text-ui-hero font-semibold tabular-nums leading-none text-base-content">${value}</div>
        <div class="text-ui-body ${labelTone} mt-1 leading-snug">${label}</div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"learn-page": LearnPage;
	}
}
