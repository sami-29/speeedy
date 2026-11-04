/**
 * The Library: everything Speeedy keeps on this device, in one IndexedDB database. This is
 * the only module that touches it, so Sync, the backup file and the 1.x import all build on
 * the interface below and never on the tables.
 *
 * The schema is versioned (`SCHEMA_VERSION`). A document's text lives in its own table, so
 * listing the Library never reads a Document, and a Document is checked by the contracts
 * validator on the way in and on the way out. A damaged record is skipped, never purged.
 */

import {
	type Block,
	blockText,
	clampPosition,
	type Document,
	isPosition,
	type Position,
	validateDocument,
} from "@speeedy/contracts";
import type { SessionRecord } from "@speeedy/engine";
import { pickLatest } from "@speeedy/sync";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

/** Bump with a new `upgrade` step whenever a table changes shape. */
export const SCHEMA_VERSION = 1;

export const LIBRARY_DB_NAME = "speeedy-library";

/** Where a document came from. Session analytics report it as an enum. */
export type DocumentSource = "own" | "demo" | "share";

/**
 * A document's record. Each field the reader can change has its own change time, so Sync
 * merges each one by last-write-wins (`@speeedy/sync`); a time of 0 means never changed.
 */
export type DocumentMeta = {
	id: string;
	title: string;
	titleChangedAt: number;
	/** The language the parser detected: a BCP 47 tag, `und` when unknown. */
	language: string;
	/** The reader's own choice, which wins over `language`. */
	languageOverride: string | null;
	languageOverrideChangedAt: number;
	/**
	 * SHA-256 of the text and its structure (each block's kind, heading level and list
	 * depth), used to deduplicate here and to merge same-text documents across devices.
	 */
	contentHash: string;
	source: DocumentSource;
	/** Where the page came from. It never leaves this device. */
	sourceUrl: string | null;
	position: Position;
	/**
	 * When `position` was last read, on whichever device read it. 0 until it is first read,
	 * so a fresh copy never beats a real read elsewhere.
	 */
	positionChangedAt: number;
	/** The share of the text before `position`, 0 to 1. */
	progress: number;
	createdAt: number;
	lastReadAt: number | null;
	/** Kept off Sync on the reader's say-so. */
	deviceOnly: boolean;
	deviceOnlyChangedAt: number;
	sync: { pending: boolean; remoteId: string | null };
};

export type Tombstone = {
	id: string;
	kind: "document";
	contentHash: string;
	deletedAt: number;
};

export type SettingEntry = { value: unknown; changedAt: number };

export type DailyGoalChange = {
	id: string;
	minutes: number;
	/** The local calendar date the goal applies from, `YYYY-MM-DD`. */
	effectiveDate: string;
	changedAt: number;
};

export type StoredSession = SessionRecord & {
	id: string;
	documentId: string | null;
	/** Recorded while its document was kept on this device only: Sync never sends it. */
	localOnly?: true;
};

export type TrainingResult = {
	id: string;
	kind: string;
	completedAt: number;
	scores: Record<string, number>;
};

/** Everything the backup file carries, read in one transaction. */
export type LibrarySnapshot = {
	documents: { meta: DocumentMeta; document: Document }[];
	/** Documents left out because their record or their text is damaged. */
	skipped: number;
	sessions: StoredSession[];
	trainingResults: TrainingResult[];
	settings: Record<string, SettingEntry>;
	dailyGoalChanges: DailyGoalChange[];
};

/** What a restore sees of the Library, read inside its transaction. */
export type RestoreBase = {
	documents: DocumentMeta[];
	/**
	 * Every ID a new document must not take: documents (damaged ones too), their texts, and
	 * deleted documents.
	 */
	takenIds: Set<string>;
	sessions: StoredSession[];
	settings: Record<string, SettingEntry>;
	dailyGoalChanges: DailyGoalChange[];
	trainingResults: TrainingResult[];
};

/** The writes a restore makes. `document` is the text of a document that is new here. */
export type RestorePlan = {
	documents: { meta: DocumentMeta; document?: Document }[];
	sessions: StoredSession[];
	settings: { key: string; entry: SettingEntry }[];
	dailyGoalChanges: DailyGoalChange[];
	trainingResults: TrainingResult[];
};

