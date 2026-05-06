import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { ArrowLeft } from "lucide";
import { GITHUB_URL } from "../config.js";
import { navigate } from "../utils/events.js";
import { icon } from "../utils/icons.js";

interface Release {
	version: string;
	date: string;
	sections: { title: string; items: string[] }[];
}

const RELEASES: Release[] = [
	{
		version: "1.1.0",
		date: "2026-05-06",
		sections: [
			{
				title: "Added",
				items: [
					'Ticker mode — alternative to RSVP flash: text scrolls horizontally at your WPM pace. Speed, pause, and seek all work as normal. Toggle in Settings under "Ticker mode"',
					"Remove citations toggle — strips inline references like [1], [1-3], and (Smith et al., 2020) from text for distraction-free academic reading",
					"Donate page: feature bounty section — roadmap items (cloud sync, browser extension, mobile wrapper) that contributions help fund",
				],
			},
		],
	},
	{
		version: "1.0.0",
		date: "2026-03-27",
		sections: [
			{
				title: "Added",
				items: [
					"RSVP reader with Optimal Recognition Point (ORP) alignment",
					"Smart speed that adapts timing based on word complexity",
					"Speed ramp to ease readers into faster sessions",
					"Bionic reading mode",
					"CJK & RTL support (Arabic, Hebrew) with ligature-aware rendering",
					"File support: PDF, DOCX, EPUB, TXT, Markdown, HTML, CSV, ODT, RTF",
					"Peripheral context ghost words for spatial awareness",
					"Pause view modes: focus, context, and full-text with click-to-seek",
					"Seekable progress bar — click or drag to jump to any position",
					"Font size, font family, letter spacing, font weight, and pivot offset controls",
					"ORP guide markers",
					"Quote and aside colorization",
					"Countdown before playback",
					"Ambient white, pink, and brown noise with crossfade looping",
					"Click-synchronized reading sounds with pitch control",
					"Dyslexia mode with OpenDyslexic-style presentation and adjusted spacing",
					"Irlen syndrome overlays (peach, mint, parchment) with adjustable opacity",
					"Pomodoro timer with focus, break, and long-break phases",
					"Pomodoro break overlay with session progress, skip, and extend-by-5-min controls",
					"Pomodoro progress ring showing phase completion",
					"20-20-20 eye rest reminder during long focus sessions",
					"Reader auto-pauses when a break starts and auto-resumes when it ends",
					"Reading speed benchmark test with 10-question comprehension quiz",
					"Session history with WPM, words read, duration, and source title",
					"Daily word counts and 14-day activity chart",
					"Current streak and best streak tracking",
					"Reading goals and daily progress bar",
					"WPM trend sparkline chart",
					"Local-first profile with IndexedDB storage — no account, no server",
					"Profile export and import as .speeedy backup files",
					"Shareable public reading profile links with privacy opt-in",
					"Share cards for stats and self-promotion",
					"Local document library with resume support and deduplication",
					"Resume from saved progress with lookback context",
					"Optional focus mode for the RSVP reader (off by default): enable in Settings or press F. While playing or during the countdown, it hides the header, progress bar, bottom controls, and settings. Pausing shows the full UI again; the setting persists until you turn it off",
					"Keyboard-first controls: Space, F (focus mode), Arrows, R, Escape, ?",
					"PWA support — installable and offline-capable",
					"Learn page explaining RSVP, ORP, and reading science with interactive demos",
					"Donation and support page with crypto wallets, QR codes, and supporters wall",
					"In-app changelog",
				],
			},
		],
	},
];

@customElement("changelog-page")
export class ChangelogPage extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	override render() {
		return html`
      <div class="min-h-screen bg-base-100 flex flex-col">
        <nav class="px-6 py-4 flex items-center gap-3 border-b border-base-200">
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle"
            aria-label="Go back"
            @click=${() => navigate("landing")}
          >
            ${icon(ArrowLeft, "w-4 h-4")}
          </button>
          <span class="text-sm text-ui-muted tracking-widest uppercase">Changelog</span>
        </nav>

        <main class="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
          <div class="flex items-start justify-between mb-10">
            <div>
              <h1 class="text-2xl font-light text-base-content mb-1">What's new</h1>
              <p class="text-sm text-ui-muted font-light">
                Full history on
                <a
                  href="${GITHUB_URL}/releases"
                  target="_blank"
                  rel="noopener"
                  class="text-ui-muted hover:text-base-content underline underline-offset-2 transition-colors"
                >
                  GitHub Releases
                </a>
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-12">
            ${RELEASES.map((release) => this.renderRelease(release))}
          </div>
        </main>
      </div>
    `;
	}

	private renderRelease(release: Release) {
		return html`
      <div>
        <div class="flex items-baseline gap-4 mb-6">
          <span class="text-lg font-medium text-base-content font-mono">v${release.version}</span>
          <span class="text-sm text-ui-muted-subtle font-light">${release.date}</span>
        </div>

        ${release.sections.map(
					(section) => html`
          <div class="mb-6">
            <h3 class="text-xs tracking-widest uppercase text-ui-muted-subtle font-medium mb-3">${section.title}</h3>
            <ul class="flex flex-col gap-2">
              ${section.items.map(
								(item) => html`
                <li class="flex items-start gap-3 text-sm text-ui-muted font-light leading-relaxed">
                  <span class="text-ui-muted-subtle mt-1 shrink-0" aria-hidden="true">—</span>
                  <span>${item}</span>
                </li>
              `,
							)}
            </ul>
          </div>
        `,
				)}
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"changelog-page": ChangelogPage;
	}
}
