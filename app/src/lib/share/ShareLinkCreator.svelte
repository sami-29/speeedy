<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { type CreateResult, createSharePayload } from "./codec.ts";

let text = $state("");
let measured = $state.raw<CreateResult>();
let link = $state("");
let error = $state("");
let copied = $state(false);

const percent = (used: number) => Math.max(1, Math.ceil(used * 100));

// Measures the link as the writer types, so the size cap is visible before Create.
$effect(() => {
	const current = text;
	let stale = false;
	link = "";
	error = "";
	copied = false;
	if (current.trim() === "") {
		measured = undefined;
		return;
	}
	void createSharePayload(current).then((result) => {
		if (!stale) measured = result;
	});
	return () => {
		stale = true;
	};
});

async function onSubmit(event: SubmitEvent) {
	event.preventDefault();
	const result = await createSharePayload(text);
	if (!result.ok) {
		link = "";
		error =
			result.reason === "empty"
				? m.share_empty()
				: m.share_too_long({ percent: String(percent(result.used)) });
		return;
	}
	error = "";
	link = `${window.location.origin}/s#${result.payload}`;
}

async function onCopy() {
	try {
		await navigator.clipboard.writeText(link);
		copied = true;
	} catch {
		copied = false;
	}
}
</script>

<form onsubmit={onSubmit}>
	<label for="share-text" class="label block">{m.share_text_label()}</label>
	<textarea
		id="share-text"
		class="mt-s-1 block min-h-56 w-full border-2 border-ink bg-paper p-s-2 text-ink placeholder:text-ink-3"
		placeholder={m.share_text_placeholder()}
		bind:value={text}
	></textarea>
	<p class="caption mt-s-1 text-ink-2" aria-live="polite">
		{measured && measured.ok ? m.share_used({ percent: String(percent(measured.used)) }) : m.share_cap()}
	</p>
	{#if error}
		<p role="alert" class="label mt-s-2 text-red-ink">{error}</p>
	{/if}
	<div class="mt-s-3">
		<button type="submit" class="button-primary">{m.share_create()}</button>
	</div>
</form>

{#if link}
	<div class="mt-s-4">
		<label for="share-link" class="label block">{m.share_link_label()}</label>
		<div class="mt-s-1 flex flex-wrap gap-s-2">
			<input
				id="share-link"
				class="min-h-11 min-w-0 flex-1 basis-64 border-2 border-ink bg-paper px-s-2 text-ink"
				readonly
				value={link}
				onfocus={(event) => event.currentTarget.select()}
			/>
			<button type="button" class="segment border-2 border-ink" onclick={onCopy}>{m.share_copy()}</button>
		</div>
		<p class="caption mt-s-1 text-ink-2" aria-live="polite">{copied ? m.share_copied() : ""}</p>
	</div>
{/if}
