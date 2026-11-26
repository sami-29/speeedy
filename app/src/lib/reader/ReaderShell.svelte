<script lang="ts">
import type { Document } from "@speeedy/contracts";
import type { BackUnit } from "@speeedy/engine";
import { onMount, tick, untrack } from "svelte";
import { audio } from "#lib/audio/instance.ts";
import { attachReadingSound } from "#lib/audio/reading-sound.ts";
import { m } from "#lib/paraglide/messages.js";
import { deviceStorage } from "../device-storage.ts";
import ChapterList from "./ChapterList.svelte";
import {
	backWordsName,
	modeName,
	rewindName,
	rewindWordsName,
	shortcutName,
} from "./copy.ts";
import { createCountdown } from "./countdown.ts";
import { loadFocusOnPlay, saveFocusOnPlay } from "./focus.ts";
import {
	DEFAULT_MODE_ID,
	type ModeId,
	pausesWhenHidden,
	readerModes,
} from "./modes.ts";
import type { Chapter } from "./navigation.ts";
import ProgressChart from "./ProgressChart.svelte";
import { pauseWhenHidden } from "./pacer/hidden.ts";
import { saveReaderSettings } from "./prefs.ts";
import type { Preset } from "./presets.ts";
import type { Reading } from "./reading.ts";
import SettingsPanel from "./SettingsPanel.svelte";
import Shortcuts from "./Shortcuts.svelte";
import { enginePatch, type ReaderSettings } from "./settings.ts";
import {
	commandForKey,
	nextMode,
	REWINDS,
	type ReaderCommand,
	WORD_REWIND,
} from "./shortcuts.ts";
import WpmSlider from "./WpmSlider.svelte";
import { clampWpm } from "./wpm.ts";

let {
	reading,
	doc,
	chapters,
	title,
	source,
	language,
	settings = $bindable(),
	failed = false,
	onNewText,
}: {
	reading: Reading;
	/** The text being read, for the progress bar. */
	doc: Document;
	/** Its chapters, from the headings. */
	chapters: readonly Chapter[];
	title: string | null;
	/** Where the text came from, for the page to tell apart. */
	source: string;
	/** BCP 47 tag of the text, `und` when it is not known. */
	language: string;
	settings: ReaderSettings;
	failed?: boolean;
	onNewText: () => void;
} = $props();

const modes = readerModes.modes();
let modeId = $state(modes[0]?.id ?? DEFAULT_MODE_ID);
const mode = $derived(readerModes.get(modeId));
// A mode that is paced by a voice has no reading speed: the controls for it are left out.
const usesWpm = $derived(mode?.settingsUsed.includes("wpm") ?? true);
// A shared text waits for Play. After a switch, the next mode plays if the last one was.
// svelte-ignore state_referenced_locally
let autoplay = $state(source !== "share");

// Only RSVP counts in: the count takes the place of its word.
const usesCountdown = $derived(
	mode?.settingsUsed.includes("countdown") ?? false,
);
// The number on show while the start countdown runs, or null.
let count = $state<number | null>(null);
const countdown = createCountdown({
	oncount: (next) => {
		count = next;
	},
	ondone: () => reading.engine.play(),
});

let playing = $state(false);
let helpOpen = $state(false);
let settingsOpen = $state(false);
let settingsButton: HTMLButtonElement | undefined = $state();
let awake = $state(false);
let toggle: HTMLButtonElement | undefined;

// The focus state leaves only the reading surface on screen. Pause, a tap, F or Escape
// bring the controls back; the reader can have Play enter it, and that choice is remembered.
let focused = $state(false);
let focusOnPlay = $state(false);
let focusStart = $state<HTMLElement>();

async function enterFocus() {
	if (focused) return;
	focused = true;
	settingsOpen = false;
	// The control that had keyboard focus is about to be hidden. Park focus just before the
	// leave button: Space still plays or pauses, and the next Tab reaches that button. A bare
	// blur would leave Tab starting from the hidden control.
	const active = document.activeElement;
	if (active instanceof HTMLElement && active.closest("[data-chrome]")) {
		await tick();
		focusStart?.focus();
	}
}

/**
 * Bring the controls back. After a key, keyboard focus returns to Play/Pause, where it was
 * before the controls went; a tap leaves it where the pointer put it.
 */
