<script lang="ts">
import type { Document, Position } from "@speeedy/contracts";
import type { Engine } from "@speeedy/engine";
import { untrack } from "svelte";
import { progressSeeker, progressTracker } from "#lib/library/progress.ts";
import { m } from "#lib/paraglide/messages.js";
import {
	type Chapter,
	chapterAt,
	progressForKey,
	progressFromPointer,
} from "./navigation.ts";
import { createSpeedTrace } from "./speed-trace.ts";
import ZoneBands from "./ZoneBands.svelte";
import { chartTop, zoneFor } from "./zones.ts";

/**
 * The reader's progress bar and its speed chart in one: a slider over the text, drawn on the
 * Speed Zone bands, with a bar for each stretch showing the speed it was read at and a red
 * mark at the reading position. Drag it, press on it or use the slider keys to seek.
 */
let {
	engine,
	doc: source,
	chapters,
	recordSpeed = true,
}: {
	engine: Engine;
	doc: Document;
	chapters: readonly Chapter[];
	/** Draw the speed read at. False in a mode the reading speed does not pace (Listen). */
	recordSpeed?: boolean;
} = $props();

const track = $derived(progressTracker(source));
const seek = $derived(progressSeeker(source));
const trace = createSpeedTrace();

// The mark moves from the engine's frame events without going through the framework, so
// reading never re-renders this component. Only the whole percent, the chapter and the bars
// are state: they change a few dozen times over a whole text.
let slider: HTMLElement | undefined;
let mark: HTMLElement | undefined;
let share = 0;
let percent = $state(0);
let chapter = $state(-1);
let bars = $state.raw(trace.values());
let dragging = $state(false);
// Set while this component moves the Engine, so the move is not read back as the Engine's.
let moving = false;

const top = $derived(chartTop(Math.max(0, ...bars.map((bar) => bar ?? 0))));

let markAt = -1;

function show(value: number, position: Position) {
	share = value;
	// The mark moves one tenth of a percent at a time: finer is under a pixel.
	const tenths = Math.round(value * 1000);
	if (mark && tenths !== markAt) {
		markAt = tenths;
		mark.style.left = `${tenths / 10}%`;
	}
	percent = Math.round(value * 100);
	chapter = chapterAt(chapters, position);
}

$effect(() => {
	const current = engine;
	const where = track;
	const stops = [
		current.on("frameShown", ({ position }) => {
			const value = where(position);
			show(value, position);
			// Only reading counts: a rebuild or a seek that shows a Frame does not.
			if (
				// Read outside the effect that started the Engine, which runs this handler.
				untrack(() => recordSpeed) &&
				current.playing &&
				trace.record(value, current.settings.wpm)
			) {
				bars = trace.values();
			}
		}),
		current.on("seek", ({ position }) => {
			if (!moving) show(where(position), position);
		}),
	];
	if (current.position) show(where(current.position), current.position);
	return () => {
		for (const stop of stops) stop();
	};
});

function seekTo(value: number) {
	const position = seek(value);
	moving = true;
	try {
		engine.seek(position);
	} finally {
		moving = false;
	}
	show(value, position);
}

const valueText = $derived(
	chapters[chapter]
		? m.reader_progress_text_chapter({
				percent,
				chapter: chapters[chapter].title,
			})
		: m.reader_progress_text({ percent }),
);

function onKeydown(event: KeyboardEvent) {
	const next = progressForKey(event, share);
	if (next === undefined) return;
	event.preventDefault();
	seekTo(next);
}

function fromPointer(event: PointerEvent): number {
	const box = slider?.getBoundingClientRect();
	return box ? progressFromPointer(event.clientX, box.left, box.width) : 0;
}

function onPointerDown(event: PointerEvent) {
	if (event.button !== 0) return;
	dragging = true;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	seekTo(fromPointer(event));
}

function onPointerMove(event: PointerEvent) {
	if (dragging) seekTo(fromPointer(event));
}

function endDrag(event: PointerEvent) {
	dragging = false;
	const target = event.currentTarget as HTMLElement;
	if (target.hasPointerCapture(event.pointerId)) {
		target.releasePointerCapture(event.pointerId);
	}
}

/** Where each chapter after the first starts along the bar. */
const ticks = $derived(
	chapters
		.map((each) => track(each.position))
		.filter((value) => value > 0 && value < 1),
);
</script>

<div class="chart" data-testid="progress-chart">
	<ZoneBands {top} ranges={false} />
	<div
		bind:this={slider}
		class="plot"
		class:dragging
		role="slider"
		tabindex="0"
		aria-label={m.reader_progress_label()}
		aria-describedby="progress-note"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={percent}
		aria-valuetext={valueText}
		onkeydown={onKeydown}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={endDrag}
		onpointercancel={endDrag}
	>
		{#each ticks as value, i (i)}
			<span class="tick" aria-hidden="true" style:left="{value * 100}%"></span>
		{/each}
		{#each bars as wpm, i (i)}
			{#if wpm !== null}
				<span
					class="bar"
					aria-hidden="true"
					data-testid="trace-bar"
					data-band={zoneFor(wpm).id}
					data-wpm={wpm}
					style:left="{(i / bars.length) * 100}%"
					style:width="{100 / bars.length}%"
					style:height="{(wpm / top) * 100}%"
				></span>
			{/if}
		{/each}
		<span class="mark" aria-hidden="true" data-testid="playhead" bind:this={mark}></span>
	</div>
</div>
<p id="progress-note" class="caption text-ink-2">{m.reader_progress_note()}</p>

<style>
	.chart {
		position: relative;
		height: 128px;
		border-bottom: 4px solid var(--color-ink);
	}

	/* The slider is the plot: it starts to the right of the band names, so the bars never
	   cover them, and a press anywhere on it is a place in the text. */
	.plot {
		position: absolute;
		inset-block: 0;
		left: 4.5rem;
		right: 0;
		cursor: pointer;
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
	}

	.plot.dragging {
		cursor: grabbing;
	}

	/* A stretch's speed, standing from the floor of the chart. A hairline of paper keeps
	   neighbouring bars apart. */
	.bar {
		position: absolute;
		bottom: 0;
		background: var(--color-ink);
		box-shadow: inset -1px 0 0 var(--color-paper);
		pointer-events: none;
	}

	.tick {
		position: absolute;
		inset-block: 0;
		width: 1px;
		background: var(--color-ink-3);
		pointer-events: none;
	}

	/* Vermilion marks the reading position and nothing else on this chart. */
	.mark {
		position: absolute;
		inset-block: 0;
		left: 0;
		width: 3px;
		margin-left: -1px;
		background: var(--color-red);
		pointer-events: none;
	}
</style>
