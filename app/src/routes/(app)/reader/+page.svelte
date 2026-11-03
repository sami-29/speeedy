<script lang="ts">
import type { Document, Position } from "@speeedy/contracts";
import type { Timeline } from "@speeedy/engine";
import { onDestroy, onMount } from "svelte";
import { library } from "#lib/library/instance.ts";
import {
	createPositionSaver,
	type PositionSaver,
} from "#lib/library/position-saver.ts";
import { progressTracker } from "#lib/library/progress.ts";
import { type DocumentSource, effectiveLanguage } from "#lib/library/store.ts";
import { documentTitle } from "#lib/library/title.ts";
import { m } from "#lib/paraglide/messages.js";
import { takeHandoff } from "#lib/reader/handoff.ts";
import { readerModes } from "#lib/reader/modes.ts";
import { createReaderLoader, type ReaderSource } from "#lib/reader/open.ts";
import { READER_SETTINGS } from "#lib/reader/settings.ts";

const loader = createReaderLoader();
let saver: PositionSaver | undefined;
onDestroy(() => {
	saver?.dispose();
	loader.dispose();
});

const mode = readerModes.get("rsvp");

let text = $state("");
let error = $state("");
let opening = $state(false);
let dragging = $state(false);
let session = $state.raw<{
	timeline: Timeline;
	title: string | null;
	source: DocumentSource;
	startAt: Position | undefined;
	onposition: ((position: Position, final: boolean) => void) | undefined;
}>();

/** Reading starts from the Position the Library holds, unless that was the end. */
const resumeAt = (position: Position, progress: number) =>
	progress <= 0 || progress >= 1 ? undefined : position;

/** Show a Timeline. A document in the Library also gets its Position saved as it is read. */
function show(
	timeline: Timeline,
	title: string | null,
	source: DocumentSource,
	kept?: { id: string; document: Document },
	startAt?: Position,
) {
	saver?.dispose();
	saver = undefined;
	if (kept) {
		const store = library();
		const id = kept.id;
		saver = createPositionSaver({
			save: (position, progress) => store.savePosition(id, position, progress),
			progress: progressTracker(kept.document),
		});
	}
	session = { timeline, title, source, startAt, onposition: saver?.record };
}

async function open(source: ReaderSource, from: DocumentSource = "own") {
	error = "";
	opening = true;
	const result = await loader.open(source);
	if (!result.ok) {
		opening = false;
		error = result.message;
		return;
	}
	try {
		const store = library();
		const { meta, duplicate } = await store.addDocument({
			document: result.document,
			title: documentTitle(result.title, result.document),
			language: result.language,
			source: from,
		});
		await store.setCurrent(meta.id);
		const kept = { id: meta.id, document: result.document };
		const startAt = duplicate
			? resumeAt(meta.position, meta.progress)
			: undefined;
		// A text that is already in the Library carries on from its Position.
		const timeline = startAt
			? await loader.build(result.document, {
					language: effectiveLanguage(meta),
					anchor: startAt,
				})
			: result.timeline;
		show(timeline ?? result.timeline, meta.title, meta.source, kept, startAt);
	} catch {
		// The Library is out of reach (private window, storage blocked): read without keeping.
		show(result.timeline, result.title, from);
	}
	opening = false;
}

/** Open the document the Library holds as current, at its Position. */
async function restore() {
	try {
		const store = library();
		const id = await store.currentId();
		if (!id || session) return;
		const loaded = await store.load(id);
		if (!loaded || session) return;
		const { meta, document } = loaded;
		const startAt = resumeAt(meta.position, meta.progress);
		const timeline = await loader.build(document, {
			language: effectiveLanguage(meta),
			anchor: startAt,
		});
		if (!timeline || session) return;
		show(timeline, meta.title, meta.source, { id, document }, startAt);
	} catch {
		// Nothing to resume: the start panel stays.
	}
}

onMount(() => {
	void restore();
});

/** Back to the start panel. The next refresh shows the panel too. */
function leave() {
	saver?.dispose();
	saver = undefined;
	session = undefined;
	void library()
		.setCurrent(null)
		.catch(() => undefined);
}

// Text handed over by another route, such as a Share Link opened at /s.
const handed = takeHandoff();
if (handed) void open({ kind: "text", text: handed.text }, handed.source);

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
	<h1 class="sr-only" data-testid="reader-source" data-source={session.source}>
		{session.title ?? m.reader_reading()}
	</h1>
	<div class="px-gutter pt-s-2">
		<button type="button" class="segment border-2 border-ink" onclick={leave}>
			{m.reader_new_text()}
		</button>
		{#if session.source === "share"}
			<!-- Anyone can craft a Share Link, so its text is marked as not ours and waits for Play. -->
			<p class="caption mt-s-2 text-ink-2" data-testid="shared-notice">{m.reader_shared_notice()}</p>
		{/if}
	</div>
	{#await mode.view() then view}
		<view.default
			timeline={session.timeline}
			wpm={READER_SETTINGS.wpm}
			autoplay={session.source !== "share"}
			startAt={session.startAt}
			onposition={session.onposition}
		/>
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
				{dragging
					? m.reader_drop_active()
					: opening
						? m.reader_opening()
						: m.reader_drop_hint()}
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
