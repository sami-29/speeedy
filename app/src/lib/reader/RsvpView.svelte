<script lang="ts">
import { createEngine, createTimerClock, type Engine } from "@speeedy/engine";
import { m } from "#lib/paraglide/messages.js";
import type { ModeProps } from "./modes.ts";

let { timeline, wpm }: ModeProps = $props();

// The word is written straight into these three nodes from the engine's frame events.
// Nothing about the word is reactive state, so playing never re-renders the component.
let before: HTMLElement | undefined;
let pivot: HTMLElement | undefined;
let after: HTMLElement | undefined;
let toggle: HTMLButtonElement | undefined;
let engine: Engine | undefined;

// Only the button label follows this, and it changes on play and pause, not per word.
let playing = $state(false);

$effect(() => {
	const current = createEngine({ clock: createTimerClock(), timeline });
	const stops = [
		current.on("frameShown", ({ frame }) => {
			if (before) before.textContent = frame.orp.before;
			if (pivot) pivot.textContent = frame.orp.pivot;
			if (after) after.textContent = frame.orp.after;
		}),
		current.on("play", () => {
			playing = true;
		}),
		current.on("pause", () => {
			playing = false;
		}),
		current.on("end", () => {
			playing = false;
		}),
	];
	engine = current;
	current.play();
	toggle?.focus();
	return () => {
		current.pause();
		for (const stop of stops) stop();
	};
});

function onToggle() {
	if (!engine) return;
	if (engine.playing) engine.pause();
	else engine.play();
}
</script>

<section class="stage" data-testid="stage" aria-label={m.reader_stage_label()}>
	<div class="axis" aria-hidden="true"></div>
	<p class="word" data-testid="word"><span class="side before" data-part="before" bind:this={before}></span><span class="pivot" data-part="pivot" bind:this={pivot}></span><span class="side after" data-part="after" bind:this={after}></span></p>
</section>

<div class="poster pt-s-3">
	<p class="numeral-small poster-head" data-testid="wpm">{m.reader_wpm({ wpm })}</p>
	<div>
		<button type="button" class="button-primary" bind:this={toggle} onclick={onToggle}>
			{playing ? m.reader_pause() : m.reader_play()}
		</button>
	</div>
</div>

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
		font-size: clamp(2.25rem, 1rem + 5.5vw, 5.5rem);
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

	.numeral-small {
		font-size: 1.75rem;
		font-weight: 820;
		line-height: 1.2;
		font-variation-settings: "wdth" 112;
		margin: 0;
	}
</style>
