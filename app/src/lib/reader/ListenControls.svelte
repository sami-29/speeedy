<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { RATE_MAX, RATE_MIN } from "./listen/prefs.ts";
import type { VoiceLike } from "./listen/voices.ts";

let {
	voices,
	selected,
	rate,
	onvoice,
	onrate,
	languageNote = null,
	sentenceNote = false,
	problem = null,
}: {
	/** The voices to choose from. */
	voices: readonly VoiceLike[];
	/** The voice in use, or undefined while the browser chooses. */
	selected: VoiceLike | undefined;
	rate: number;
	onvoice: (uri: string | undefined) => void;
	onrate: (direction: 1 | -1) => void;
	/** Why this voice reads this text, for a document that is not in English. */
	languageNote?: string | null;
	/** The voice sends no word boundaries, so a sentence is marked. */
	sentenceNote?: boolean;
	/** What stopped the voice, if something did. */
	problem?: string | null;
} = $props();
</script>

<div role="group" aria-label={m.listen_settings_label()} class="settings" data-testid="listen-settings">
	<div class="row">
		<label class="label" for="listen-voice">{m.listen_voice()}</label>
		<select
			id="listen-voice"
			class="select border-2 border-ink bg-paper text-ink"
			value={selected?.voiceURI ?? ""}
			onchange={(event) => onvoice(event.currentTarget.value || undefined)}
		>
			<option value="">{m.listen_voice_default()}</option>
			{#each voices as voice (voice.voiceURI)}
				<option value={voice.voiceURI}>{voice.name}</option>
			{/each}
		</select>
	</div>
	<div class="row">
		<span id="listen-rate-label" class="label">{m.listen_rate()}</span>
		<span class="steps">
			<button
				type="button"
				class="stepper"
				aria-label={m.listen_rate_slower()}
				disabled={rate <= RATE_MIN}
				onclick={() => onrate(-1)}>−</button
			>
			<output class="value" data-testid="voice-rate" aria-labelledby="listen-rate-label"
				>{m.listen_rate_value({ rate: rate.toFixed(1) })}</output
			>
			<button
				type="button"
				class="stepper"
				aria-label={m.listen_rate_faster()}
				disabled={rate >= RATE_MAX}
				onclick={() => onrate(1)}>+</button
			>
		</span>
	</div>
	<div class="notes" role="status">
		{#if languageNote}
			<p class="caption note text-ink-2" data-testid="listen-note">{languageNote}</p>
		{/if}
		{#if sentenceNote}
			<p class="caption note text-ink-2">{m.listen_note_sentence()}</p>
		{/if}
		{#if problem}
			<p class="label note text-red-ink" data-testid="listen-problem">{problem}</p>
		{/if}
	</div>
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
		min-width: 3.5ch;
		text-align: center;
		font-size: 1.25rem;
		font-weight: 800;
		font-feature-settings: "tnum";
	}

	.notes {
		display: grid;
	}

	.note {
		margin: 0;
		padding-block: var(--spacing-s-1);
		max-width: 52ch;
	}
</style>