async function leaveFocus(by: "key" | "pointer" = "key") {
	if (!focused) return;
	const needsRefocus =
		by === "key" &&
		(document.activeElement === document.body ||
			document.activeElement === focusStart ||
			document.activeElement?.closest("[data-focus-leave]") != null);
	focused = false;
	if (needsRefocus) {
		await tick();
		toggle?.focus();
	}
}

function toggleFocus() {
	if (focused) void leaveFocus();
	else void enterFocus();
}

function setFocusOnPlay(on: boolean) {
	focusOnPlay = on;
	saveFocusOnPlay(deviceStorage(), on);
}

// The chrome dims while reading and comes back for a moment after any key or touch. Hover
// and keyboard focus bring it back too (see the styles).
const dimmed = $derived(playing && !awake);
let wakeTimer: ReturnType<typeof setTimeout> | undefined;
const WAKE_MS = 2500;

function wake() {
	awake = true;
	clearTimeout(wakeTimer);
	wakeTimer = setTimeout(() => {
		awake = false;
	}, WAKE_MS);
}

onMount(() => {
	const engine = reading.engine;
	playing = engine.playing;
	focusOnPlay = loadFocusOnPlay(deviceStorage());
	// A mode view plays the Engine from its own effect, which runs these handlers inside it;
	// untrack keeps that effect from depending on the focus state it reads here.
	const stops = [
		engine.on("play", () =>
			untrack(() => {
				playing = true;
				countdown.cancel();
				if (focusOnPlay) void enterFocus();
			}),
		),
		engine.on("pause", () =>
			untrack(() => {
				playing = false;
				void leaveFocus();
			}),
		),
		engine.on("end", () =>
			untrack(() => {
				playing = false;
				void leaveFocus();
			}),
		),
	];
	// Ambient noise and the tick follow this reading; a mode on the timer Clock makes no sound.
	stops.push(
		attachReadingSound({
			engine,
			audio: audio(),
			silent: () => mode?.clock === "timer",
			page: window,
		}),
	);
	toggle?.focus();
	return () => {
		for (const stop of stops) stop();
		countdown.cancel();
		clearTimeout(wakeTimer);
	};
});

// The header sits outside this component; the page stylesheet dims it from this mark.
$effect(() => {
	const root = document.documentElement;
	if (dimmed) root.dataset.reading = "playing";
	else delete root.dataset.reading;
	return () => {
		delete root.dataset.reading;
	};
});

// The page stylesheet fits the reader to the screen from this mark.
$effect(() => {
	const root = document.documentElement;
	root.dataset.reader = "";
	return () => {
		delete root.dataset.reader;
	};
});

// The header and footer sit outside this component; the page stylesheet hides them from
// this mark.
$effect(() => {
	const root = document.documentElement;
	if (focused) root.dataset.focus = "on";
	else delete root.dataset.focus;
	return () => {
		delete root.dataset.focus;
	};
});

// A visual mode pauses on a hidden tab, so the reader does not lose text they never saw.
$effect(() => {
	if (!mode || !pausesWhenHidden(mode)) return;
	return pauseWhenHidden(reading.engine, { document });
});

/** A change the reader made: it applies at once and is kept on this device. */
function setSettings(change: Partial<ReaderSettings>) {
	settings = { ...settings, ...change };
	reading.live.change(enginePatch(change, settings));
	saveReaderSettings(deviceStorage(), settings);
}

function closeSettings() {
	settingsOpen = false;
	settingsButton?.focus();
}

function applyPreset(preset: Preset) {
	setSettings(preset.settings);
	audio().setPrefs(preset.sound);
	selectMode(preset.mode);
}

function setWpm(wpm: number) {
	if (!usesWpm) return;
	const next = clampWpm(wpm);
	if (next !== settings.wpm) setSettings({ wpm: next });
}

function selectMode(id: ModeId) {
	if (id === modeId) return;
	const next = readerModes.get(id);
	if (!next) return;
	autoplay = reading.engine.playing;
	countdown.cancel();
	// Each Clock keeps its own time, so the Engine stops before it changes Clock and the next
	// mode plays on from the same Position.
	reading.engine.pause();
	reading.useClock(next.clock);
	modeId = id;
}

