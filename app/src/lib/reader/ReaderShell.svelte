<script lang="ts">
import type { Document } from "@speeedy/contracts";
import type { BackUnit } from "@speeedy/engine";
import { onMount } from "svelte";
import { m } from "#lib/paraglide/messages.js";
import ChapterList from "./ChapterList.svelte";
import { modeName, rewindName, shortcutName } from "./copy.ts";
import { pausesWhenHidden, readerModes } from "./modes.ts";
import type { Chapter } from "./navigation.ts";
import ProgressChart from "./ProgressChart.svelte";
import { pauseWhenHidden } from "./pacer/hidden.ts";
import ReadingSettings from "./ReadingSettings.svelte";
import type { Reading } from "./reading.ts";
import Shortcuts from "./Shortcuts.svelte";
import SpeedZones from "./SpeedZones.svelte";
import { enginePatch, type ReaderSettings } from "./settings.ts";
import {
	commandForKey,
	nextMode,
	REWINDS,
	type ReaderCommand,
} from "./shortcuts.ts";
import WpmSlider from "./WpmSlider.svelte";
import { clampWpm } from "./wpm.ts";

let {
	reading,
	doc,
	chapters,
	title,
	source,
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
	settings: ReaderSettings;
	failed?: boolean;
	onNewText: () => void;
} = $props();

const modes = readerModes.modes();
let modeId = $state(modes[0]?.id ?? "rsvp");
const mode = $derived(readerModes.get(modeId));
// A shared text waits for Play. After a switch, the next mode plays if the last one was.
// svelte-ignore state_referenced_locally
let autoplay = $state(source !== "share");

let playing = $state(false);
let helpOpen = $state(false);
let awake = $state(false);
let toggle: HTMLButtonElement | undefined;

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
	const stops = [
		engine.on("play", () => {
			playing = true;
		}),
		engine.on("pause", () => {
			playing = false;
		}),
		engine.on("end", () => {
			playing = false;
		}),
	];
	toggle?.focus();
	return () => {
		for (const stop of stops) stop();
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

// A visual mode pauses on a hidden tab, so the reader does not lose text they never saw.
$effect(() => {
	if (!mode || !pausesWhenHidden(mode)) return;
	return pauseWhenHidden(reading.engine, { document });
});

function setSettings(change: Partial<ReaderSettings>) {
	settings = { ...settings, ...change };
	reading.live.change(enginePatch(change));
}

function setWpm(wpm: number) {
	const next = clampWpm(wpm);
	if (next !== settings.wpm) setSettings({ wpm: next });
}

function selectMode(id: string) {
	if (id === modeId) return;
	autoplay = reading.engine.playing;
	modeId = id;
}

function togglePlay() {
	const engine = reading.engine;
	if (engine.playing) engine.pause();
	else engine.play();
}

/** Rewind. There is nowhere to go back to without chapters, so that rewind does nothing. */
function rewind(unit: BackUnit) {
	if (unit === "chapter" && chapters.length === 0) return;
	reading.engine.back(unit);
}

function run(command: ReaderCommand) {
	switch (command.kind) {
		case "toggle":
			togglePlay();
			break;
		case "back":
			rewind(command.unit);
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
		case "help":
			helpOpen = !helpOpen;
			break;
	}
}

function onKeydown(event: KeyboardEvent) {
	wake();
	if (event.defaultPrevented) return;
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

<svelte:window onkeydown={onKeydown} onpointerdown={wake} />

<h1 class="sr-only" data-testid="reader-source" data-source={source}>
	{title ?? m.reader_reading()}
</h1>

<div class="bar chrome px-gutter pt-s-2" data-dim={dimmed}>
	<button type="button" class="segment border-2 border-ink" onclick={onNewText}>
		{m.reader_new_text()}
	</button>
	{#if source === "share"}
		<!-- Anyone can craft a Share Link, so its text is marked as not ours and waits for Play. -->
		<p class="caption w-full text-ink-2" data-testid="shared-notice">{m.reader_shared_notice()}</p>
	{/if}
	<div role="group" aria-label={m.reader_mode_label()} class="flex border-2 border-ink">
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
		<view.default engine={reading.engine} {doc} {autoplay} />
	{/await}
{/if}

<section class="poster chrome controls pt-s-3" data-testid="controls" data-dim={dimmed}>
	<div class="poster-head">
		<WpmSlider wpm={settings.wpm} onchange={setWpm} />
	</div>
	<div class="stack">
		<ProgressChart engine={reading.engine} {doc} {chapters} />
		<div class="transport">
			<button type="button" class="button-primary" bind:this={toggle} onclick={togglePlay}>
				{playing ? m.reader_pause() : m.reader_play()}
			</button>
			<div role="group" aria-label={m.reader_rewind_label()} class="rewinds">
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
			<Shortcuts bind:open={helpOpen} />
		</div>
		{#if failed}
			<p role="status" class="label text-red-ink">{m.reader_rebuild_failed()}</p>
		{/if}
		<SpeedZones wpm={settings.wpm} onpick={setWpm} />
		<ReadingSettings {settings} onchange={setSettings} />
	</div>
</section>

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

	/* Reading chrome drops to 35% while a Session runs and returns on hover, on keyboard
	   focus and for a moment after any key or touch. Reduced motion removes the fade
	   (the stylesheet's reduced-motion rule shortens every transition). */
	.chrome {
		transition: opacity 200ms var(--ease-out);
	}

	.chrome[data-dim="true"]:not(:hover):not(:has(:focus-visible)) {
		opacity: 0.35;
	}
</style>
