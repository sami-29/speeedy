<script lang="ts">
import SoundSettings from "#lib/audio/SoundSettings.svelte";
import { m } from "#lib/paraglide/messages.js";
import { deviceStorage } from "../device-storage.ts";
import { modeName } from "./copy.ts";
import type { ModeId } from "./modes.ts";
import {
	deletePreset,
	loadPresets,
	type Preset,
	type PresetResult,
	type PresetSnapshot,
	renamePreset,
	savePreset,
	savePresets,
} from "./presets.ts";
import ReadingSettings from "./ReadingSettings.svelte";
import SpeedZones from "./SpeedZones.svelte";
import {
	PAUSE_VIEWS,
	type PauseView,
	type ReaderSettings,
} from "./settings.ts";

let {
	open = $bindable(),
	settings,
	onchange,
	used,
	modes,
	modeId,
	onmode,
	onwpm,
	silent,
	focusOnPlay,
	onfocusonplay,
	snapshot,
	onapply,
}: {
	open: boolean;
	settings: ReaderSettings;
	onchange: (change: Partial<ReaderSettings>) => void;
	/** The settings the open mode reads. Rows for the others are left out. */
	used: readonly string[];
	modes: readonly { id: ModeId }[];
	modeId: ModeId;
	onmode: (id: ModeId) => void;
	onwpm: (wpm: number) => void;
	/** The open mode makes no sound of its own (it runs on the timer Clock). */
	silent: boolean;
	focusOnPlay: boolean;
	onfocusonplay: (on: boolean) => void;
	/** Everything a preset keeps, as it is now. */
	snapshot: () => PresetSnapshot;
	onapply: (preset: Preset) => void;
} = $props();

let close: HTMLButtonElement | undefined = $state();

// Opening moves keyboard focus into the panel, so Tab walks its settings first.
$effect(() => {
	if (open) close?.focus();
});

const pausedName = (view: PauseView) =>
	({
		focus: m.reader_paused_focus(),
		context: m.reader_paused_context(),
		fulltext: m.reader_paused_fulltext(),
	})[view];

const usesWpm = $derived(used.includes("wpm"));
const words = $derived(used.filter((id) => id === "chunkSize"));
const PACING_IDS: readonly string[] = [
	"smartSpeed",
	"punctuationPauses",
	"sentencePause",
	"paragraphPause",
	"commaPause",
	"asidePause",
	"speedRamp",
	"rampTarget",
	"rampLength",
	"rewindStep",
	"countdown",
];
const pacing = $derived(used.filter((id) => PACING_IDS.includes(id)));

// Presets are kept on this device; every change is saved at once.
let presets = $state.raw<Preset[]>(loadPresets(deviceStorage()));
let name = $state("");
let problem = $state("");
let status = $state("");
let renaming = $state<string | null>(null);
let newName = $state("");

const problemFor = (reason: "blank" | "taken" | "missing") =>
	reason === "taken" ? m.preset_taken() : m.preset_blank();

function keep(result: PresetResult): boolean {
	if (!result.ok) {
		problem = problemFor(result.reason);
		return false;
	}
	problem = "";
	presets = result.presets;
	savePresets(deviceStorage(), presets);
	return true;
}

function save(event: SubmitEvent) {
	event.preventDefault();
	const result = savePreset(presets, name, snapshot());
	if (keep(result)) {
		status = m.preset_saved({ name: name.trim() });
		name = "";
	}
}

function apply(preset: Preset) {
	onapply(preset);
	status = m.preset_applied({ name: preset.name });
}

function startRename(preset: Preset) {
	renaming = preset.name;
	newName = preset.name;
	problem = "";
}

function rename(event: SubmitEvent, from: string) {
	event.preventDefault();
	if (keep(renamePreset(presets, from, newName))) renaming = null;
}

function remove(preset: Preset) {
	presets = deletePreset(presets, preset.name);
	savePresets(deviceStorage(), presets);
	status = m.preset_deleted({ name: preset.name });
	if (renaming === preset.name) renaming = null;
}
</script>

