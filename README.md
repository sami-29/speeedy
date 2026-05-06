# Speeedy

**Open-source RSVP speed reading app for focus, comfort, and measurable progress.**

Speeedy is a local-first reading product that helps users read faster with **RSVP (Rapid Serial Visual Presentation)** and **ORP (Optimal Recognition Point)** alignment, while also supporting accessibility, benchmarking, analytics, profile sharing, and offline use.

**The best free open-source alternative to Spreeder and Outread.** A private, local-first speed reader for PDFs and EPUBs — no account, no ads, no data collection. Built-in ADHD and dyslexia support.

→ **[speeedy.pages.dev](https://speeedy.pages.dev)**

> **Support the project:** If Speeedy saves you time, consider [supporting development](https://speeedy.pages.dev/#/donate) ❤️

---

## Why Speeedy exists

Traditional reading is slowed down by constant eye movement across lines of text. Speeedy reduces that overhead by presenting words in a fixed focal area so the eyes stay still and the brain can process text faster.

It is not just a basic word flasher. It is a full reading system with:
- a custom RSVP engine with adaptive timing
- deep reading personalization
- **accessibility-focused modes** — Dyslexia (OpenDyslexic), Bionic Reading, Irlen overlays
- **ADHD support** — Pomodoro timer, focus/immersion mode, ambient noise, 20-20-20 reminders
- reading benchmarks and progress tracking
- local-first persistence with no account required
- profile sharing and installable PWA support

---

## What is RSVP and ORP?

**RSVP** (Rapid Serial Visual Presentation) displays words one at a time in the same place on screen, reducing saccadic eye movement.

**ORP** (Optimal Recognition Point) is the letter position within a word where recognition is fastest. Speeedy aligns words to that pivot so the eye does not have to search for the word's center every time.

---

## Key Features

### Core reading engine
- **RSVP playback** with one-word
- **ORP alignment** for every displayed word
- **Smart speed** that adapts timing based on word complexity
- **Sentence, paragraph, and contextual pause weighting**
- **Speed ramp** to ease readers into faster sessions
- **Resume from saved progress** with lookback context
- **Keyboard-first controls** — Space, F (toggle focus mode), Arrows, R, Escape, ?

### Reading customization
- **100–1600 WPM control**
- **Font size, font family, letter spacing, and font weight controls**
- **Pivot offset adjustment**
- **Pause view modes** (focus / context / full-text)
- **Punctuation handling options**
- **Peripheral context ghost words**
- **ORP guide markers**
- **Bionic reading mode**
- **Quote and aside colorization**
- **Seekable progress bar** — click or drag to jump to any position
- **Focus mode (optional, off by default)** — enable in settings or press **F**; while playback (or the pre-roll countdown) runs, the reader hides the header, progress bar, bottom toolbar, and settings so only the word area shows. Pausing (tap the reading area or Space) brings controls back; focus mode stays enabled until you turn it off in settings or press **F** again

### Accessibility and focus
- **Dyslexia mode** with OpenDyslexic-style presentation, adjusted spacing, and font weight control
- **Irlen-style tinted overlays** (peach, mint, parchment) with adjustable opacity
- **RTL-aware reading support** for Arabic, Hebrew, and other RTL scripts
- **Ambient white, pink, and brown noise** with crossfade loop
- **Click-synchronized reading sounds** with pitch control
- **Countdown before playback**
- **Pomodoro timer** with focus/break/long-break phases, progress ring, session tracking, and auto pause/resume integration

### Content ingestion
- **Paste text directly**
- **Import documents:** PDF, DOCX, DOC, TXT, Markdown, RTF, HTML, CSV, ODT, EPUB
- **Shared reading links** for hash-based text sharing
- **Local document library** with resume support and deduplication

### Progress, tracking, and growth
- **Reading baseline benchmark** with 10-question comprehension quiz
- **Average WPM tracking** and improvement measurement
- **Session history** with source title, WPM, words read, duration
- **Daily word counts** and 14-day activity chart
- **Current streak and best streak**
- **Reading goals and daily progress bar**
- **WPM trend sparkline chart**

### Profile and sharing
- **Local profile system** with name, emoji, and avatar image
- **Profile export/import** as `.speeedy` backup files
- **Shareable public reading profile links** with privacy opt-in
- **Share cards** for stats and self-promotion

### Product and platform features
- **Installable PWA** with offline-friendly caching
- **Local-first architecture** — reading data stays in IndexedDB, no account required
- **Open-source codebase**
- **Learn page** explaining RSVP, ORP, and reading science with interactive demos
- **Donation/support page** with crypto wallets, QR codes, and supporters wall
- **In-app changelog** and project support routes

---

## Product Surfaces

Speeedy is more than a single reader screen. The app includes:

- **Marketing / landing page** with animated feature storytelling
- **Main app intake page** with file upload and text paste
- **Reader screen** with full settings panel
- **Stats dashboard** with charts and session history
- **Profile page** with library management and data portability
- **Benchmark test** for baseline WPM + comprehension measurement
- **Learn / science page** with educational content
- **Share view** for public stat cards
- **Donate/support page**
- **Changelog page**
- **Privacy and terms pages**

---

## Tech Stack

### Frontend
- [Lit](https://lit.dev) — web components (light DOM)
- [TypeScript](https://www.typescriptlang.org) — strict mode throughout
- [Vite](https://vitejs.dev) — dev server and production bundling
- [Tailwind CSS v4](https://tailwindcss.com) — utility-first styling
- [DaisyUI v5](https://daisyui.com) — theme and UI component primitives
- [Motion](https://motion.dev) — landing-page and learn-page animations
- [Lucide](https://lucide.dev) — icon set

### Parsing and document support
- [pdfjs-dist](https://mozilla.github.io/pdf.js/) — PDF parsing
- [mammoth](https://github.com/mwilliamson/mammoth.js) — DOCX/DOC parsing
- [JSZip](https://stuk.github.io/jszip/) — EPUB and ODT archive parsing

### Browser platform and utilities
- [idb](https://github.com/jakearchibald/idb) — IndexedDB wrapper
- [html-to-image](https://github.com/bubkoo/html-to-image) — share card export
- [qrcode](https://github.com/soldair/node-qrcode) — donation QR generation

### Quality and developer tooling
- [Biome](https://biomejs.dev) — linting and formatting
- [Vitest](https://vitest.dev) — unit testing
- [jsdom](https://github.com/jsdom/jsdom) — browser-like test environment
- [Husky](https://typicode.github.io/husky) — Git hooks
- [lint-staged](https://github.com/lint-staged/lint-staged) — pre-commit file checks

---

## Architecture Overview

```
src/
├── components/     Lit pages, UI elements, overlays, and product surfaces
├── config.ts       Project-level constants and public links
├── data/           Benchmark passages and other static content
├── models/         Shared TypeScript interfaces and types
├── services/       Engine, parsing, storage, profile, stats, theme, audio
└── utils/          Events, icons, and text helpers
```

Key implementation files:

- [`src/services/rsvp-engine.ts`](src/services/rsvp-engine.ts) — custom RSVP playback, token timing, pause logic, ORP flow
- [`src/services/text-parser.ts`](src/services/text-parser.ts) — document parsing across multiple formats
- [`src/services/storage-service.ts`](src/services/storage-service.ts) — IndexedDB persistence, deduplication, import/export
- [`src/services/audio-service.ts`](src/services/audio-service.ts) — procedural click sounds and ambient noise generation
- [`src/components/rsvp-reader.ts`](src/components/rsvp-reader.ts) — main reader experience
- [`src/components/settings-panel.ts`](src/components/settings-panel.ts) — deep reader personalization
- [`src/components/benchmark-test.ts`](src/components/benchmark-test.ts) — baseline WPM + comprehension flow
- [`src/components/profile-page.ts`](src/components/profile-page.ts) — profile, library, and data management

---

## Getting Started

**Prerequisites:** [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io)

```bash
# Clone and install
git clone https://github.com/sami-29/speeedy.git
cd speeedy
pnpm install

# Start dev server
pnpm dev

# Run tests
pnpm test

# Lint
pnpm lint

# Build for production
pnpm build

# Preview production build
pnpm preview
```

---

## Scripts

- `pnpm dev` — start local development server
- `pnpm build` — type-check and build production bundle
- `pnpm preview` — preview the production build locally
- `pnpm lint` — run Biome checks on source files
- `pnpm lint:fix` — auto-fix Biome issues where possible
- `pnpm test` — run unit tests once
- `pnpm test:watch` — run Vitest in watch mode

---

## Testing

**Unit tests** (Vitest):

- [`src/services/rsvp-engine.test.ts`](src/services/rsvp-engine.test.ts) — RSVP engine behavior
- [`src/services/stats-service.test.ts`](src/services/stats-service.test.ts) — stats calculations
- [`src/services/text-parser.test.ts`](src/services/text-parser.test.ts) — text parsing behavior
- [`src/utils/text-utils.test.ts`](src/utils/text-utils.test.ts) — shared text utility logic

**E2E tests** (Playwright):

- [`e2e/landing.spec.ts`](e2e/landing.spec.ts) — marketing page loads and CTAs are visible
- [`e2e/app-page.spec.ts`](e2e/app-page.spec.ts) — text paste and begin reading flow
- [`e2e/reader.spec.ts`](e2e/reader.spec.ts) — RSVP reader playback and controls
- [`e2e/benchmark.spec.ts`](e2e/benchmark.spec.ts) — full benchmark quiz flow
- [`e2e/settings.spec.ts`](e2e/settings.spec.ts) — settings persistence across reload
- [`e2e/keyboard.spec.ts`](e2e/keyboard.spec.ts) — keyboard shortcut smoke test

Run E2E tests: `pnpm e2e` (requires the dev server to start automatically).

---

## PWA and Deployment

Speeedy is configured as an installable PWA with cached static assets and auto-updating service worker behavior.

- [`vite.config.ts`](vite.config.ts) — PWA plugin, chunk splitting, runtime caching
- [`public/manifest.webmanifest`](public/manifest.webmanifest) — web app manifest
- [`wrangler.toml`](wrangler.toml) — Cloudflare-oriented asset deployment config

---

## Analytics

Speeedy uses [Umami](https://umami.is) (cookieless, privacy-first) for anonymous usage analytics. The tracking script in `index.html` points to the official Speeedy Umami instance.

**If you self-host or fork this project**, remove or replace the analytics script tag in `index.html`:

```html
<!-- Remove or replace this with your own Umami instance -->
<script defer src="https://cloud.umami.is/script.js" data-website-id="YOUR-ID-HERE"></script>
```

To remove analytics entirely, delete that `<script>` tag. Speeedy functions identically without it — no features depend on Umami being present.

---

## Versioning

This project follows [Semantic Versioning](https://semver.org):

- **MAJOR** (`1.x.x`) — breaking changes to data or public behavior
- **MINOR** (`x.1.x`) — new backwards-compatible features
- **PATCH** (`x.x.1`) — fixes and polish

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code style, and PR guidelines.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.
