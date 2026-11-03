<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import type { ReaderSource } from "#lib/reader/open.ts";

let {
	onadd,
	busy,
	error,
}: {
	onadd: (source: ReaderSource) => void;
	busy: boolean;
	error: string;
} = $props();

let text = $state("");
let dragging = $state(false);
let problem = $state("");

function onSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (text.trim() === "") {
		problem = m.reader_empty();
		return;
	}
	problem = "";
	onadd({ kind: "text", text });
}

function onDrop(event: DragEvent) {
	event.preventDefault();
	dragging = false;
	const file = event.dataTransfer?.files[0];
	if (file) {
		onadd({ kind: "file", file });
		return;
	}
	const dropped = event.dataTransfer?.getData("text/plain") ?? "";
	if (dropped.trim() !== "") onadd({ kind: "text", text: dropped });
}

function onDragLeave(event: DragEvent) {
	const panel = event.currentTarget as HTMLElement;
	if (!panel.contains(event.relatedTarget as Node | null)) dragging = false;
}

function onPick(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (file) onadd({ kind: "file", file });
}
</script>

<div
	role="presentation"
	data-testid="intake-panel"
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	<form onsubmit={onSubmit} class:dragging>
		<label for="library-text" class="label block">{m.reader_text_label()}</label>
		<textarea
			id="library-text"
			class="mt-s-1 block min-h-40 w-full border-2 border-ink bg-paper p-s-2 text-ink placeholder:text-ink-3"
			placeholder={m.reader_text_placeholder()}
			bind:value={text}
		></textarea>
		{#if problem || error}
			<p role="alert" class="label mt-s-2 text-red-ink">{problem || error}</p>
		{/if}
		<div class="mt-s-3 flex flex-wrap items-center gap-s-2">
			<button type="submit" class="button-primary" disabled={busy}>{m.library_add_read()}</button>
			<label class="segment file inline-flex items-center border-2 border-ink">
				{m.reader_file()}
				<input type="file" class="sr-only" accept=".txt,text/plain" onchange={onPick} />
			</label>
		</div>
		<p class="caption mt-s-2 text-ink-2">
			{dragging ? m.reader_drop_active() : busy ? m.library_adding() : m.reader_drop_hint()}
		</p>
	</form>
</div>

<style>
	.dragging textarea {
		background: var(--color-paper-2);
	}

	.file:focus-within {
		outline: 3px solid var(--color-red);
		outline-offset: 3px;
	}
</style>
