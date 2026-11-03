<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import {
	MAX_CHUNK_SIZE,
	MIN_CHUNK_SIZE,
	type ReaderSettings,
} from "./settings.ts";

let {
	settings,
	onchange,
}: {
	settings: ReaderSettings;
	onchange: (change: Partial<ReaderSettings>) => void;
} = $props();

const switches = $derived([
	{
		id: "smartSpeed" as const,
		label: m.reader_smart(),
		note: m.reader_smart_note(),
		checked: settings.smartSpeed,
	},
	{
		id: "punctuationPauses" as const,
		label: m.reader_punctuation(),
		note: m.reader_punctuation_note(),
		checked: settings.punctuationPauses,
	},
	{
		id: "speedRamp" as const,
		label: m.reader_ramp(),
		note: m.reader_ramp_note(),
		checked: settings.speedRamp,
	},
]);
</script>

<div role="group" aria-label={m.reader_settings_label()} class="settings">
	<div class="row">
		<span id="chunk-label" class="label">{m.reader_chunk_label()}</span>
		<span class="steps">
			<button
				type="button"
				class="stepper"
				aria-label={m.reader_chunk_less()}
				disabled={settings.chunkSize <= MIN_CHUNK_SIZE}
				onclick={() => onchange({ chunkSize: settings.chunkSize - 1 })}>−</button
			>
			<output class="value" data-testid="chunk" aria-labelledby="chunk-label"
				>{settings.chunkSize}</output
			>
			<button
				type="button"
				class="stepper"
				aria-label={m.reader_chunk_more()}
				disabled={settings.chunkSize >= MAX_CHUNK_SIZE}
				onclick={() => onchange({ chunkSize: settings.chunkSize + 1 })}>+</button
			>
		</span>
	</div>
	{#each switches as item (item.id)}
		<div class="row">
			<label class="check label" for="setting-{item.id}">{item.label}</label>
			<input
				id="setting-{item.id}"
				type="checkbox"
				checked={item.checked}
				aria-describedby="setting-{item.id}-note"
				onchange={(event) =>
					onchange({
						[item.id]: event.currentTarget.checked,
					} as Partial<ReaderSettings>)}
			/>
			<p id="setting-{item.id}-note" class="caption note text-ink-2">{item.note}</p>
		</div>
	{/each}
</div>

<style>
	.settings {
		display: grid;
		border-top: 4px solid var(--color-ink);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: var(--spacing-s-2);
		min-height: 52px;
		padding-block: var(--spacing-s-1);
		border-bottom: 2px solid var(--color-ink);
	}

	.steps {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-s-1);
	}

	.value {
		min-width: 2ch;
		text-align: center;
		font-size: 1.25rem;
		font-weight: 800;
	}

	.check {
		cursor: pointer;
	}

	input[type="checkbox"] {
		width: 24px;
		height: 24px;
		margin: 0;
		accent-color: var(--color-ink);
		cursor: pointer;
	}

	.note {
		grid-column: 1 / -1;
		margin: 0;
		max-width: 52ch;
	}
</style>