/** What `deleteDocument` hands back, so `restoreDocument` can undo it. */
export type RemovedDocument = {
	meta: DocumentMeta;
	content: ContentRecord | undefined;
};

export type LibraryErrorCode =
	| "invalid-document"
	| "invalid-title"
	| "invalid-argument"
	| "not-found"
	| "newer-schema"
	| "unavailable";

export class LibraryError extends Error {
	readonly code: LibraryErrorCode;

	constructor(code: LibraryErrorCode, message: string) {
		super(message);
		this.name = "LibraryError";
		this.code = code;
	}
}

type ContentRecord = { id: string; document: Document };
type MetaRecord = { key: string; value: unknown };
type SettingRecord = SettingEntry & { key: string };

interface LibrarySchema extends DBSchema {
	documents: {
		key: string;
		value: DocumentMeta;
		indexes: { byHash: string };
	};
	contents: { key: string; value: ContentRecord };
	sessions: {
		key: string;
		value: StoredSession;
		indexes: { byStartedAt: number };
	};
	trainingResults: {
		key: string;
		value: TrainingResult;
		indexes: { byCompletedAt: number };
	};
	settings: { key: string; value: SettingRecord };
	dailyGoalChanges: {
		key: string;
		value: DailyGoalChange;
		indexes: { byDate: string };
	};
	tombstones: { key: string; value: Tombstone };
	meta: { key: string; value: MetaRecord };
}

type LibraryDb = IDBPDatabase<LibrarySchema>;

const CURRENT_KEY = "currentDocument";
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type AddDocumentInput = {
	document: Document;
	title: string;
	language: string;
	source?: DocumentSource;
	sourceUrl?: string | null;
};

export type LibraryStore = {
	/** Keep a document. The same text added twice is kept once and `duplicate` says so. */
	addDocument(
		input: AddDocumentInput,
	): Promise<{ meta: DocumentMeta; duplicate: boolean }>;
	/** Every readable document, the most recently read first. */
	list(): Promise<DocumentMeta[]>;
	get(id: string): Promise<DocumentMeta | null>;
	/** A document with its text, or null when it is missing or damaged. */
	load(id: string): Promise<{ meta: DocumentMeta; document: Document } | null>;
	rename(id: string, title: string): Promise<DocumentMeta>;
	/** `null` goes back to the detected language. */
	setLanguageOverride(
		id: string,
		language: string | null,
	): Promise<DocumentMeta>;
	savePosition(id: string, position: Position, progress: number): Promise<void>;
	setDeviceOnly(id: string, deviceOnly: boolean): Promise<DocumentMeta>;
	/**
	 * Take a Position Sync brought from another device, with that device's read time, when it
	 * is the later one. True when it was taken.
	 */
	applyRemotePosition(
		id: string,
		remote: Pick<DocumentMeta, "position" | "progress" | "positionChangedAt">,
	): Promise<boolean>;
	deleteDocument(id: string): Promise<RemovedDocument>;
	/** Undo a delete. False when the same text has been added again since. */
	restoreDocument(removed: RemovedDocument): Promise<boolean>;
	tombstones(): Promise<Tombstone[]>;

	/** The document `/reader` resumes, or null. */
	currentId(): Promise<string | null>;
	setCurrent(id: string | null): Promise<void>;

	setSetting(key: string, value: unknown): Promise<void>;
	/** Only what was set, each with its own change time. Nothing is filled from defaults. */
	settings(): Promise<Record<string, SettingEntry>>;
	setDailyGoal(change: {
		minutes: number;
		effectiveDate: string;
	}): Promise<DailyGoalChange>;
	dailyGoalChanges(): Promise<DailyGoalChange[]>;
	addSession(
		session: SessionRecord & { documentId: string | null },
	): Promise<StoredSession>;
	sessions(): Promise<StoredSession[]>;
	addTrainingResult(result: {
		kind: string;
		scores: Record<string, number>;
	}): Promise<TrainingResult>;
	trainingResults(): Promise<TrainingResult[]>;

	/** Everything the backup file carries, read at one moment. */
	backupSnapshot(): Promise<LibrarySnapshot>;
	/**
	 * Apply a restore in one transaction. `build` is given the Library as it is inside the
	 * transaction and returns the writes; if it throws or any write fails, nothing changes.
	 */
	restore(build: (current: RestoreBase) => RestorePlan): Promise<void>;

	/** Close the connection. The next call opens it again. */
	close(): void;
};

