<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import type { ReaderSource } from "#lib/reader/open.ts";

// The paste and drop box for public pages. It only collects a source; the page decides what
// happens next (the front door hands it to /reader). Any file is accepted here, and the
// reader says so if it cannot open one.
let { onstart }: { onstart: (source: ReaderSource) => void } = $props();

let text = $state("");
let error = $state("");
let dragging = $state(false);

function onSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (text.trim() === "") {
		error = m.reader_empty();
		return;
	}
	error = "";
	onstart({ kind: "text", text });
}

function onDrop(event: DragEvent) {
	event.preventDefault();
	dragging = false;
	const file = event.dataTransfer?.files[0];
	if (file) {
		onstart({ kind: "file", file });
		return;
	}
	const dropped = event.dataTransfer?.getData("text/plain") ?? "";
	if (dropped.trim() !== "") onstart({ kind: "text", text: dropped });
}

function onDragLeave(event: DragEvent) {
	const box = event.currentTarget as HTMLElement;
	if (!box.contains(event.relatedTarget as Node | null)) dragging = false;
}

function onPick(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (file) onstart({ kind: "file", file });
}
</script>

<section
	data-testid="paste-box"
	aria-label={m.home_paste_label()}
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	<form onsubmit={onSubmit} class:dragging>
		<label for="paste-text" class="label block">{m.reader_text_label()}</label>
		<textarea
			id="paste-text"
			class="mt-s-1 block min-h-40 w-full border-2 border-ink bg-paper p-s-2 text-ink placeholder:text-ink-3"
			placeholder={m.reader_text_placeholder()}
			bind:value={text}
		></textarea>
		{#if error}
			<p role="alert" class="label mt-s-2 text-red-ink">{error}</p>
		{/if}
		<div class="mt-s-3 flex flex-wrap items-center gap-s-2">
			<button type="submit" class="button-primary">{m.reader_start()}</button>
			<label class="segment file inline-flex items-center border-2 border-ink">
				{m.reader_file()}
				<input type="file" class="sr-only" onchange={onPick} />
			</label>
		</div>
		<p class="caption mt-s-2 text-ink-2">
			{dragging ? m.reader_drop_active() : m.home_drop_hint()}
		</p>
	</form>
</section>

<style>
	.dragging textarea {
		background: var(--color-paper-2);
	}

	.file:focus-within {
		outline: 3px solid var(--color-red);
		outline-offset: 3px;
	}
</style>
