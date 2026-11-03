<script lang="ts">
import type { Frame } from "@speeedy/engine";
import { m } from "#lib/paraglide/messages.js";
import type { ModeProps } from "./modes.ts";

let { engine, autoplay = true }: ModeProps = $props();

// The word is written straight into these nodes from the engine's frame events.
// Nothing about the word is reactive state, so playing never re-renders the component.
let word: HTMLElement | undefined;
let before: HTMLElement | undefined;
let pivot: HTMLElement | undefined;
let after: HTMLElement | undefined;

$effect(() => {
	const current = engine;
	let words = "";
	const show = (frame: Frame) => {
		if (before) before.textContent = frame.orp.before;
		if (pivot) pivot.textContent = frame.orp.pivot;
		if (after) after.textContent = frame.orp.after;
		// A chunk of several words is set smaller so it still fits beside the axis.
		const next = String(frame.words);
		if (word && next !== words) {
			words = next;
			word.style.setProperty("--words", next);
		}
	};
	const stops = [
		current.on("frameShown", ({ frame }) => show(frame)),
		// A rewind or seek while paused moves the Cursor without a `frameShown`.
		current.on("seek", () => {
			if (current.frame) show(current.frame);
		}),
	];
	if (current.frame) show(current.frame);
	if (autoplay) current.play();
	return () => {
		current.pause();
		for (const stop of stops) stop();
	};
});
</script>

<section class="stage" data-testid="stage" aria-label={m.reader_stage_label()}>
	<div class="axis" aria-hidden="true"></div>
	<p class="word" data-testid="word" bind:this={word}><span class="side before" data-part="before" bind:this={before}></span><span class="pivot" data-part="pivot" bind:this={pivot}></span><span class="side after" data-part="after" bind:this={after}></span></p>
</section>

<style>
	/* The stage is as wide as <main>, so its 35% is the page's reading axis. */
	.stage {
		position: relative;
		display: flex;
		align-items: center;
		min-height: 36vh;
		overflow-x: clip;
	}

	/* The page draws the axis from 861px up. Below that, the stage draws its own. */
	.axis {
		position: absolute;
		inset-block: 0;
		left: 35%;
		width: 3px;
		background: var(--color-red);
	}

	@media (min-width: 861px) {
		.axis {
			display: none;
		}
	}

	/* A box centred on the axis, with the pivot letter in the middle column. The word is
	   cut in and out: no transition, no animation, no opacity. */
	.word {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		width: calc(70% + 3px);
		margin: 0;
		font-size: calc(
			clamp(2.25rem, 1rem + 5.5vw, 5.5rem) / (1 + (var(--words, 1) - 1) * 0.45)
		);
		font-weight: 600;
		font-variation-settings: "wdth" 100;
		line-height: 1.1;
		white-space: nowrap;
	}

	.before {
		justify-self: end;
	}

	.after {
		justify-self: start;
	}

	.pivot {
		color: var(--color-red);
	}
</style>
