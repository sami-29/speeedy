<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import type { OnDeviceState } from "#lib/voice/on-device.ts";
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
	device = undefined,
	ondownload = () => {},
	deviceNote = null,
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
	/** The on-device voice, where this text and this browser can use it. */
	device?: OnDeviceState | undefined;
	/** The reader agreed to download the on-device voice. */
	ondownload?: () => void;
	/** Why the on-device voice gave way to the browser's, if it did. */
	deviceNote?: string | null;
} = $props();

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
/** Offered for download until it is downloaded; while the cache is read, nothing shows. */
const offerDownload = $derived(
	device?.phase === "absent" || device?.phase === "downloading",
);
const downloading = $derived(device?.phase === "downloading");
const share = $derived(
	device && device.totalBytes > 0
		? Math.min(device.loaded / device.totalBytes, 1)
		: 0,
);
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
	{#if device && offerDownload}
		<div class="row device" data-testid="listen-device">
			<span id="listen-device-label" class="label">{m.listen_on_device()}</span>
			{#if downloading}
				<div
					class="track"
					role="progressbar"
					aria-labelledby="listen-device-label"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(share * 100)}
					aria-valuetext={m.listen_on_device_progress({
						loaded: megabytes(device.loaded),
						size: device.totalLabel,
					})}
				>
					<div class="fill" style:transform="scaleX({share})"></div>
				</div>
			{:else}
				<button type="button" class="ghost" onclick={() => ondownload()}>
					{m.listen_on_device_download({ size: device.totalLabel })}
				</button>
			{/if}
			<p class="caption about text-ink-2">
				{#if downloading}
					{m.listen_on_device_progress({
						loaded: megabytes(device.loaded),
						size: device.totalLabel,
					})}
				{:else}
					{m.listen_on_device_about({ size: device.totalLabel })}
				{/if}
			</p>
		</div>
	{/if}
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
		{#if device?.error === "download"}
			<p class="label note text-red-ink" data-testid="listen-device-problem">
				{m.listen_on_device_download_failed()}
			</p>
		{/if}
		{#if deviceNote}
			<p class="caption note text-ink-2" data-testid="listen-device-note">{deviceNote}</p>
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

	.device {
		row-gap: var(--spacing-s-1);
	}

	.about {
		grid-column: 1 / -1;
		margin: 0;
		max-width: 52ch;
	}

	/* Compact ghost button: a 2px inset ink stroke that fills ink on hover. */
	.ghost {
		min-height: 44px;
		padding-inline: var(--spacing-s-2);
		box-shadow: inset 0 0 0 2px var(--color-ink);
		color: var(--color-ink);
		font-size: 1rem;
		font-weight: 750;
		cursor: pointer;
		transition:
			background-color 160ms var(--ease-out),
			color 160ms var(--ease-out);
	}

	.ghost:hover {
		background: var(--color-ink);
		color: var(--color-paper);
	}

	/* The download's progress: an empty light-rule track with a red fill, square like every track. */
	.track {
		width: min(12rem, 40vw);
		height: 8px;
		background: var(--color-rule);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--color-red);
		transform-origin: left;
		transition: transform 200ms var(--ease-out);
	}

	@media (prefers-reduced-motion: reduce) {
		.ghost,
		.fill {
			transition: none;
		}
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