export type LibraryStoreOptions = {
	/** The IndexedDB name. Tests use their own. */
	name?: string;
	now?: () => number;
	newId?: () => string;
};

/** The language a document is read in. */
export function effectiveLanguage(
	meta: Pick<DocumentMeta, "language" | "languageOverride">,
): string {
	return meta.languageOverride ?? meta.language;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/** A record that is complete enough to show and edit. Anything less is skipped. */
function isMeta(value: unknown): value is DocumentMeta {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.title === "string" &&
		isNumber(value.titleChangedAt) &&
		typeof value.language === "string" &&
		(value.languageOverride === null ||
			typeof value.languageOverride === "string") &&
		isNumber(value.languageOverrideChangedAt) &&
		typeof value.contentHash === "string" &&
		(value.source === "own" ||
			value.source === "demo" ||
			value.source === "share") &&
		(value.sourceUrl === null || typeof value.sourceUrl === "string") &&
		isPosition(value.position) &&
		isNumber(value.positionChangedAt) &&
		isNumber(value.progress) &&
		isNumber(value.createdAt) &&
		(value.lastReadAt === null || isNumber(value.lastReadAt)) &&
		typeof value.deviceOnly === "boolean" &&
		isNumber(value.deviceOnlyChangedAt) &&
		isRecord(value.sync)
	);
}

/**
 * What the content hash covers: each block's kind, heading level, list depth and order, and
 * text. Emphasis and image sizes are left out, so a re-parse that only restyles the same
 * text still matches.
 */
function hashedStructure(block: Block): unknown[] {
	switch (block.kind) {
		case "heading":
			return [block.kind, block.level, block.text];
		case "list-item":
			return [block.kind, block.depth, block.ordered, block.text];
		default:
			return [block.kind, blockText(block)];
	}
}

