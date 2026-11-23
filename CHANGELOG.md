# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Reader settings panel**: a sidebar on desktop and a sheet on phones, where every change applies at once. It holds Reading Mode, pacing, words, the paused view, the progress bar, remove-citations and sound, and your settings stay on this device.
- **Presets**: save the current reader settings, sound and Reading Mode under a name, and apply them again in one step.
- **Paused view**: while paused, RSVP can show the word, its sentence or the full text.
- **Tick pitch**: set the pitch of the tick on each word.

### Fixed
- **Joined words with 2+ words per flash** — the space next to the highlighted letter no longer disappears, so "a book" no longer shows as "abook". ([#23](https://github.com/sami-29/speeedy/issues/23))
- **Multi-word flashes on narrow screens** — a flash of several words now keeps its highlighted letter on the reading axis while it fits the screen. A flash too long for that moves left and stays whole while it fits the screen. ([#23](https://github.com/sami-29/speeedy/issues/23))

## [1.3.0] - 2026-06-26

### Added
- **Words per flash control** — configure how many words appear in each RSVP flash (1–5). Find it in Settings under "Words per flash".
- **West and South Slavic language support** — improved smart speed timing and punctuation detection for Polish, Czech, Slovak, Serbo-Croatian, Slovene, and Bulgarian text.

## [1.2.0] - 2026-05-30

### Added
- **Clipboard auto-load** — paste text (Ctrl+V / Cmd+V) anywhere on the app to instantly load it into the reader. In the main page, it populates the text field; in the active reader, it stops playback and loads a new document.
- **"Paste clipboard" button** — one-click button in the text input tab to pull text directly using the browser's Clipboard API.

## [1.1.0] - 2026-05-06

### Added
- **Ticker mode** — alternative to RSVP flash: text scrolls horizontally at your WPM pace. Speed, pause, and seek all work as normal. Toggle in Settings under "Ticker mode"
- **Remove citations toggle** — strips inline references like `[1]`, `[1-3]`, and `(Smith et al., 2020)` from text for distraction-free academic reading
- **Donate page: feature bounty section** — roadmap items (cloud sync, browser extension, mobile wrapper) that contributions help fund

## [1.0.0] - 2026-03-27

### Added
- RSVP reader with Optimal Recognition Point (ORP) alignment
- Smart speed that adapts timing based on word complexity
- Speed ramp to ease readers into faster sessions
- Bionic reading mode
- CJK & RTL support (Arabic, Hebrew) with ligature-aware rendering
- File support: PDF, DOCX, EPUB, TXT, Markdown, HTML, CSV, ODT, RTF
- Peripheral context ghost words for spatial awareness
- Pause view modes: focus, context, and full-text with click-to-seek
- Seekable progress bar — click or drag to jump to any position; pauses playback during drag and resumes when released
- Font size, font family, letter spacing, font weight, and pivot offset controls
- ORP guide markers
- Quote and aside colorization
- Countdown before playback
- Ambient white, pink, and brown noise with crossfade looping
- Click-synchronized reading sounds with pitch control
- Dyslexia mode with OpenDyslexic-style presentation and adjusted spacing
- Irlen syndrome overlays (peach, mint, parchment) with adjustable opacity
- Pomodoro timer with focus, break, and long-break phases
- Pomodoro break overlay with session progress, skip, and extend-by-5-min controls
- Pomodoro progress ring showing phase completion
- Pomodoro session persistence via sessionStorage
- 20-20-20 eye rest reminder during long focus sessions
- Reader auto-pauses when a break starts and auto-resumes when it ends
- Reading speed benchmark test with 10-question comprehension quiz
- Session history with WPM, words read, duration, and source title
- Daily word counts and 14-day activity chart
- Current streak and best streak tracking
- Reading goals and daily progress bar
- WPM trend sparkline chart
- Local-first profile with IndexedDB storage — no account, no server
- Profile export and import as `.speeedy` backup files
- Shareable public reading profile links with privacy opt-in
- Share cards for stats and self-promotion
- Local document library with resume support and deduplication
- Resume from saved progress with lookback context
- Optional **focus mode** for the RSVP reader: off by default; enable in **Settings** (“Focus mode (immersion)”) or toggle with **F**. While playing (or during the countdown), it hides the header, progress bar, bottom controls, and settings panel. Pausing shows the full UI again; the preference persists until toggled off
- Keyboard-first controls: Space, F (focus mode), Arrows, R, Escape, ?
- PWA support — installable and offline-capable
- Learn page explaining RSVP, ORP, and reading science with interactive demos
- Donation and support page with crypto wallets, QR codes, and supporters wall
- In-app changelog

[1.3.0]: https://github.com/sami-29/speeedy/releases/tag/v1.3.0
[1.2.0]: https://github.com/sami-29/speeedy/releases/tag/v1.2.0
[1.1.0]: https://github.com/sami-29/speeedy/releases/tag/v1.1.0
[1.0.0]: https://github.com/sami-29/speeedy/releases/tag/v1.0.0
