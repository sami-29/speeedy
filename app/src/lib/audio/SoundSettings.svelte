<script lang="ts">
import { onMount } from "svelte";
import { m } from "#lib/paraglide/messages.js";
import { audio } from "./instance.ts";
import { AMBIENT_KINDS, type AmbientKind, type BusName } from "./prefs.ts";

let {
	silent,
}: {
	/** The open Reading Mode makes no sound of its own: it can tick, and has no voice to turn up. */
	silent: boolean;
} = $props();

const system = audio();
let prefs = $state(system.prefs);
onMount(() => {
	prefs = system.prefs;
	return system.subscribe(() => {
		prefs = system.prefs;
	});
});

const VOLUME_STEP = 0.1;

const kindName = (kind: AmbientKind) =>
	({
		none: m.sound_ambient_none(),
		white: m.sound_ambient_white(),
		pink: m.sound_ambient_pink(),
		brown: m.sound_ambient_brown(),
	})[kind];

function nudge(bus: BusName, direction: 1 | -1) {
	system.setVolume(bus, prefs.volumes[bus] + direction * VOLUME_STEP);
}

const percent = (bus: BusName) =>
	m.sound_volume_value({ percent: Math.round(prefs.volumes[bus] * 100) });
</script>

{#snippet volume(bus: BusName, id: string, label: string, quieter: string, louder: string)}
	<div class="row">
		<span id="{id}-label" class="label">{label}</span>
		<span class="steps">
			<button
				type="button"
				class="stepper"
				aria-label={quieter}
				disabled={prefs.volumes[bus] <= 0}
				onclick={() => nudge(bus, -1)}>−</button
			>
			<output class="value" data-testid={id} aria-labelledby="{id}-label">{percent(bus)}</output>
			<button
				type="button"
				class="stepper"
				aria-label={louder}
				disabled={prefs.volumes[bus] >= 1}
				onclick={() => nudge(bus, 1)}>+</button
			>
		</span>
	</div>
{/snippet}

<div role="group" aria-label={m.sound_label()} class="settings" data-testid="sound-settings">
	<div class="row">
		<label class="label" for="sound-ambient">{m.sound_ambient()}</label>
		<select
			id="sound-ambient"
			class="select border-2 border-ink bg-paper text-ink"
			value={prefs.ambient}
			onchange={(event) => system.setAmbient(event.currentTarget.value as AmbientKind)}
		>
			{#each AMBIENT_KINDS as kind (kind)}
				<option value={kind}>{kindName(kind)}</option>
			{/each}
		</select>
	</div>
	{#if prefs.ambient !== "none"}
		{@render volume(
			"ambient",
			"ambient-volume",
			m.sound_ambient_volume(),
			m.sound_ambient_quieter(),
			m.sound_ambient_louder(),
		)}
	{/if}
	{#if silent}
		<div class="row">
			<label class="check label" for="sound-tick">{m.sound_tick()}</label>
			<input
				id="sound-tick"
				type="checkbox"
				checked={prefs.tick}
				aria-describedby="sound-tick-note"
				onchange={(event) => system.setTick(event.currentTarget.checked)}
			/>
			<p id="sound-tick-note" class="caption note text-ink-2">{m.sound_tick_note()}</p>
		</div>
		{#if prefs.tick}
			{@render volume(
				"cue",
				"tick-volume",
				m.sound_tick_volume(),
				m.sound_tick_quieter(),
				m.sound_tick_louder(),
			)}
		{/if}
	{:else}
		{@render volume(
			"voice",
			"voice-volume",
			m.sound_voice_volume(),
			m.sound_voice_quieter(),
			m.sound_voice_louder(),
		)}
	{/if}
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

	.select {
		min-height: 44px;
		max-width: 100%;
		padding: var(--spacing-s-1);
		font-weight: 650;
	}

	.steps {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-s-1);
	}

	.value {
		min-width: 4.5ch;
		text-align: center;
		font-size: 1.25rem;
		font-weight: 800;
		font-feature-settings: "tnum";
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
