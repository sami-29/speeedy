<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { TRUSTED_ORIGINS } from "#lib/launcher/config.ts";
import { startLauncherReceiver } from "#lib/launcher/receiver.ts";
import { saveLauncherPage } from "#lib/launcher/save.ts";
import IntakePanel from "#lib/library/IntakePanel.svelte";
import { library } from "#lib/library/instance.ts";
import { LANGUAGES, languageName } from "#lib/library/languages.ts";
import { SAMPLES, type Sample } from "#lib/library/samples.ts";
import {
	type AddDocumentInput,
	type DocumentMeta,
	LibraryError,
	type RemovedDocument,
} from "#lib/library/store.ts";
import { documentTitle } from "#lib/library/title.ts";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import { createReaderLoader, type ReaderSource } from "#lib/reader/open.ts";
import { goto } from "$app/navigation";

/** How long a delete can be undone. */
const UNDO_MS = 5000;

const loader = createReaderLoader();

let docs = $state.raw<DocumentMeta[]>([]);
let loaded = $state(false);
let busy = $state(false);
let error = $state("");
let editing = $state<string | undefined>();
let draftTitle = $state("");
let draftLanguage = $state("");
let editError = $state("");
let pending = $state.raw<{ removed: RemovedDocument; title: string }>();
let undoTimer: ReturnType<typeof setTimeout> | undefined;

const lastRead = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

async function refresh() {
	try {
		docs = await library().list();
		error = "";
	} catch {
		error = m.library_error_storage();
	}
	loaded = true;
}

onMount(() => {
	void refresh();
	// The launcher extension opens this page and sends it the page to keep.
	const receiver = startLauncherReceiver({
		window,
		trusted: TRUSTED_ORIGINS,
		save: async (page) => {
			await saveLauncherPage(library(), page);
		},
		saved: () => {
			void goto(localizeHref("/reader"));
		},
	});
	return () => receiver.stop();
});

onDestroy(() => {
	clearTimeout(undoTimer);
	loader.dispose();
});

async function keepAndRead(input: AddDocumentInput) {
	try {
		const store = library();
		const { meta } = await store.addDocument(input);
		await store.setCurrent(meta.id);
		await goto(localizeHref("/reader"));
	} catch {
		error = m.library_error_storage();
	}
}

async function add(source: ReaderSource) {
	error = "";
	busy = true;
	const parsed = await loader.parse(source);
	if (parsed.ok) {
		await keepAndRead({
			document: parsed.document,
			title: documentTitle(parsed.title, parsed.document),
			language: parsed.language,
		});
	} else {
		error = parsed.message;
	}
	busy = false;
}

async function readSample(sample: Sample) {
	error = "";
	await keepAndRead({
		document: sample.document,
		title: sample.title,
		language: sample.language,
		source: "demo",
	});
}

async function read(doc: DocumentMeta) {
	try {
		await library().setCurrent(doc.id);
		await goto(localizeHref("/reader"));
	} catch {
		error = m.library_error_storage();
	}
}

function startEdit(doc: DocumentMeta) {
	editing = doc.id;
	draftTitle = doc.title;
	draftLanguage = doc.languageOverride ?? "";
	editError = "";
}

async function saveEdit(event: SubmitEvent, doc: DocumentMeta) {
	event.preventDefault();
	if (draftTitle.trim() === "") {
		editError = m.library_error_title();
		return;
	}
	try {
		const store = library();
		if (draftTitle.trim() !== doc.title) await store.rename(doc.id, draftTitle);
		if (draftLanguage !== (doc.languageOverride ?? "")) {
			await store.setLanguageOverride(doc.id, draftLanguage || null);
		}
		editing = undefined;
		await refresh();
	} catch (failure) {
		editError =
			failure instanceof LibraryError && failure.code === "invalid-title"
				? m.library_error_title()
				: m.library_error_storage();
	}
}

async function remove(doc: DocumentMeta) {
	try {
		const removed = await library().deleteDocument(doc.id);
		clearTimeout(undoTimer);
		pending = { removed, title: doc.title };
		undoTimer = setTimeout(() => {
			pending = undefined;
		}, UNDO_MS);
		if (editing === doc.id) editing = undefined;
		await refresh();
	} catch {
		error = m.library_error_storage();
	}
}

async function undo() {
	const last = pending;
	if (!last) return;
	clearTimeout(undoTimer);
	pending = undefined;
	try {
		await library().restoreDocument(last.removed);
		await refresh();
	} catch {
		error = m.library_error_storage();
	}
}

/** The reader's languages, plus the document's own override when it is not in the list. */
const languageChoices = (doc: DocumentMeta): string[] =>
	doc.languageOverride &&
	!(LANGUAGES as readonly string[]).includes(doc.languageOverride)
		? [doc.languageOverride, ...LANGUAGES]
		: [...LANGUAGES];
</script>

