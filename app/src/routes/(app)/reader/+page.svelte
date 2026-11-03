<script lang="ts">
import type { Timeline } from "@speeedy/engine";
import { onDestroy, onMount } from "svelte";
import { m } from "#lib/paraglide/messages.js";
import { takeHandOff } from "#lib/reader/handoff.ts";
import { readerModes } from "#lib/reader/modes.ts";
import { createReaderLoader, type ReaderSource } from "#lib/reader/open.ts";
import { READER_SETTINGS } from "#lib/reader/settings.ts";

const loader = createReaderLoader();
onDestroy(() => loader.dispose());

const mode = readerModes.get("rsvp");

let text = $state("");
let error = $state("");
let opening = $state(false);
let dragging = $state(false);
let session = $state.raw<{ timeline: Timeline; title: string | null }>();

async function open(source: ReaderSource) {
	error = "";
	opening = true;
	const result = await loader.open(source);
	opening = false;
	if (result.ok) session = { timeline: result.timeline, title: result.title };
	else error = result.message;
}

// A public page (the front door) can hand over pasted text or a file; open it at once.
onMount(() => {
	const handedOver = takeHandOff();
	if (handedOver) void open(handedOver);
});

function onSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (text.trim() === "") {
		error = m.reader_empty();
		return;
	}
	void open({ kind: "text", text });
}

function onDrop(event: DragEvent) {
	event.preventDefault();
	dragging = false;
	const file = event.dataTransfer?.files[0];
	if (file) {
		void open({ kind: "file", file });
		return;
	}
	const dropped = event.dataTransfer?.getData("text/plain") ?? "";
	if (dropped.trim() !== "") void open({ kind: "text", text: dropped });
}

function onDragLeave(event: DragEvent) {
	const panel = event.currentTarget as HTMLElement;
	if (!panel.contains(event.relatedTarget as Node | null)) dragging = false;
}

function onPick(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (file) void open({ kind: "file", file });
}
</script>

<svelte:head>
	<title>{m.nav_reader()} - {m.site_name()}</title>
</svelte:head>

{#if session && mode}
	<h1 class="sr-only">{session.title ?? m.reader_reading()}</h1>
	<div class="px-gutter pt-s-2">
		<button type="button" class="segment border-2 border-ink" onclick={() => (session = undefined)}>
			{m.reader_new_text()}
		</button>
	</div>
	{#await mode.view() then view}
		<view.default timeline={session.timeline} wpm={READER_SETTINGS.wpm} />
	{/await}
{:else}
	<section
		class="poster pt-s-6"
		data-testid="start-panel"
		aria-labelledby="reader-title"
		ondragover={(event) => {
			event.preventDefault();
			dragging = true;
		}}
		ondragleave={onDragLeave}
		ondrop={onDrop}
	>
		<h1 id="reader-title" class="headline poster-head">{m.app_reader_title()}</h1>
		<form onsubmit={onSubmit} class:dragging>
			<label for="reader-text" class="label block">{m.reader_text_label()}</label>
			<textarea
				id="reader-text"
				class="mt-s-1 block min-h-56 w-full border-2 border-ink bg-paper p-s-2 text-ink placeholder:text-ink-3"
				placeholder={m.reader_text_placeholder()}
				bind:value={text}
			></textarea>
			{#if error}
				<p role="alert" class="label mt-s-2 text-red-ink">{error}</p>
			{/if}
			<div class="mt-s-3 flex flex-wrap items-center gap-s-2">
				<button type="submit" class="button-primary" disabled={opening}>{m.reader_start()}</button>
				<label class="segment file inline-flex items-center border-2 border-ink">
					{m.reader_file()}
					<input type="file" class="sr-only" accept=".txt,text/plain" onchange={onPick} />
				</label>
			</div>
			<p class="caption mt-s-2 text-ink-2">
				{dragging ? m.reader_drop_active() : opening ? m.reader_opening() : m.reader_drop_hint()}
			</p>
		</form>
	</section>
{/if}

<style>
	.dragging textarea {
		background: var(--color-paper-2);
	}

	.file:focus-within {
		outline: 3px solid var(--color-red);
		outline-offset: 3px;
	}
</style>
