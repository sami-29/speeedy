# Review: 73 reader settings panel and 1.x parity (2026-11-26)

Fixed point: `origin/72-reader-focus` (762dd45)
Diff: `git diff --cached origin/72-reader-focus`, the staged change on `73-reader-settings` (33 files, +1940 / -83)
Spec: `.planning/issues/2.0/73-reader-settings-panel-and-1x-parity.md`, plus the owner's in-ticket decisions
Reviewers: Sonnet 5.5, one per axis. The code was written by Opus 5.5.

## Standards

No hard violations of a documented standard.

- **Standards 1** (soft): CONTRIBUTING.md "Versioning" asks for a `CHANGELOG.md` `[Unreleased]` entry when a feature is added. The file has no such section.
- **Standards 2** (soft): GLOSSARY.md has no entry for **Preset**, the named bundle of settings, sound and Reading Mode. `presets.ts` itself warns that it is not the same thing as `READER_PRESETS`.
- **Standards 3**, Duplicated Code: the `isRecord` guard appears three times, in `audio/prefs.ts`, `reader/prefs.ts:19` and `reader/presets.ts`.
- **Standards 4**, Duplicated Code: the same storage load and save shape appears in `reader/prefs.ts:44-70`, `reader/presets.ts` and `audio/prefs.ts`. It is a try/catch around `getItem` with `JSON.parse` and a fallback, and a try/catch around `setItem`.
- **Standards 5**, Duplicated Code: `audio/system.ts` `setPrefs` repeats the bus-gain block from `setVolume`.
- **Standards 6**, Primitive Obsession: `Preset.mode: string` has a hard-coded `"rsvp"` fallback. `SettingsPanel` types its mode ids as `string`. A `ModeId` type would catch a stale id at compile time.
- **Standards 7**, Data Clumps and mild Feature Envy: `SettingsPanel` takes 13 props. The `snapshot` and `onapply` callbacks reach back into the shell's state, so adding a preset field touches five places.
- **Standards 8**, Divergent Change: `SettingsPanel.svelte` is 467 lines. Preset management could move to its own `PresetList.svelte`.
- **Standards 9**, Duplicated Code: `RsvpView.svelte` has three near-identical `current.on(...)` handlers for play, pause and end.
- **Standards 10**, Mysterious Name: the `still` prop on `PacerView`.
- **Standards 11**, Mysterious Name: `same()` and `tidy()` in `presets.ts`. Suggested names: `sameName` and `cleanName`.
- **Standards 12** (low): `audioPrefsFrom` returns the shared default object, while `readerSettingsFrom` returns a copy.

## Spec

**Missing or partial**

- **Spec (a)1**: "Settings are grouped as in the spec's parity list (Display, Words, Pacing, Paused view, Reading features, Audio, Comfort) plus the 2.0 groups (Reading Modes, Speed Zones, voices, sound)".
  - `SettingsPanel.svelte` has no Display or Comfort group, and Speed Zones is a row under Pacing rather than a group of its own.
  - The Display and Comfort settings belong to #29 (`29-display-aids.md`) and #77 (`77-colour-tints.md`). Both ticket files exist; I checked.
  - The deferral is written down only in the parity table, not in the ticket.
- **Spec (a)2**: every row in the parity table is accounted for: 45 rows, matching `ReaderSettings` on `main` (13 built, 31 owned, 1 dropped). All the owning tickets (#29, #74, #75, #76, #77) exist.
- **Spec (a)3**: the 390px and 1440px focus-state screenshots are a PR-time step.
- **Spec (a)4**: tick pitch and noise colour are unit tested, but no e2e step changes pitch, and the reload test does not check pitch or noise colour.

**Scope creep**: none. The edits to the other e2e specs follow from the sound controls moving into the panel.

**Implemented, possibly wrong**

- **Spec (c)1**: "context" in the paused view shows the sentence around the word. 1.x had only focus and full text, and the ticket does not define "context".
- **Spec (c)2**: remove-citations strips only pasted text and `.txt` files. EPUB, HTML and web sources keep their citations. The parity table says so, but the panel does not.
- **Spec (c)3**: the reload test would fail if persistence broke, but it does not cover the sound settings or the Reading Mode. The preset tests cover those.
- **Spec (c)4**: the no-scroll test covers 320, 390 and 1440px in every Reading Mode and would fail on a regression. It opens and closes the panel before measuring.

Summary: Standards has 12 findings, all soft or judgement calls; the worst is Standards 4, the storage code repeated three times. Spec has 4 partial items and 4 notes; the worst is Spec (a)1, the missing Display and Comfort groups.

## Outcome

The owner chose these on 2026-11-26.

- **Spec (a)1**: deferred. The ticket now records that #29 and #77 add the Display and Comfort groups with their settings, so no empty group ships.
- **Spec (c)1**: kept. "Context" is the sentence around the paused word.
- **Standards 3, 4 and 12**: fixed.
  - `lib/device-storage.ts` now holds `isRecord`, `readJson` and `writeJson`.
  - Reader prefs, presets, audio prefs, focus and Listen prefs all use them.
  - `audioPrefsFrom` now returns a fresh copy.
- **Standards 6**: fixed.
  - `ModeId` and `DEFAULT_MODE_ID` live in `reader/modes.ts`.
  - `ModeId` is a named string, since modes register at runtime and the registry types ids as strings.
- **Standards 11**: fixed. The helpers are renamed to `sameName` and `cleanName`.
- **Spec (a)4 and (c)3**: fixed. The reload test now also checks noise colour, the tick and tick pitch.
- **Spec (c)2**: no change needed. The panel note already says the toggle covers pasted text and `.txt` files.
- **Standards 1 and 2**: fixed.
  - `CHANGELOG.md` has an `[Unreleased]` entry.
  - `GLOSSARY.md` has a **Preset** entry.
- **Left open, as judgement calls**:
  - Standards 5: the duplicated bus-gain block.
  - Standards 7: the panel's props.
  - Standards 8: splitting out `PresetList`.
  - Standards 9: the RsvpView handlers.
  - Standards 10: the `still` prop.