<svelte:head>
	<title>{m.nav_library()} - {m.site_name()}</title>
</svelte:head>

<div class="poster pt-s-6">
	<h1 class="headline poster-head">{m.app_library_title()}</h1>
	<IntakePanel onadd={add} {busy} {error} />

	<h2 class="title poster-head">{m.library_table_label()}</h2>
	<div>
		<div role="status">
			{#if pending}
				<p class="label mb-s-2 flex flex-wrap items-center gap-s-2">
					<span>{m.library_deleted({ title: pending.title })}</span>
					<button type="button" class="segment border-2 border-ink" onclick={undo}>
						{m.library_undo()}
					</button>
				</p>
			{/if}
		</div>

		{#if loaded && docs.length === 0}
			<div data-testid="library-empty">
				<p class="title">{m.library_empty_title()}</p>
				<p class="lead mt-s-1 max-w-[52ch]">{m.library_empty_lead()}</p>
				<h3 class="label mt-s-3">{m.library_samples_label()}</h3>
				<ul class="mt-s-1 grid gap-s-1">
					{#each SAMPLES as sample (sample.id)}
						<li>
							<button
								type="button"
								class="segment w-full border-2 border-ink text-left"
								aria-label={m.library_sample_read({ title: sample.title })}
								onclick={() => readSample(sample)}
							>
								{sample.title}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{:else if docs.length > 0}
			<table class="w-full border-collapse text-left">
				<caption class="sr-only">{m.library_table_label()}</caption>
				<thead>
					<tr class="border-b-4 border-ink">
						<th scope="col" class="label py-s-1 pr-s-2">{m.library_col_title()}</th>
						<th scope="col" class="label py-s-1 pr-s-2">{m.library_col_progress()}</th>
						<th scope="col" class="label hidden py-s-1 pr-s-2 min-[861px]:table-cell">
							{m.library_col_last_read()}
						</th>
						<th scope="col" class="py-s-1"><span class="sr-only">{m.library_col_actions()}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each docs as doc (doc.id)}
						<tr class="border-b-2 border-rule align-top hover:bg-paper-2">
							<td class="py-s-2 pr-s-2 [overflow-wrap:anywhere]">{doc.title}</td>
							<td class="py-s-2 pr-s-2 whitespace-nowrap">{Math.round(doc.progress * 100)}%</td>
							<td class="hidden py-s-2 pr-s-2 whitespace-nowrap min-[861px]:table-cell">
								{doc.lastReadAt === null ? m.library_never_read() : lastRead.format(doc.lastReadAt)}
							</td>
							<td class="py-s-1">
								<div class="flex flex-wrap justify-end gap-s-1">
									<button
										type="button"
										class="segment border-2 border-ink"
										aria-label={m.library_read_label({ title: doc.title })}
										onclick={() => read(doc)}>{m.library_read()}</button
									>
									<button
										type="button"
										class="segment border-2 border-ink"
										aria-label={m.library_edit_label({ title: doc.title })}
										aria-expanded={editing === doc.id}
										onclick={() => (editing === doc.id ? (editing = undefined) : startEdit(doc))}
										>{m.library_edit()}</button
									>
									<button
										type="button"
										class="segment border-2 border-ink"
										aria-label={m.library_delete_label({ title: doc.title })}
										onclick={() => remove(doc)}>{m.library_delete()}</button
									>
								</div>
							</td>
						</tr>
						{#if editing === doc.id}
							<tr class="border-b-2 border-rule">
								<td colspan="4" class="py-s-2">
									<form class="grid max-w-[40ch] gap-s-2" onsubmit={(event) => saveEdit(event, doc)}>
										<div>
											<label for="title-{doc.id}" class="label block">{m.library_field_title()}</label>
											<input
												id="title-{doc.id}"
												type="text"
												class="mt-s-1 block w-full border-2 border-ink bg-paper p-s-1 text-ink"
												bind:value={draftTitle}
											/>
										</div>
										<div>
											<label for="language-{doc.id}" class="label block">{m.library_field_language()}</label>
											<select
												id="language-{doc.id}"
												class="mt-s-1 block min-h-11 w-full border-2 border-ink bg-paper p-s-1 text-ink"
												bind:value={draftLanguage}
											>
												<option value="">
													{doc.language === "und"
														? m.library_language_unknown()
														: m.library_language_detected({ language: languageName(doc.language) })}
												</option>
												{#each languageChoices(doc) as code (code)}
													<option value={code}>{languageName(code)}</option>
												{/each}
											</select>
										</div>
										{#if editError}
											<p role="alert" class="label text-red-ink">{editError}</p>
										{/if}
										<div class="flex flex-wrap gap-s-1">
											<button type="submit" class="button-primary">{m.library_save()}</button>
											<button
												type="button"
												class="segment border-2 border-ink"
												onclick={() => (editing = undefined)}>{m.library_cancel()}</button
											>
										</div>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
