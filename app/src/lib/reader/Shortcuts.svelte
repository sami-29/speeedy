<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { shortcutName } from "./copy.ts";
import { SHORTCUTS } from "./shortcuts.ts";

let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<button
	type="button"
	class="segment border-2 border-ink"
	aria-expanded={open}
	aria-controls="shortcut-list"
	onclick={() => (open = !open)}
>
	{m.reader_shortcuts()}
</button>

<ul id="shortcut-list" class="list" aria-label={m.reader_shortcuts()} hidden={!open}>
	{#each SHORTCUTS as shortcut (shortcut.id)}
		<li class="item">
			<span class="keys">
				{#each shortcut.keys as key (key)}
					<kbd class="key">{key}</kbd>
				{/each}
			</span>
			<span>{shortcutName(shortcut.id)}</span>
		</li>
	{/each}
</ul>

<style>
	.list {
		grid-column: 1 / -1;
		flex-basis: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 4px solid var(--color-ink);
	}

	.list[hidden] {
		display: none;
	}

	.item {
		display: grid;
		grid-template-columns: minmax(7.5rem, 11rem) minmax(0, 1fr);
		align-items: center;
		column-gap: var(--spacing-s-2);
		min-height: 44px;
		border-bottom: 2px solid var(--color-ink);
		font-weight: 600;
	}

	.keys {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.key {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		min-height: 28px;
		padding-inline: 6px;
		border: 2px solid var(--color-ink);
		font-family: inherit;
		font-size: 0.9375rem;
		font-weight: 750;
	}
</style>
