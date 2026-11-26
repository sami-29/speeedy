<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { clampRange, type NumberRange } from "./settings.ts";

let {
	id,
	label,
	note,
	unit,
	value,
	range,
	sub = false,
	onchange,
}: {
	/** The field's id, and the stem of its note's. */
	id: string;
	label: string;
	note?: string;
	/** What the number counts, set after the field: "×", "WPM", "words". */
	unit?: string;
	value: number;
	range: NumberRange;
	/** The row belongs to the switch above it, and sits in from the edge. */
	sub?: boolean;
	onchange: (value: number) => void;
} = $props();

// Typing is committed when the field is left or Enter is pressed: a number held between
// keystrokes would otherwise rebuild the Timeline for every digit.
function commit(event: Event & { currentTarget: HTMLInputElement }) {
	const field = event.currentTarget;
	const typed = field.valueAsNumber;
	const next = Number.isNaN(typed) ? value : clampRange(range, typed);
	// The field may hold text the setting did not take (out of range, or empty).
	field.value = String(next);
	if (next !== value) onchange(next);
}

const step = (direction: 1 | -1) =>
	onchange(clampRange(range, value + direction * range.step));
</script>

<div class="row" class:sub>
	<label class="label name" for={id}>{label}</label>
	<span class="steps">
		<button
			type="button"
			class="stepper"
			aria-label={m.reader_number_less({ label })}
			disabled={value <= range.min}
			onclick={() => step(-1)}>−</button
		>
		<input
			{id}
			class="number border-2 border-ink bg-paper text-ink"
			type="number"
			inputmode={range.decimals > 0 ? "decimal" : "numeric"}
			min={range.min}
			max={range.max}
			step={range.step}
			{value}
			aria-describedby={note ? `${id}-note` : undefined}
			onchange={commit}
		/>
		<button
			type="button"
			class="stepper"
			aria-label={m.reader_number_more({ label })}
			disabled={value >= range.max}
			onclick={() => step(1)}>+</button
		>
		{#if unit}<span class="unit caption text-ink-2" aria-hidden="true">{unit}</span>{/if}
	</span>
	{#if note}<p id="{id}-note" class="caption note text-ink-2">{note}</p>{/if}
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: var(--spacing-s-2);
		min-height: 52px;
		padding-block: var(--spacing-s-1);
		border-bottom: 2px solid var(--color-ink);
	}

	.sub .name {
		padding-inline-start: var(--spacing-s-2);
	}

	.steps {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-s-1);
	}

	/* A plain text field, so a number can be typed; the spin arrows are the steppers. */
	.number {
		box-sizing: border-box;
		width: 5.5ch;
		min-width: 0;
		height: 40px;
		padding: 0;
		border-radius: var(--radius-control);
		font: inherit;
		font-size: 1.125rem;
		font-weight: 800;
		font-feature-settings: "tnum";
		text-align: center;
		appearance: textfield;
		-moz-appearance: textfield;
	}

	.number::-webkit-inner-spin-button,
	.number::-webkit-outer-spin-button {
		appearance: none;
		margin: 0;
	}

	.unit {
		min-width: 3ch;
	}

	.note {
		grid-column: 1 / -1;
		margin: 0;
		max-width: 52ch;
	}

	.sub .note {
		padding-inline-start: var(--spacing-s-2);
	}
</style>
