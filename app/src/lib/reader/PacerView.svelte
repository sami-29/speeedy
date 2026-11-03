<script lang="ts">
import { untrack } from "svelte";
import { m } from "#lib/paraglide/messages.js";
import type { ModeProps } from "./modes.ts";
import { renderPacer } from "./pacer/dom.ts";
import { followCursor } from "./pacer/follow.ts";

let { engine, doc, autoplay = true }: ModeProps = $props();

let pane: HTMLElement | undefined;
let text: HTMLElement | undefined;

// The text is drawn once; after that the Engine's Frames only change the state of the few
// nodes that moved. Nothing about the highlight is reactive state, so playing never
// re-renders this component. Leaving pauses the Engine, like every mode's view.
$effect(() => {
	const current = engine;
	const document = doc;
	if (!pane || !text) return;
	const view = renderPacer(pane, text, document, {
		image: m.reader_pacer_image(),
	});
	const stop = followCursor(current, view.show);
	// A change of the pane's size moves the current line: put it back in view.
	const observer = new ResizeObserver(() => view.reveal());
	observer.observe(pane);
	if (untrack(() => autoplay)) current.play();
	return () => {
		current.pause();
		observer.disconnect();
		stop();
		view.dispose();
	};
});
</script>

<div class="poster pacer">
	<!-- The axis is drawn by the page; the text begins one gap to its right. -->
	<!-- The pane scrolls, so the keyboard has to reach it (axe: scrollable-region-focusable). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<section
		class="pane"
		data-testid="pacer"
		aria-label={m.reader_pacer_label()}
		tabindex="0"
		bind:this={pane}
	>
		<div class="text" bind:this={text}></div>
	</section>
</div>

<style>
	.pacer {
		padding-top: var(--spacing-s-2);
	}

	@media (min-width: 861px) {
		.pane {
			grid-column: 2;
		}
	}

	/* A heavy rule above and below frames the stretch of text, as the stage's track does. */
	.pane {
		min-width: 0;
		height: clamp(16rem, 46vh, 38rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		border-block: 4px solid var(--color-ink);
		padding-block: var(--spacing-s-3);
		scroll-behavior: auto;
	}

	.text {
		display: grid;
		gap: var(--spacing-s-2);
		max-width: 52ch;
		font-size: clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem);
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	.text > :global(*) {
		min-width: 0;
		margin: 0;
	}

	/* A block entirely before the current one has been read. */
	.text :global([data-read]) {
		color: var(--color-ink-3);
	}

	/* Words in the current block. Read words are faint; the word ahead is plain ink; the
	   current Frame is plain ink with a 4px vermilion underline, the one red thing in the
	   text. Only colour and an inset shadow change, so the lines never shift. */
	.text :global([data-state="read"]) {
		color: var(--color-ink-3);
	}

	.text :global([data-state="now"]) {
		box-shadow: inset 0 -4px 0 var(--color-red);
	}

	.text :global([data-em]) {
		font-style: italic;
	}

	.text :global([data-strong]) {
		font-weight: 750;
	}

	.text :global(a) {
		text-decoration: underline;
	}

	/* Headings: heavy and condensed, a rule above the section heads. */
	.text :global([data-kind="heading"]) {
		margin-top: var(--spacing-s-4);
		font-size: 1.25rem;
		font-weight: 830;
		line-height: 1;
		letter-spacing: -0.02em;
		font-variation-settings: "wdth" 82;
	}

	.text :global([data-kind="heading"][data-level="1"]) {
		font-size: clamp(2rem, 1.4rem + 2.4vw, 3rem);
		line-height: 0.95;
	}

	.text :global([data-kind="heading"][data-level="2"]) {
		font-size: 1.75rem;
	}

	.text :global([data-kind="heading"][data-level="1"]),
	.text :global([data-kind="heading"][data-level="2"]) {
		padding-top: var(--spacing-s-2);
		border-top: 2px solid var(--color-ink);
	}

	.text > :global([data-kind]:first-child) {
		margin-top: 0;
		padding-top: 0;
		border-top: 0;
	}

	.text :global([role="list"]) {
		display: grid;
		gap: var(--spacing-s-1);
	}

	.text :global([data-kind="list-item"]) {
		position: relative;
		margin-left: calc(var(--depth, 0) * 1.5em);
		padding-left: 1.75em;
	}

	.text :global([data-kind="list-item"])::before {
		content: attr(data-marker);
		position: absolute;
		left: 0;
		font-weight: 750;
		font-feature-settings: "tnum";
	}

	.text :global([data-kind="quote"]) {
		padding-left: var(--spacing-s-2);
		border-left: 4px solid var(--color-ink);
		font-weight: 500;
	}

	.text :global([data-kind="code"]) {
		padding-left: var(--spacing-s-2);
		border-left: 2px solid var(--color-ink);
		font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
		font-size: 0.85em;
		line-height: 1.6;
		white-space: pre-wrap;
	}

	.text :global([data-kind="table-text"]) {
		padding-block: var(--spacing-s-1);
		border-bottom: 2px solid var(--color-rule);
		font-size: 1rem;
		font-weight: 500;
		font-feature-settings: "tnum";
	}

	.text :global([data-kind="caption"]) {
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.5;
		color: var(--color-ink-2);
	}

	/* An image has no bytes here: a stroked place with the word and its alt text. */
	.text :global([data-kind="image-placeholder"]) {
		padding: var(--spacing-s-2);
		border: 2px solid var(--color-ink);
	}

	.text :global([data-kind="image-placeholder"] .tag) {
		display: block;
		font-size: 0.9375rem;
		font-weight: 750;
		line-height: 1.5;
	}

	.text :global([data-kind="image-placeholder"] .alt) {
		margin: var(--spacing-s-1) 0 0;
	}
</style>