function togglePlay() {
	const engine = reading.engine;
	if (engine.playing) engine.pause();
	else if (countdown.running) countdown.cancel();
	else if (settings.countdown && usesCountdown) countdown.start();
	else engine.play();
}

/** Rewind. There is nowhere to go back to without chapters, so that rewind does nothing. */
function rewind(unit: BackUnit) {
	if (unit === "chapter" && chapters.length === 0) return;
	reading.engine.back(unit);
}

/** Rewind by the reader's own number of words. */
function rewindWords() {
	reading.engine.backWords(settings.rewindStep);
}

function run(command: ReaderCommand) {
	switch (command.kind) {
		case "toggle":
			togglePlay();
			break;
		case "back":
			rewind(command.unit);
			break;
		case "back-words":
			rewindWords();
			break;
		case "speed":
			setWpm(settings.wpm + command.delta);
			break;
		case "mode":
			selectMode(
				nextMode(
					modes.map((entry) => entry.id),
					modeId,
					command.step,
				),
			);
			break;
		case "focus":
			toggleFocus();
			break;
		case "help":
			helpOpen = !helpOpen;
			break;
	}
}

function onKeydown(event: KeyboardEvent) {
	wake();
	if (event.defaultPrevented) return;
	if (event.key === "Escape" && focused) {
		event.preventDefault();
		void leaveFocus();
		return;
	}
	if (event.key === "Escape" && settingsOpen) {
		event.preventDefault();
		closeSettings();
		return;
	}
	if (event.key === "Escape" && helpOpen) {
		helpOpen = false;
		return;
	}
	const target = event.target instanceof HTMLElement ? event.target : undefined;
	const command = commandForKey({
		key: event.key,
		shiftKey: event.shiftKey,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		altKey: event.altKey,
		target: target && {
			tagName: target.tagName,
			role: target.getAttribute("role"),
			isContentEditable: target.isContentEditable,
		},
	});
	if (!command) return;
	event.preventDefault();
	run(command);
}
</script>

<svelte:window
	onkeydown={onKeydown}
	onpointerdown={() => {
		wake();
		void leaveFocus("pointer");
	}}
/>

<h1 class="sr-only" data-testid="reader-source" data-source={source}>
	{title ?? m.reader_reading()}
</h1>

