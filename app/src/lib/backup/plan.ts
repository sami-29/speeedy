import {
	type BackupDocument,
	type BackupFile,
	clampPosition,
} from "@speeedy/contracts";
import {
	canonicalJson,
	mergeDocument,
	mergeSession,
	mergeSettings,
	pickLatest,
	type SettingEntry,
	type SyncDocument,
} from "@speeedy/sync";
import type {
	DocumentMeta,
	RestoreBase,
	RestorePlan,
	StoredSession,
} from "../library/store.ts";

export type PlannedRestore = {
	plan: RestorePlan;
	/** Documents new to this Library. */
	documentsAdded: number;
	/** Documents whose text was already here, merged into the copy that is. */
	documentsMatched: number;
	sessionsAdded: number;
};

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const byId = <T extends { id: string }>(a: T, b: T) =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Only the fields Sync's rules merge. */
function syncFields(
	doc: Pick<
		DocumentMeta,
		| "id"
		| "contentHash"
		| "language"
		| "title"
		| "titleChangedAt"
		| "languageOverride"
		| "languageOverrideChangedAt"
		| "position"
		| "progress"
		| "positionChangedAt"
	>,
): SyncDocument {
	return {
		id: doc.id,
		contentHash: doc.contentHash,
		language: doc.language,
		title: doc.title,
		titleChangedAt: doc.titleChangedAt,
		languageOverride: doc.languageOverride,
		languageOverrideChangedAt: doc.languageOverrideChangedAt,
		position: { block: doc.position.block, offset: doc.position.offset },
		progress: doc.progress,
		positionChangedAt: doc.positionChangedAt,
	};
}

const later = (a: number | null, b: number | null): number | null =>
	a === null ? b : b === null ? a : Math.max(a, b);

/**
 * What a restore writes, worked out from the Library as it is and a file that has already
 * been read and checked. Pure: no storage, no clock. The rules are Sync's (`@speeedy/sync`),
 * so a restore and a sync of the same records agree.
 *
 * - A document whose text (content hash) is already here keeps its copy: the later Position,
 *   title and language override win, and its own source address stays. Its Sessions move to it.
 * - A new document keeps its ID unless this Library already uses it, for a document or a
 *   delete; then it takes a fresh one, so a file can never overwrite another document.
 * - Sessions only grow, Training results and Daily Goal changes are inserted once, and each
 *   setting wins by its own change time.
 * - Running it again on its own output writes nothing.
 */
export function planRestore(
	current: RestoreBase,
	backup: BackupFile,
	newId: () => string,
): PlannedRestore {
	const twins = new Map<string, DocumentMeta>();
	for (const meta of [...current.documents].sort(byId)) {
		if (!twins.has(meta.contentHash)) twins.set(meta.contentHash, meta);
	}
	const taken = new Set(current.takenIds);
	const libraryId = new Map<string, string>();
	const documents: RestorePlan["documents"] = [];
	let documentsAdded = 0;
	let documentsMatched = 0;

	for (const entry of [...backup.documents].sort(byId)) {
		const position = clampPosition(entry.position, entry.document);
		const twin = twins.get(entry.contentHash);
		if (twin !== undefined) {
			documentsMatched += 1;
			libraryId.set(entry.id, twin.id);
			const merged = mergeDocument(
				syncFields(twin),
				syncFields({ ...entry, id: twin.id, position }),
			);
			const deviceOnly = pickLatest(
				{ value: twin.deviceOnly, at: twin.deviceOnlyChangedAt },
				{
					value: entry.deviceOnly ?? false,
					at: entry.deviceOnlyChangedAt ?? 0,
				},
			);
			const next: DocumentMeta = {
				...twin,
				...merged,
				lastReadAt: later(twin.lastReadAt, entry.lastReadAt ?? null),
				deviceOnly: deviceOnly.value,
				deviceOnlyChangedAt: deviceOnly.at,
			};
			if (!same(next, twin)) documents.push({ meta: next });
			continue;
		}
		let id = entry.id;
		while (taken.has(id)) id = newId();
		taken.add(id);
		libraryId.set(entry.id, id);
		const meta = newDocument(entry, id, position, backup.exportedAt);
		twins.set(entry.contentHash, meta);
		documents.push({ meta, document: entry.document });
		documentsAdded += 1;
	}

	const held = new Map(current.sessions.map((each) => [each.id, each]));
	const sessions: StoredSession[] = [];
	let sessionsAdded = 0;
	for (const each of [...backup.sessions].sort(byId)) {
		const incoming: StoredSession = {
			id: each.id,
			documentId:
				each.documentId === null
					? null
					: (libraryId.get(each.documentId) ?? each.documentId),
			date: each.date,
			startedAt: each.startedAt,
			activeMs: each.activeMs,
			wordsRead: each.wordsRead,
			wpm: each.wpm,
		};
		if (each.localOnly) incoming.localOnly = true;
		const mine = held.get(each.id);
		if (mine === undefined) {
			sessions.push(incoming);
			sessionsAdded += 1;
			continue;
		}
		const grown = mergeSession(mine, incoming);
		// Kept on this device only once, kept on this device only for good.
		const next: StoredSession =
			mine.localOnly || incoming.localOnly
				? { ...grown, localOnly: true }
				: grown;
		if (!same(next, mine)) sessions.push(next);
	}

	const theirs: Record<string, SettingEntry> = {};
	for (const each of backup.settings) {
		Object.defineProperty(theirs, each.key, {
			value: { value: each.value, changedAt: each.changedAt },
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	const settings: RestorePlan["settings"] = [];
	for (const [key, entry] of Object.entries(
		mergeSettings(current.settings, theirs),
	)) {
		const mine = Object.hasOwn(current.settings, key)
			? current.settings[key]
			: undefined;
		if (!same(entry, mine)) settings.push({ key, entry });
	}

	const goalIds = new Set(current.dailyGoalChanges.map((each) => each.id));
	const resultIds = new Set(current.trainingResults.map((each) => each.id));
	return {
		plan: {
			documents,
			sessions,
			settings,
			dailyGoalChanges: backup.dailyGoalChanges.filter(
				(each) => !goalIds.has(each.id),
			),
			trainingResults: backup.trainingResults.filter(
				(each) => !resultIds.has(each.id),
			),
		},
		documentsAdded,
		documentsMatched,
		sessionsAdded,
	};
}

/** A document new to this Library. Its source address is not in the file, so it has none. */
function newDocument(
	entry: BackupDocument,
	id: string,
	position: DocumentMeta["position"],
	exportedAt: number,
): DocumentMeta {
	return {
		id,
		title: entry.title,
		titleChangedAt: entry.titleChangedAt,
		language: entry.language,
		languageOverride: entry.languageOverride,
		languageOverrideChangedAt: entry.languageOverrideChangedAt,
		contentHash: entry.contentHash,
		source: entry.source ?? "own",
		sourceUrl: null,
		position,
		positionChangedAt: entry.positionChangedAt,
		progress: entry.progress,
		createdAt: entry.createdAt ?? exportedAt,
		lastReadAt:
			entry.lastReadAt !== undefined
				? entry.lastReadAt
				: entry.positionChangedAt > 0
					? entry.positionChangedAt
					: null,
		deviceOnly: entry.deviceOnly ?? false,
		deviceOnlyChangedAt: entry.deviceOnlyChangedAt ?? 0,
		sync: { pending: false, remoteId: null },
	};
}
