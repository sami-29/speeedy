<script lang="ts">
import type { Engine } from "@speeedy/engine";
import { m } from "#lib/paraglide/messages.js";
import { type Chapter, chapterAt } from "./navigation.ts";

/**
 * The chapters of the open text behind a button, as a labelled list. Picking one moves the
 * reader to the start of that chapter; the one the reader is in is marked.
 */
let { engine, chapters }: { engine: Engine; chapters: readonly Chapter[] } =
	$props();

let open = $state(false);
let current = $state(-1);

$effect(() => {
	const reading = engine;
	const place = () => {
		const position = reading.position;
		current = position ? chapterAt(chapters, position) : -1;
	};
	const stops = [reading.on("frameShown", place), reading.on("seek", place)];
	place();
	return () => {
		for (const stop of stops) stop();
	};
});
</script>

<button
	type="button"
	class="segment border-2 border-ink"
	aria-expanded={open}
	aria-controls="chapter-list"
	onclick={() => (open = !open)}
>
	{m.reader_chapters()}
</button>

<ol id="chapter-list" class="list" aria-label={m.reader_chapters()} hidden={!open}>
	{#each chapters as chapter, i (i)}
		<li>
			<button
				type="button"
				class="item"
				aria-current={i === current ? "true" : undefined}
				onclick={() => engine.seek(chapter.position)}
			>
				<span class="swatch" aria-hidden="true"></span>
				<span class="title">{chapter.title}</span>
			</button>
		</li>
	{/each}
</ol>

<style>
	.list {
		grid-column: 1 / -1;
		flex-basis: 100%;
		order: 1;
		max-height: 14rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
		border-top: 4px solid var(--color-ink);
	}

	.list[hidden] {
		display: none;
	}

	.item {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr);
		align-items: center;
		gap: var(--spacing-s-2);
		width: 100%;
		min-height: 44px;
		padding-inline: var(--spacing-s-1);
		border-bottom: 2px solid var(--color-rule);
		color: var(--color-ink-3);
		font-weight: 750;
		text-align: left;
		cursor: pointer;
	}

	.item:hover {
		background: var(--color-paper-2);
	}

	.item[aria-current="true"] {
		color: var(--color-ink);
	}

	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Stroked for the other chapters, filled red for the one the reader is in: red means "now". */
	.swatch {
		width: 18px;
		height: 18px;
		box-shadow: inset 0 0 0 2px var(--color-ink-3);
	}

	.item[aria-current="true"] .swatch {
		background: var(--color-red);
		box-shadow: none;
	}
</style>
