# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/sami-29/speeedy/releases/tag/v1.0.0
