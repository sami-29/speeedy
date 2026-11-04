import {
	BACKUP_FORMAT,
	BACKUP_VERSION,
	type BackupDocument,
	type BackupSession,
	type JsonValue,
} from "@speeedy/contracts";
import { localDate } from "@speeedy/engine";
import type {
	DocumentMeta,
	LibraryStore,
	StoredSession,
} from "../library/store.ts";

export type CreatedBackup = {
	blob: Blob;
	filename: string;
	/** Documents in the file. */
	documents: number;
	/** Documents left out because their record or text is damaged. */
	skipped: number;
};

/**
 * Each field is named here, never spread from the record, so nothing the Library keeps for
 * itself can reach the file. The launcher's source URL and the sync flags stay on the device.
 */
function exportedDocument(
	meta: DocumentMeta,
	document: BackupDocument["document"],
): BackupDocument {
	return {
		id: meta.id,
		title: meta.title,
		titleChangedAt: meta.titleChangedAt,
		language: meta.language,
		languageOverride: meta.languageOverride,
		languageOverrideChangedAt: meta.languageOverrideChangedAt,
		contentHash: meta.contentHash,
		source: meta.source,
		position: { block: meta.position.block, offset: meta.position.offset },
		progress: meta.progress,
		positionChangedAt: meta.positionChangedAt,
		createdAt: meta.createdAt,
		lastReadAt: meta.lastReadAt,
		deviceOnly: meta.deviceOnly,
		deviceOnlyChangedAt: meta.deviceOnlyChangedAt,
		document,
	};
}

function exportedSession(session: StoredSession): BackupSession {
	const out: BackupSession = {
		id: session.id,
		documentId: session.documentId,
		date: session.date,
		startedAt: session.startedAt,
		activeMs: session.activeMs,
		wordsRead: session.wordsRead,
		wpm: session.wpm,
	};
	if (session.localOnly) out.localOnly = true;
	return out;
}

/**
 * Read the Library and make the backup file. The file is built from parts, one per document,
 * so a large Library is never one string of its own.
 */
export async function createBackup(
	store: LibraryStore,
	options: { now?: () => number } = {},
): Promise<CreatedBackup> {
	const now = (options.now ?? Date.now)();
	const snapshot = await store.backupSnapshot();
	const settings = Object.entries(snapshot.settings).map(([key, entry]) => ({
		key,
		value: entry.value as JsonValue,
		changedAt: entry.changedAt,
	}));
	const parts: string[] = [
		`{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},"exportedAt":${now},"documents":[`,
	];
	snapshot.documents.forEach(({ meta, document }, index) => {
		if (index > 0) parts.push(",");
		parts.push(JSON.stringify(exportedDocument(meta, document)));
	});
	parts.push(
		`],"sessions":${JSON.stringify(snapshot.sessions.map(exportedSession))}`,
		`,"trainingResults":${JSON.stringify(
			snapshot.trainingResults.map((each) => ({
				id: each.id,
				kind: each.kind,
				completedAt: each.completedAt,
				scores: each.scores,
			})),
		)}`,
		`,"dailyGoalChanges":${JSON.stringify(
			snapshot.dailyGoalChanges.map((each) => ({
				id: each.id,
				minutes: each.minutes,
				effectiveDate: each.effectiveDate,
				changedAt: each.changedAt,
			})),
		)}`,
		`,"settings":${JSON.stringify(settings)}}`,
	);
	return {
		blob: new Blob(parts, { type: "application/json" }),
		filename: `speeedy-backup-${localDate(now)}.json`,
		documents: snapshot.documents.length,
		skipped: snapshot.skipped,
	};
}
