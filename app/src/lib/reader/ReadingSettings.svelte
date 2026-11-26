<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import NumberRow from "./NumberRow.svelte";
import {
	MAX_CHUNK_SIZE,
	MIN_CHUNK_SIZE,
	type NumberRange,
	PARAGRAPH_PAUSE_RANGE,
	RAMP_LENGTH_RANGE,
	RAMP_TARGET_RANGE,
	REWIND_STEP_RANGE,
	type ReaderSettings,
	SENTENCE_PAUSE_RANGE,
} from "./settings.ts";

let {
	settings,
	onchange,
	used,
	label = m.reader_settings_label(),
}: {
	settings: ReaderSettings;
	onchange: (change: Partial<ReaderSettings>) => void;
	/** The settings the open mode reads. Rows for the others are left out. */
	used: readonly string[];
	/** The group's accessible name. */
	label?: string;
} = $props();

type Switch = {
	kind: "switch";
	id: keyof ReaderSettings & string;
	label: string;
	note: string;
	checked: boolean;
	sub?: boolean;
};
type Count = {
	kind: "number";
	id: keyof ReaderSettings & string;
	label: string;
	note?: string;
	unit?: string;
	value: number;
	range: NumberRange;
	sub?: boolean;
};
type Row = Switch | Count;

// The rows in the order they show. A row for a number that belongs to a switch (the pause
// lengths, the ramp's target) is there only while that switch is on.
const pauseRows = $derived<Row[]>(
	settings.punctuationPauses
		? [
				{
					kind: "number",
					id: "sentencePause",
					label: m.reader_sentence_pause(),
					note: m.reader_sentence_pause_note(),
					value: settings.sentencePause,
					range: SENTENCE_PAUSE_RANGE,
					sub: true,
				},
				{
					kind: "number",
					id: "paragraphPause",
					label: m.reader_paragraph_pause(),
					note: m.reader_paragraph_pause_note(),
					value: settings.paragraphPause,
					range: PARAGRAPH_PAUSE_RANGE,
					sub: true,
				},
				{
					kind: "switch",
					id: "commaPause",
					label: m.reader_comma_pause(),
					note: m.reader_comma_pause_note(),
					checked: settings.commaPause,
					sub: true,
				},
				{
					kind: "switch",
					id: "asidePause",
					label: m.reader_aside_pause(),
					note: m.reader_aside_pause_note(),
					checked: settings.asidePause,
					sub: true,
				},
			]
		: [],
);
const rampRows = $derived<Row[]>(
	settings.speedRamp
		? [
				{
					kind: "number",
					id: "rampTarget",
					label: m.reader_ramp_target(),
					unit: m.reader_wpm_unit(),
					value: settings.rampTarget,
					range: RAMP_TARGET_RANGE,
					sub: true,
				},
				{
					kind: "number",
					id: "rampLength",
					label: m.reader_ramp_length(),
					note: m.reader_ramp_length_note(),
					unit: m.reader_unit_words(),
					value: settings.rampLength,
					range: RAMP_LENGTH_RANGE,
					sub: true,
				},
			]
		: [],
);
const all = $derived<Row[]>([
	{
		kind: "switch",
		id: "smartSpeed",
		label: m.reader_smart(),
		note: m.reader_smart_note(),
		checked: settings.smartSpeed,
	},
	{
		kind: "switch",
		id: "punctuationPauses",
		label: m.reader_punctuation(),
		note: m.reader_punctuation_note(),
		checked: settings.punctuationPauses,
	},
	...pauseRows,
	{
		kind: "switch",
		id: "speedRamp",
		label: m.reader_ramp(),
		note: m.reader_ramp_note(),
		checked: settings.speedRamp,
	},
	...rampRows,
	{
		kind: "number",
		id: "rewindStep",
		label: m.reader_rewind_step(),
		note: m.reader_rewind_step_note(),
		unit: m.reader_unit_words(),
		value: settings.rewindStep,
		range: REWIND_STEP_RANGE,
	},
	{
		kind: "switch",
		id: "countdown",
		label: m.reader_countdown(),
		note: m.reader_countdown_note(),
		checked: settings.countdown,
	},
]);
const rows = $derived(all.filter((item) => used.includes(item.id)));
const chunk = $derived(used.includes("chunkSize"));
</script>

{#if chunk || rows.length > 0}
<div role="group" aria-label={label} class="settings">
	{#if chunk}
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
	{/if}
	{#each rows as item (item.id)}
		{#if item.kind === "number"}
			<NumberRow
				id="setting-{item.id}"
				label={item.label}
				note={item.note}
				unit={item.unit}
				value={item.value}
				range={item.range}
				sub={item.sub}
				onchange={(value) => onchange({ [item.id]: value } as Partial<ReaderSettings>)}
			/>
		{:else}
			<div class="row" class:sub={item.sub}>
				<label class="check label name" for="setting-{item.id}">{item.label}</label>
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
		{/if}
	{/each}
</div>
{/if}

<style>
	.settings {
		display: grid;
		border-top: var(--rule-heavy) solid var(--color-ink);
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
	}

	.sub .name,
	.sub .note {
		padding-inline-start: var(--spacing-s-2);
	}

	.note {
		grid-column: 1 / -1;
		margin: 0;
		max-width: 52ch;
	}
</style>