<aside
	class="panel border-ink bg-paper text-ink"
	aria-labelledby="settings-title"
	data-testid="settings-panel"
	data-chrome
	hidden={!open}
>
	<div class="head">
		<h2 id="settings-title" class="title">{m.reader_settings_title()}</h2>
		<button
			type="button"
			class="segment border-2 border-ink"
			bind:this={close}
			onclick={() => (open = false)}>{m.reader_settings_close()}</button
		>
	</div>
	<p class="caption text-ink-2">{m.reader_settings_note()}</p>

	<section aria-labelledby="group-modes">
		<h3 id="group-modes" class="group label">{m.reader_group_modes()}</h3>
		<div role="group" aria-labelledby="group-modes" class="segment-group">
			{#each modes as entry (entry.id)}
				<button
					type="button"
					class="segment"
					aria-pressed={entry.id === modeId}
					onclick={() => onmode(entry.id)}>{modeName(entry.id)}</button
				>
			{/each}
		</div>
	</section>

	{#if usesWpm || pacing.length > 0}
		<section aria-labelledby="group-pacing">
			<h3 id="group-pacing" class="group label">{m.reader_group_pacing()}</h3>
			{#if usesWpm}
				<SpeedZones wpm={settings.wpm} onpick={onwpm} />
			{/if}
			<ReadingSettings
				{settings}
				{onchange}
				used={pacing}
				label={m.reader_group_pacing()}
			/>
		</section>
	{/if}

	{#if words.length > 0}
		<section aria-labelledby="group-words">
			<h3 id="group-words" class="group label">{m.reader_group_words()}</h3>
			<ReadingSettings {settings} {onchange} used={words} label={m.reader_group_words()} />
		</section>
	{/if}

	{#if used.includes("pauseView")}
		<section aria-labelledby="group-paused">
			<h3 id="group-paused" class="group label">{m.reader_group_paused()}</h3>
			<fieldset class="choices" aria-describedby="paused-note">
				<legend class="sr-only">{m.reader_group_paused()}</legend>
				{#each PAUSE_VIEWS as view (view)}
					<label class="check label">
						<input
							type="radio"
							name="pause-view"
							value={view}
							checked={settings.pauseView === view}
							onchange={() => onchange({ pauseView: view })}
						/>
						{pausedName(view)}
					</label>
				{/each}
			</fieldset>
			<p id="paused-note" class="caption text-ink-2">{m.reader_paused_note()}</p>
		</section>
	{/if}

	<section aria-labelledby="group-features">
		<h3 id="group-features" class="group label">{m.reader_group_features()}</h3>
		<div class="rows">
			<label class="check label">
				<input
					type="checkbox"
					checked={settings.showProgress}
					onchange={(event) => onchange({ showProgress: event.currentTarget.checked })}
				/>
				{m.reader_show_progress()}
			</label>
			<label class="check label">
				<input
					type="checkbox"
					checked={focusOnPlay}
					onchange={(event) => onfocusonplay(event.currentTarget.checked)}
				/>
				{m.reader_focus_on_play()}
			</label>
			<label class="check label">
				<input
					type="checkbox"
					checked={settings.removeCitations}
					aria-describedby="citations-note"
					onchange={(event) => onchange({ removeCitations: event.currentTarget.checked })}
				/>
				{m.reader_remove_citations()}
			</label>
			<p id="citations-note" class="caption text-ink-2">{m.reader_remove_citations_note()}</p>
		</div>
	</section>

	<section aria-labelledby="group-audio">
		<h3 id="group-audio" class="group label">{m.reader_group_audio()}</h3>
		<SoundSettings {silent} />
		{#if !silent}
			<p class="caption text-ink-2">{m.reader_voices_note()}</p>
		{/if}
	</section>

	<section aria-labelledby="group-presets">
		<h3 id="group-presets" class="group label">{m.reader_group_presets()}</h3>
		<form class="save" onsubmit={save}>
			<label class="label" for="preset-name">{m.preset_name_label()}</label>
			<input
				id="preset-name"
				class="field border-2 border-ink bg-paper text-ink"
				maxlength="40"
				autocomplete="off"
				bind:value={name}
			/>
			<button type="submit" class="segment border-2 border-ink">{m.preset_save()}</button>
		</form>
		{#if problem}
			<p role="alert" class="label text-red-ink">{problem}</p>
		{/if}
		<p role="status" class="sr-only">{status}</p>
		{#if presets.length === 0}
			<p class="caption text-ink-2">{m.preset_empty()}</p>
		{:else}
			<ul class="presets" data-testid="presets">
				{#each presets as preset (preset.name)}
					<li class="preset">
						{#if renaming === preset.name}
							<form class="save" onsubmit={(event) => rename(event, preset.name)}>
								<label class="sr-only" for="preset-rename">{m.preset_rename_label({ name: preset.name })}</label>
								<input
									id="preset-rename"
									class="field border-2 border-ink bg-paper text-ink"
									maxlength="40"
									autocomplete="off"
									bind:value={newName}
								/>
								<button type="submit" class="segment border-2 border-ink">{m.preset_rename_save()}</button>
								<button type="button" class="segment border-2 border-ink" onclick={() => (renaming = null)}
									>{m.preset_cancel()}</button
								>
							</form>
						{:else}
							<span class="name label">{preset.name}</span>
							<span class="actions">
								<button
									type="button"
									class="segment border-2 border-ink"
									aria-label={m.preset_apply_label({ name: preset.name })}
									onclick={() => apply(preset)}>{m.preset_apply()}</button
								>
								<button
									type="button"
									class="segment border-2 border-ink"
									aria-label={m.preset_rename_label({ name: preset.name })}
									onclick={() => startRename(preset)}>{m.preset_rename()}</button
								>
								<button
									type="button"
									class="segment border-2 border-ink"
									aria-label={m.preset_delete_label({ name: preset.name })}
									onclick={() => remove(preset)}>{m.preset_delete()}</button
								>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</aside>

<style>
	/* A sheet over the foot of the screen on a phone; a sidebar down the right from 861px,
	   with the page moved over to make room. Either way it is fixed, so opening it never
	   makes the page scroll, and the reading surface stays in view to show each change. */
	:global(:root) {
		--settings-width: min(26rem, 40vw);
	}

	.panel {
		position: fixed;
		inset-inline: 0;
		bottom: 0;
		z-index: 20;
		display: grid;
		align-content: start;
		gap: var(--spacing-s-3);
		max-height: 50dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--spacing-s-3) var(--spacing-gutter) var(--spacing-s-4);
		border-top: var(--rule-heavy) solid;
	}

	@media (min-width: 861px) {
		.panel {
			inset-block: 0;
			left: auto;
			width: var(--settings-width);
			max-height: none;
			border-top: 0;
			border-left: var(--rule-heavy) solid;
		}

		:global(body:has([data-testid="settings-panel"]:not([hidden]))) {
			padding-inline-end: var(--settings-width);
		}
	}

	.panel[hidden] {
		display: none;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-s-2);
	}

	.title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 830;
		line-height: 1;
		letter-spacing: -0.02em;
		font-variation-settings: "wdth" 82;
	}

	section {
		display: grid;
		gap: var(--spacing-s-1);
		min-width: 0;
	}

	.group {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.caption {
		margin: 0;
	}

	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-s-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	.rows {
		display: grid;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--spacing-s-1);
		min-height: 44px;
		cursor: pointer;
	}

	.check input {
		width: 24px;
		height: 24px;
		margin: 0;
		accent-color: var(--color-ink);
	}

	.save {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-s-1);
	}

	.save > label {
		width: 100%;
	}

	.field {
		flex: 1 1 10rem;
		min-width: 0;
		min-height: 44px;
		padding-inline: var(--spacing-s-1);
		font: inherit;
	}

	.presets {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 2px solid var(--color-ink);
	}

	.preset {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-s-1);
		padding-block: var(--spacing-s-1);
		border-bottom: 2px solid var(--color-ink);
	}

	.name {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-s-1);
	}
</style>