/** The key Sync merges on and the backup file is checked against. */
export async function hashDocument(document: Document): Promise<string> {
	const text = JSON.stringify(document.blocks.map(hashedStructure));
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function checkLanguage(language: string): void {
	if (!LANGUAGE_TAG.test(language)) {
		throw new LibraryError(
			"invalid-argument",
			`"${language}" is not a language tag`,
		);
	}
}

const isDate = (value: unknown): value is string => {
	if (typeof value !== "string" || !LOCAL_DATE.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
};

function checkDate(date: string): void {
	if (!isDate(date)) {
		throw new LibraryError("invalid-argument", `"${date}" is not a date`);
	}
}

const isCount = (value: unknown): value is number =>
	isNumber(value) && value >= 0;

/** A Session that could have happened. Anything less is refused on the way in and skipped on the way out. */
function isSession(value: unknown): value is StoredSession {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		isDate(value.date) &&
		isNumber(value.startedAt) &&
		isCount(value.activeMs) &&
		Number.isInteger(value.wordsRead) &&
		isCount(value.wordsRead) &&
		isCount(value.wpm) &&
		(value.documentId === null || typeof value.documentId === "string") &&
		(value.localOnly === undefined || value.localOnly === true)
	);
}

const recency = (meta: DocumentMeta) => meta.lastReadAt ?? meta.createdAt;

export function createLibraryStore(
	options: LibraryStoreOptions = {},
): LibraryStore {
	const name = options.name ?? LIBRARY_DB_NAME;
	const now = options.now ?? Date.now;
	const newId = options.newId ?? (() => crypto.randomUUID());

	let connection: Promise<LibraryDb> | undefined;

	const connect = async (): Promise<LibraryDb> => {
		try {
			const db = await openDB<LibrarySchema>(name, SCHEMA_VERSION, {
				upgrade(upgrading, oldVersion) {
					if (oldVersion < 1) {
						upgrading
							.createObjectStore("documents", { keyPath: "id" })
							.createIndex("byHash", "contentHash");
						upgrading.createObjectStore("contents", { keyPath: "id" });
						upgrading
							.createObjectStore("sessions", { keyPath: "id" })
							.createIndex("byStartedAt", "startedAt");
						upgrading
							.createObjectStore("trainingResults", { keyPath: "id" })
							.createIndex("byCompletedAt", "completedAt");
						upgrading.createObjectStore("settings", { keyPath: "key" });
						upgrading
							.createObjectStore("dailyGoalChanges", { keyPath: "id" })
							.createIndex("byDate", "effectiveDate");
						upgrading.createObjectStore("tombstones", { keyPath: "id" });
						upgrading.createObjectStore("meta", { keyPath: "key" });
					}
				},
				// Another tab wants a newer schema: let it through.
				blocking() {
					connection = undefined;
					db.close();
				},
				terminated() {
					connection = undefined;
				},
			});
			return db;
		} catch (error) {
			if (error instanceof DOMException && error.name === "VersionError") {
				throw new LibraryError(
					"newer-schema",
					"This Library was written by a newer version of Speeedy.",
				);
			}
			throw new LibraryError(
				"unavailable",
				"This browser would not open the Library.",
			);
		}
	};

	const database = (): Promise<LibraryDb> => {
		if (!connection) {
			const opening = connect();
			connection = opening;
			opening.catch(() => {
				if (connection === opening) connection = undefined;
			});
		}
		return connection;
	};

	const update = async (
		id: string,
		change: (meta: DocumentMeta) => DocumentMeta,
	): Promise<DocumentMeta> => {
		const db = await database();
		const tx = db.transaction("documents", "readwrite");
		const meta = await tx.store.get(id);
		if (!isMeta(meta)) {
			tx.abort();
			await tx.done.catch(() => undefined);
			throw new LibraryError("not-found", "No such document.");
		}
		const next = change(meta);
		// A change that keeps the record as it is writes nothing.
		if (next !== meta) await tx.store.put(next);
		await tx.done;
		return next;
	};

	return {
		async addDocument(input) {
			const checked = validateDocument(input.document);
			if (!checked.ok) {
				throw new LibraryError("invalid-document", checked.error);
			}
			const title = input.title.trim();
			if (title === "") {
				throw new LibraryError("invalid-title", "A document needs a title.");
			}
			checkLanguage(input.language);
			// Hash before the transaction opens: a transaction closes if it waits on anything else.
			const contentHash = await hashDocument(checked.document);
			const db = await database();
			const tx = db.transaction(["documents", "contents"], "readwrite");
			const existing = await tx
				.objectStore("documents")
				.index("byHash")
				.get(contentHash);
			if (isMeta(existing)) {
				await tx.done;
				return { meta: existing, duplicate: true };
			}
			const source = input.source ?? "own";
			const meta: DocumentMeta = {
				id: newId(),
				title,
				titleChangedAt: 0,
				language: input.language,
				languageOverride: null,
				languageOverrideChangedAt: 0,
				contentHash,
				source,
				sourceUrl: input.sourceUrl ?? null,
				position: { block: 0, offset: 0 },
				positionChangedAt: 0,
				progress: 0,
				createdAt: now(),
				lastReadAt: null,
				// A stranger wrote a Share Link's text: Sync leaves it alone until the reader says so.
				deviceOnly: source === "share",
				deviceOnlyChangedAt: 0,
				sync: { pending: false, remoteId: null },
			};
			await tx.objectStore("documents").put(meta);
			await tx
				.objectStore("contents")
				.put({ id: meta.id, document: checked.document });
			await tx.done;
			return { meta, duplicate: false };
		},

		async list() {
			const db = await database();
			const all = await db.getAll("documents");
			return all
				.filter(isMeta)
				.sort(
					(a, b) =>
						recency(b) - recency(a) ||
						b.createdAt - a.createdAt ||
						a.id.localeCompare(b.id),
				);
		},

		async get(id) {
			const db = await database();
			const meta = await db.get("documents", id);
			return isMeta(meta) ? meta : null;
		},

		async load(id) {
			const db = await database();
			const tx = db.transaction(["documents", "contents"], "readonly");
			const [meta, content] = await Promise.all([
				tx.objectStore("documents").get(id),
				tx.objectStore("contents").get(id),
			]);
			await tx.done;
			if (!isMeta(meta) || !isRecord(content)) return null;
			const checked = validateDocument(content.document);
			if (!checked.ok) return null;
			return {
				meta: {
					...meta,
					position: clampPosition(meta.position, checked.document),
				},
				document: checked.document,
			};
		},

		async rename(id, title) {
			const trimmed = title.trim();
			if (trimmed === "") {
				throw new LibraryError("invalid-title", "A document needs a title.");
			}
			const at = now();
			return update(id, (meta) =>
				// The same value at a later time would beat a real change made elsewhere.
				meta.title === trimmed
					? meta
					: { ...meta, title: trimmed, titleChangedAt: at },
			);
		},

		async setLanguageOverride(id, language) {
			if (language !== null) checkLanguage(language);
			const at = now();
			return update(id, (meta) =>
				meta.languageOverride === language
					? meta
					: {
							...meta,
							languageOverride: language,
							languageOverrideChangedAt: at,
						},
			);
		},

		async savePosition(id, position, progress) {
			if (!isPosition(position) || !isNumber(progress)) {
				throw new LibraryError("invalid-argument", "Not a Position.");
			}
			const clock = now();
			await update(id, (meta) => {
				// A read is always later than the last one, so a clock behind the time a Position
				// came with from another device cannot lose this read on the next sync.
				const at = Math.max(clock, meta.positionChangedAt + 1);
				return {
					...meta,
					position,
					progress: Math.min(1, Math.max(0, progress)),
					positionChangedAt: at,
					lastReadAt: at,
				};
			});
		},

		async setDeviceOnly(id, deviceOnly) {
			const at = now();
			return update(id, (meta) =>
				// A later time on an unchanged setting would revive a document deleted elsewhere.
				meta.deviceOnly === deviceOnly
					? meta
					: { ...meta, deviceOnly, deviceOnlyChangedAt: at },
			);
		},

		async applyRemotePosition(id, remote) {
			const { position, progress, positionChangedAt } = remote;
			if (
				!isPosition(position) ||
				!isNumber(progress) ||
				progress < 0 ||
				progress > 1 ||
				!isNumber(positionChangedAt)
			) {
				throw new LibraryError("invalid-argument", "Not a Position.");
			}
			const theirs = { position, progress };
			let taken = false;
			await update(id, (meta) => {
				const kept = pickLatest(
					{
						value: { position: meta.position, progress: meta.progress },
						at: meta.positionChangedAt,
					},
					{ value: theirs, at: positionChangedAt },
				);
				if (kept.value !== theirs) return meta;
				taken = true;
				return {
					...meta,
					position,
					progress,
					positionChangedAt,
					// A copy never read anywhere (time 0) does not make this one look read.
					lastReadAt:
						positionChangedAt > 0
							? Math.max(meta.lastReadAt ?? 0, positionChangedAt)
							: meta.lastReadAt,
				};
			});
			return taken;
		},

		async deleteDocument(id) {
			const db = await database();
			const tx = db.transaction(
				["documents", "contents", "tombstones", "meta"],
				"readwrite",
			);
			const meta = await tx.objectStore("documents").get(id);
			if (!isMeta(meta)) {
				tx.abort();
				await tx.done.catch(() => undefined);
				throw new LibraryError("not-found", "No such document.");
			}
			const content = await tx.objectStore("contents").get(id);
			await tx.objectStore("documents").delete(id);
			await tx.objectStore("contents").delete(id);
			await tx.objectStore("tombstones").put({
				id,
				kind: "document",
				contentHash: meta.contentHash,
				deletedAt: now(),
			});
			const current = await tx.objectStore("meta").get(CURRENT_KEY);
			if (current?.value === id)
				await tx.objectStore("meta").delete(CURRENT_KEY);
			await tx.done;
			return { meta, content };
		},

		async restoreDocument(removed) {
			const db = await database();
			const tx = db.transaction(
				["documents", "contents", "tombstones"],
				"readwrite",
			);
			const twin = await tx
				.objectStore("documents")
				.index("byHash")
				.get(removed.meta.contentHash);
			if (isMeta(twin)) {
				await tx.done;
				return false;
			}
			await tx.objectStore("documents").put(removed.meta);
			if (removed.content)
				await tx.objectStore("contents").put(removed.content);
			await tx.objectStore("tombstones").delete(removed.meta.id);
			await tx.done;
			return true;
		},

		async tombstones() {
			const db = await database();
			return db.getAll("tombstones");
		},

		async currentId() {
			const db = await database();
			const record = await db.get("meta", CURRENT_KEY);
			if (typeof record?.value !== "string") return null;
			return isMeta(await db.get("documents", record.value))
				? record.value
				: null;
		},

		async setCurrent(id) {
			const db = await database();
			if (id === null) await db.delete("meta", CURRENT_KEY);
			else await db.put("meta", { key: CURRENT_KEY, value: id });
		},

		async setSetting(key, value) {
			if (key === "") {
				throw new LibraryError("invalid-argument", "A setting needs a name.");
			}
			const db = await database();
			await db.put("settings", { key, value, changedAt: now() });
		},

		async settings() {
			const db = await database();
			const all = await db.getAll("settings");
			return Object.fromEntries(
				all.map(({ key, value, changedAt }) => [key, { value, changedAt }]),
			);
		},

		async setDailyGoal({ minutes, effectiveDate }) {
			if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
				throw new LibraryError(
					"invalid-argument",
					"A Daily Goal is 1 to 1440 minutes.",
				);
			}
			checkDate(effectiveDate);
			const change: DailyGoalChange = {
				id: newId(),
				minutes,
				effectiveDate,
				changedAt: now(),
			};
			const db = await database();
			await db.put("dailyGoalChanges", change);
			return change;
		},

		async dailyGoalChanges() {
			const db = await database();
			const all = await db.getAll("dailyGoalChanges");
			return all.sort(
				(a, b) =>
					a.effectiveDate.localeCompare(b.effectiveDate) ||
					a.changedAt - b.changedAt,
			);
		},

		async addSession(session) {
			const stored: StoredSession = { ...session, id: newId() };
			if (!isSession(stored)) {
				throw new LibraryError("invalid-argument", "Not a Session.");
			}
			const db = await database();
			const tx = db.transaction(["documents", "sessions"], "readwrite");
			const documentId = stored.documentId;
			const meta =
				documentId === null
					? undefined
					: await tx.objectStore("documents").get(documentId);
			// Read while kept on this device only: the Session stays here for good.
			if (isMeta(meta) && meta.deviceOnly) stored.localOnly = true;
			await tx.objectStore("sessions").put(stored);
			await tx.done;
			return stored;
		},

		async sessions() {
			const db = await database();
			const all = await db.getAllFromIndex("sessions", "byStartedAt");
			return all.filter(isSession);
		},

		async addTrainingResult(result) {
			const stored: TrainingResult = {
				id: newId(),
				kind: result.kind,
				completedAt: now(),
				scores: result.scores,
			};
			const db = await database();
			await db.put("trainingResults", stored);
			return stored;
		},

		async trainingResults() {
			const db = await database();
			return db.getAllFromIndex("trainingResults", "byCompletedAt");
		},

		async backupSnapshot() {
			const db = await database();
			const tx = db.transaction(
				[
					"documents",
					"contents",
					"sessions",
					"trainingResults",
					"settings",
					"dailyGoalChanges",
				],
				"readonly",
			);
			const [metas, contents, sessions, results, settings, goals] =
				await Promise.all([
					tx.objectStore("documents").getAll(),
					tx.objectStore("contents").getAll(),
					tx.objectStore("sessions").index("byStartedAt").getAll(),
					tx.objectStore("trainingResults").index("byCompletedAt").getAll(),
					tx.objectStore("settings").getAll(),
					tx.objectStore("dailyGoalChanges").getAll(),
				]);
			await tx.done;
			const texts = new Map(
				contents.filter(isRecord).map((each) => [each.id, each.document]),
			);
			const documents: LibrarySnapshot["documents"] = [];
			let skipped = 0;
			for (const meta of metas.sort((a, b) => a.id.localeCompare(b.id))) {
				const checked = isMeta(meta)
					? validateDocument(texts.get(meta.id))
					: null;
				if (!isMeta(meta) || !checked?.ok) {
					skipped += 1;
					continue;
				}
				documents.push({
					meta: {
						...meta,
						position: clampPosition(meta.position, checked.document),
					},
					document: checked.document,
				});
			}
			return {
				documents,
				skipped,
				sessions: sessions.filter(isSession),
				trainingResults: results,
				settings: Object.fromEntries(
					settings.map(({ key, value, changedAt }) => [
						key,
						{ value, changedAt },
					]),
				),
				dailyGoalChanges: goals.sort(
					(a, b) =>
						a.effectiveDate.localeCompare(b.effectiveDate) ||
						a.changedAt - b.changedAt,
				),
			};
		},

		async restore(build) {
			const db = await database();
			const tx = db.transaction(
				[
					"documents",
					"contents",
					"sessions",
					"trainingResults",
					"settings",
					"dailyGoalChanges",
					"tombstones",
				],
				"readwrite",
			);
			try {
				const [
					metas,
					documentIds,
					contentIds,
					tombstoneIds,
					sessions,
					results,
					settings,
					goals,
				] = await Promise.all([
					tx.objectStore("documents").getAll(),
					tx.objectStore("documents").getAllKeys(),
					tx.objectStore("contents").getAllKeys(),
					tx.objectStore("tombstones").getAllKeys(),
					tx.objectStore("sessions").getAll(),
					tx.objectStore("trainingResults").getAll(),
					tx.objectStore("settings").getAll(),
					tx.objectStore("dailyGoalChanges").getAll(),
				]);
				const plan = build({
					documents: metas.filter(isMeta),
					takenIds: new Set([...documentIds, ...contentIds, ...tombstoneIds]),
					sessions: sessions.filter(isSession),
					settings: Object.fromEntries(
						settings.map(({ key, value, changedAt }) => [
							key,
							{ value, changedAt },
						]),
					),
					dailyGoalChanges: goals,
					trainingResults: results,
				});
				for (const { meta, document } of plan.documents) {
					if (!isMeta(meta)) {
						throw new LibraryError("invalid-argument", "Not a document.");
					}
					if (document !== undefined && !validateDocument(document).ok) {
						throw new LibraryError("invalid-document", "Not a Document.");
					}
				}
				for (const session of plan.sessions) {
					if (!isSession(session)) {
						throw new LibraryError("invalid-argument", "Not a Session.");
					}
				}
				const writes: Promise<unknown>[] = [];
				for (const { meta, document } of plan.documents) {
					writes.push(tx.objectStore("documents").put(meta));
					if (document !== undefined) {
						writes.push(
							tx.objectStore("contents").put({ id: meta.id, document }),
						);
					}
				}
				for (const session of plan.sessions) {
					writes.push(tx.objectStore("sessions").put(session));
				}
				for (const { key, entry } of plan.settings) {
					writes.push(
						tx.objectStore("settings").put({
							key,
							value: entry.value,
							changedAt: entry.changedAt,
						}),
					);
				}
				for (const change of plan.dailyGoalChanges) {
					writes.push(tx.objectStore("dailyGoalChanges").put(change));
				}
				for (const result of plan.trainingResults) {
					writes.push(tx.objectStore("trainingResults").put(result));
				}
				await Promise.all(writes);
				await tx.done;
			} catch (error) {
				try {
					tx.abort();
				} catch {
					// already finished or aborted
				}
				await tx.done.catch(() => undefined);
				throw error;
			}
		},

		close() {
			const pending = connection;
			connection = undefined;
			pending?.then(
				(db) => db.close(),
				() => undefined,
			);
		},
	};
}
