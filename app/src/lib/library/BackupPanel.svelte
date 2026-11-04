<script lang="ts">
import { createBackup } from "#lib/backup/create.ts";
import { saveFile } from "#lib/backup/download.ts";
import { type RestoreResult, restoreBackupFile } from "#lib/backup/restore.ts";
import { library } from "#lib/library/instance.ts";
import { m } from "#lib/paraglide/messages.js";

let { onrestored }: { onrestored: () => void } = $props();

let busy = $state(false);
let message = $state("");
let failed = $state(false);

function say(text: string, isError: boolean) {
	message = text;
	failed = isError;
}

function refusal(result: Extract<RestoreResult, { ok: false }>): string {
	switch (result.failure) {
		case "newer-version":
			return m.library_backup_newer();
		case "too-large":
			return m.library_backup_too_large();
		case "storage":
			return m.library_backup_storage();
		case "damaged":
			return m.library_backup_damaged();
		default:
			return m.library_backup_not_backup();
	}
}

async function download() {
	busy = true;
	try {
		const made = await createBackup(library());
		saveFile(made.blob, made.filename);
		const done = m.library_backup_downloaded({ documents: made.documents });
		say(
			made.skipped > 0
				? `${done} ${m.library_backup_skipped({ skipped: made.skipped })}`
				: done,
			false,
		);
	} catch {
		say(m.library_error_storage(), true);
	}
	busy = false;
}

async function restore(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;
	busy = true;
	say("", false);
	const result = await restoreBackupFile(library(), file);
	if (result.ok) {
		say(
			m.library_backup_restored({
				added: result.documentsAdded,
				matched: result.documentsMatched,
				sessions: result.sessionsAdded,
			}),
			false,
		);
		onrestored();
	} else {
		say(refusal(result), true);
	}
	busy = false;
}
</script>

<section class="mt-s-5" aria-labelledby="backup-title" data-testid="backup-panel">
	<h2 id="backup-title" class="title poster-head">{m.library_backup_title()}</h2>
	<p class="lead max-w-[52ch]">{m.library_backup_lead()}</p>
	<div class="mt-s-3 flex flex-wrap items-center gap-s-2">
		<button type="button" class="segment border-2 border-ink" disabled={busy} onclick={download}>
			{m.library_backup_download()}
		</button>
		<label class="segment file inline-flex items-center border-2 border-ink">
			{m.library_backup_restore()}
			<input
				type="file"
				class="sr-only"
				accept=".json,application/json"
				data-testid="backup-file"
				disabled={busy}
				onchange={restore}
			/>
		</label>
	</div>
	{#if message}
		<p
			class="label mt-s-2 max-w-[52ch] {failed ? 'text-red-ink' : ''}"
			role={failed ? "alert" : "status"}
			data-testid="backup-status"
		>
			{message}
		</p>
	{/if}
</section>

<style>
	.file:focus-within {
		outline: 3px solid var(--color-red);
		outline-offset: 3px;
	}
</style>