<p role="status" class="sr-only">{focused ? m.reader_focus_status() : ""}</p>
{#if focused}
	<span class="focus-start" tabindex="-1" bind:this={focusStart}></span>
	<!-- Hidden until a keyboard reaches it: the one control left in focus. -->
	<button type="button" class="leave segment border-2 border-ink" data-focus-leave onclick={() => leaveFocus()}
		>{m.reader_focus_leave()}</button
	>
{/if}

<div class="bar chrome px-gutter pt-s-2" data-dim={dimmed} data-chrome>
	<button type="button" class="segment border-2 border-ink" onclick={onNewText}>
		{m.reader_new_text()}
	</button>
	{#if source === "share"}
		<!-- Anyone can craft a Share Link, so its text is marked as not ours and waits for Play. -->
		<p class="caption w-full text-ink-2" data-testid="shared-notice">{m.reader_shared_notice()}</p>
	{/if}
	<button
		type="button"
		class="segment border-2 border-ink"
		aria-expanded={settingsOpen}
		aria-controls="reader-settings"
		bind:this={settingsButton}
		onclick={() => (settingsOpen ? closeSettings() : (settingsOpen = true))}
		>{m.reader_settings_open()}</button
	>
	<div role="group" aria-label={m.reader_mode_label()} class="segment-group">
		{#each modes as entry (entry.id)}
			<button
				type="button"
				class="segment"
				aria-pressed={entry.id === modeId}
				onclick={() => selectMode(entry.id)}>{modeName(entry.id)}</button
			>
		{/each}
	</div>
</div>

{#if mode}
	{#await mode.view() then view}
		<view.default
			engine={reading.engine}
			{doc}
			{autoplay}
			{language}
			pauseView={settings.pauseView}
			{count}
			clock={reading.clocks[mode.clock] ?? reading.useClock(mode.clock)}
		/>
	{/await}
{/if}

<section class="poster chrome controls pt-s-3" data-testid="controls" data-dim={dimmed} data-chrome data-scroll>
	{#if usesWpm}
		<div class="poster-head">
			<WpmSlider wpm={settings.wpm} onchange={setWpm} />
		</div>
	{/if}
	<div class="stack" class:alone={!usesWpm}>
		<!-- Hidden, not removed: the chart keeps recording the speed while it is off. -->
		<div class="progress" hidden={!settings.showProgress}>
			<ProgressChart engine={reading.engine} {doc} {chapters} recordSpeed={usesWpm} />
		</div>
		<div class="transport">
			<button type="button" class="button-primary" bind:this={toggle} onclick={togglePlay}>
				{playing ? m.reader_pause() : count !== null ? m.reader_countdown_cancel() : m.reader_play()}
			</button>
			<div role="group" aria-label={m.reader_rewind_label()} class="rewinds">
				<button
					type="button"
					class="segment border-2 border-ink"
					aria-label={backWordsName(settings.rewindStep)}
					aria-keyshortcuts={WORD_REWIND.keyshortcuts}
					onclick={rewindWords}
				>
					<span aria-hidden="true">←</span>
					{rewindWordsName(settings.rewindStep)}
				</button>
				{#each REWINDS as entry (entry.unit)}
					<button
						type="button"
						class="segment border-2 border-ink"
						aria-label={shortcutName(entry.shortcut)}
						aria-keyshortcuts={entry.keyshortcuts}
						disabled={entry.unit === "chapter" && chapters.length === 0}
						onclick={() => rewind(entry.unit)}
					>
						<span aria-hidden="true">←</span>
						{rewindName(entry.unit)}
					</button>
				{/each}
			</div>
			{#if chapters.length > 0}
				<ChapterList engine={reading.engine} {chapters} />
			{/if}
			<button
				type="button"
				class="segment border-2 border-ink"
				aria-keyshortcuts="F"
				onclick={enterFocus}>{m.reader_focus()}</button
			>
			<Shortcuts bind:open={helpOpen} />
		</div>
		{#if failed}
			<p role="status" class="label text-red-ink">{m.reader_rebuild_failed()}</p>
		{/if}
	</div>
</section>

<div id="reader-settings">
	<SettingsPanel
		bind:open={() => settingsOpen, (open) => (open ? (settingsOpen = true) : closeSettings())}
		{settings}
		onchange={setSettings}
		used={mode?.settingsUsed ?? []}
		{modes}
		{modeId}
		onmode={selectMode}
		onwpm={setWpm}
		silent={mode?.clock === "timer"}
		{focusOnPlay}
		onfocusonplay={setFocusOnPlay}
		snapshot={() => ({ settings, sound: audio().prefs, mode: modeId })}
		onapply={applyPreset}
	/>
</div>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-s-2);
	}

	.stack {
		display: grid;
		gap: var(--spacing-s-3);
		align-content: start;
	}

	/* Without the speed numeral the controls take the content column on their own. */
	@media (min-width: 861px) {
		.stack.alone {
			grid-column: 2;
		}
	}

	.rewinds {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-s-1);
	}

	.transport {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-s-2);
	}

	.controls {
		padding-bottom: var(--spacing-s-4);
	}

	.progress[hidden] {
		display: none;
	}

	.focus-start {
		position: fixed;
		outline: none;
	}

	/* Off screen until the keyboard reaches it, then pinned top left over the text. */
	.leave {
		position: fixed;
		top: var(--spacing-s-1);
		left: var(--spacing-gutter);
		z-index: 10;
		background: var(--color-paper);
	}

	.leave:not(:focus-visible) {
		clip-path: inset(50%);
		width: 1px;
		height: 1px;
		overflow: hidden;
		white-space: nowrap;
		padding: 0;
		border: 0;
	}

	/* Reading chrome drops to 35% while a Session runs and returns on hover, on keyboard
	   focus and for a moment after any key or touch. Reduced motion removes the fade
	   (the stylesheet's reduced-motion rule shortens every transition). */
	.chrome {
		transition: opacity var(--motion-quick) var(--motion-ease);
	}

	.chrome[data-dim="true"]:not(:hover):not(:has(:focus-visible)) {
		opacity: 0.35;
	}
</style>
