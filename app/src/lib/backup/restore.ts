import {
	BACKUP_LIMITS,
	type BackupFailure,
	type BackupLimits,
	parseBackup,
} from "@speeedy/contracts";
import { hashDocument, type LibraryStore } from "../library/store.ts";
import { planRestore } from "./plan.ts";

export type RestoreResult =
	| {
			ok: true;
			documentsAdded: number;
			documentsMatched: number;
			sessionsAdded: number;
	  }
	/** `storage`: the browser would not let the Library be written. */
	| { ok: false; failure: BackupFailure | "storage" };

export type RestoreOptions = {
	limits?: BackupLimits;
	/** A fresh ID, for a document whose own is taken here. */
	newId?: () => string;
};

/**
 * Restore a backup file's text into the Library. The file is checked in full first (format,
 * version, every field, and every document's hash against its own text), then merged in one
 * transaction. A file that fails any check, or a write that fails, changes nothing.
 */
export async function restoreBackup(
	store: LibraryStore,
	text: string,
	options: RestoreOptions = {},
): Promise<RestoreResult> {
	const parsed = parseBackup(text, options.limits ?? BACKUP_LIMITS);
	if (!parsed.ok) return { ok: false, failure: parsed.failure };
	const { backup } = parsed;
	// The hash is the key documents merge on, so a file's word for it is never taken.
	for (const entry of backup.documents) {
		if ((await hashDocument(entry.document)) !== entry.contentHash) {
			return { ok: false, failure: "damaged" };
		}
	}
	const newId = options.newId ?? (() => crypto.randomUUID());
	try {
		let outcome: ReturnType<typeof planRestore> | undefined;
		await store.restore((current) => {
			outcome = planRestore(current, backup, newId);
			return outcome.plan;
		});
		if (!outcome) return { ok: false, failure: "storage" };
		return {
			ok: true,
			documentsAdded: outcome.documentsAdded,
			documentsMatched: outcome.documentsMatched,
			sessionsAdded: outcome.sessionsAdded,
		};
	} catch {
		return { ok: false, failure: "storage" };
	}
}

/** Restore from a file the reader picked. A file over the size cap is refused unread. */
export async function restoreBackupFile(
	store: LibraryStore,
	file: Pick<File, "size" | "text">,
	options: RestoreOptions = {},
): Promise<RestoreResult> {
	const limits = options.limits ?? BACKUP_LIMITS;
	if (file.size > limits.bytes) return { ok: false, failure: "too-large" };
	let text: string;
	try {
		text = await file.text();
	} catch {
		return { ok: false, failure: "damaged" };
	}
	return restoreBackup(store, text, options);
}
