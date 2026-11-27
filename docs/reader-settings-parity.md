# Reader settings: 1.x parity

Each of the 45 fields in 1.x's `ReaderSettings` (`src/models/types.ts` on `main`) has one row here. Every row is **built** in 2.0, **owned** by a named ticket, or **dropped** with a reason. Ticket numbers refer to `.planning/issues/2.0/`.

2.0 keeps reader settings on this device only. They are in `localStorage` under these keys, and none of them is synced:

- `speeedy.reader`: `app/src/lib/reader/prefs.ts`
- `speeedy.audio`: `app/src/lib/audio/prefs.ts`
- `speeedy.focus`: `app/src/lib/reader/focus.ts`
- `speeedy.presets`: `app/src/lib/reader/presets.ts`

The panel that holds them is `app/src/lib/reader/SettingsPanel.svelte`.

| # | 1.x field | Group | 2.0 | Where, or why not |
|---|---|---|---|---|
| 1 | wpm | core | built | `WpmSlider.svelte`; range 100 to 1600, default 250 (1.x: 50, 300) |
| 2 | fontSize | Display | owned by #29 | |
| 3 | fontFamily | Display | owned by #29 | |
| 4 | highlightColor (ORP pivot) | Display | owned by #29 | the pivot follows the theme's red until then |
| 5 | letterSpacing | Display | owned by #29 | |
| 6 | focusPosition | none | **dropped** | Unused in 1.x: no control sets it and nothing reads it. Owner signed off 2026-11-26 |
| 7 | pivotOffset | Display | owned by #29 | the axis is fixed at 35% until then |
| 8 | sentencePauseMultiplier | Pacing | built (#74) | "Sentence pause" under "Pause on punctuation"; 1 to 10 in steps of 0.5, default 2 as in 1.x |
| 9 | showProgress | Reading features | built | Progress bar toggle in the panel. The chart keeps recording while it is hidden |
| 10 | focusModeEnabled | Reading features | built (#72) | the focus state, and "Focus when I press Play" in the panel |
| 11 | theme | Display | built (#78) | the theme control in the site header |
| 12 | chunkSize | Words | built | `ReadingSettings.svelte`, 1 to 5 |
| 13 | bionicMode | Words | owned by #29 | |
| 14 | smartSpeed | Pacing | built | `ReadingSettings.svelte` |
| 15 | speedRampEnabled | Pacing | built (#74) | "Speed ramp" in `ReadingSettings.svelte`; from your speed to the target, counted from Play |
| 16 | speedRampTarget | Pacing | built (#74) | "Target speed", 100 to 1600 WPM in steps of 25, default 500 as in 1.x (1.x's lowest is 50). "Ramp length" is new: 10 to 200 words, default 30 (1.x's fixed 30) |
| 17 | dyslexiaMode | Display | owned by #29 | |
| 18 | peripheralContext | Words | owned by #29 | |
| 19 | peripheralContextCount | Words | owned by #29 | |
| 20 | showOrpGuides | Display | owned by #29 | |
| 21 | hidePunctuationInDisplay | Display | owned by #29 | |
| 22 | paragraphPauseMultiplier | Pacing | built (#74) | "Paragraph pause", 1 to 3 in steps of 0.1, default 1.8 as in 1.x |
| 23 | contextPauseOnClose | Pacing | built (#74) | "Pause after an aside", a switch, on by default; the extra time stays the fixed 1.15 of 1.x |
| 24 | colorizeQuotes | Words | owned by #29 | |
| 25 | colorizeParens | Words | owned by #29 | |
| 26 | commaAsPause | Pacing | built (#74) | "Comma pause", a switch, off by default as in 1.x |
| 27 | rewindStep | Pacing | built (#74) | "Rewind step", 1 to 50 words, default 5 as in 1.x. Used by the Words button and the J key; 2.0's sentence, paragraph and chapter rewinds (#21) stay |
| 28 | bionicFocusPosition | Words | owned by #29 | |
| 29 | countdownEnabled | Pacing | built (#74) | "Start countdown", RSVP only; 3, 2, 1 at 800 ms each as in 1.x, off by default |
| 30 | clickSoundEnabled | Audio | built | "Tick on each word", in RSVP and Pacer; default off (1.x: on) |
| 31 | clickSoundPitch | Audio | built | "Tick pitch", ×0.1 to ×3.0 in steps of 0.1 |
| 32 | ambientNoise | Audio | built | white, pink or brown noise |
| 33 | ambientVolume | Audio | built | default 30% (1.x: 50%) |
| 34 | irlenMode | Comfort | owned by #77 | |
| 35 | irlenOpacity | Comfort | owned by #77 | |
| 36 | fontWeight | Display | owned by #29 | |
| 37 | pauseView | Paused view | built | RSVP shows the word, its sentence or the full text while paused |
| 38 | quoteHighlightColor | Words | owned by #29 | |
| 39 | parenHighlightColor | Words | owned by #29 | |
| 40 | pomodoroReadMinutes | Pomodoro | owned by #75 | |
| 41 | pomodoroBreakMinutes | Pomodoro | owned by #75 | |
| 42 | pomodoroLongBreakMinutes | Pomodoro | owned by #75 | |
| 43 | pomodoroSessionsBeforeLongBreak | Pomodoro | owned by #75 | |
| 44 | removeCitations | Reading features | built | Strips `[1]`-style and (Author, 2020)-style citations from pasted text and `.txt` files. Applies to the next text opened |
| 45 | tickerMode | Ticker | owned by #76 | |

Totals: 20 built, 24 owned by another ticket, 1 dropped. The Display and Comfort groups have no rows in the panel yet: #29 and #77 own them.

## 2.0 settings in the same panel

| Setting | Panel group | Kept in |
|---|---|---|
| Reading Mode (RSVP, Pacer, Listen) | Reading Mode | a preset only; the reader opens in its default mode |
| Speed Zones | Pacing | sets the WPM |
| Sound: volumes, ambient noise, tick, tick pitch | Audio | `speeedy.audio` |
| Voices and voice speed | Audio (Listen) | `speeedy.listen`. The controls stay beside the Listen view, and the panel points to them |
| Named presets | Presets | `speeedy.presets`. A preset keeps the reader settings, the sound and the Reading Mode |
