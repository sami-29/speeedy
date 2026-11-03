import type { Position } from "@speeedy/contracts";

/**
 * The records Sync merges. Every time is epoch milliseconds from the clock of the device
 * that made the change; clock skew is accepted (ticket 49). The Library's own records
 * (`app/src/lib/library/store.ts`) satisfy these shapes structurally, extra fields included.
 */

/** A value and the time it was set, for last-write-wins. */
export type Stamped<T> = { value: T; at: number };

/** What the server keeps about a document, besides its text. */
export type SyncDocument = {
	id: string;
	/** The structural hash of the text. Same-hash documents merge. */
	contentHash: string;
	/** The language the parser detected. */
	language: string;
	title: string;
	/** 0 until the reader renames it. */
	titleChangedAt: number;
	languageOverride: string | null;
	/** 0 until the reader overrides it. */
	languageOverrideChangedAt: number;
	position: Position;
	/** The share of the text before `position`, 0 to 1. It travels with the Position. */
	progress: number;
	/** The local time of the read that made `position`. 0 until it is first read. */
	positionChangedAt: number;
};

/** A document as the device holds it. */
export type DeviceDocument = SyncDocument & {
	/** "Keep on this device only": nothing about it leaves the device. */
	deviceOnly: boolean;
	/** When `deviceOnly` last changed. 0 when the reader never changed it. */
	deviceOnlyChangedAt: number;
};

/** A deleted document. On the server it is kept for the life of the Account. */
export type SyncTombstone = {
	id: string;
	contentHash: string;
	deletedAt: number;
};

export type SyncSession = {
	id: string;
	documentId: string | null;
	date: string;
	startedAt: number;
	activeMs: number;
	wordsRead: number;
	wpm: number;
	/**
	 * Set by the Library on a Session recorded while its document was kept on this device
	 * only. Such a Session never leaves the device, whatever later happens to the document.
	 */
	localOnly?: true;
};

export type SettingEntry = { value: unknown; changedAt: number };

export type DailyGoalChange = {
	id: string;
	minutes: number;
	effectiveDate: string;
	changedAt: number;
};

export type TrainingResult = {
	id: string;
	kind: string;
	completedAt: number;
	scores: Record<string, number>;
};

type Records = {
	settings: Record<string, SettingEntry>;
	dailyGoalChanges: DailyGoalChange[];
	sessions: SyncSession[];
	trainingResults: TrainingResult[];
};

/** Everything one device holds that Sync looks at. */
export type DeviceState = Records & {
	/** The server generation this device last synced with; null before its first sync. */
	generation: string | null;
	documents: DeviceDocument[];
	/** Deletes not yet confirmed by the server. */
	tombstones: SyncTombstone[];
};

/** Everything the server holds for one Account. */
export type ServerState = Records & {
	/** Changes whenever the server copy is wiped. A device on another one runs First sync. */
	generation: string;
	/** Live documents. */
	documents: SyncDocument[];
	tombstones: SyncTombstone[];
};

/** What a device sends after a merge. Only records the server lacks, or holds an older copy of. */
export type Push = {
	documents: SyncDocument[];
	/** Documents new to the server, whose text must be uploaded. */
	uploads: string[];
	tombstones: SyncTombstone[];
	sessions: SyncSession[];
	settings: Record<string, SettingEntry>;
	dailyGoalChanges: DailyGoalChange[];
	trainingResults: TrainingResult[];
};

/**
 * One change for the device to make to its Library. Apply them in order, after the push is
 * accepted.
 */
export type LocalWrite =
	/** A document from the account. Its text is downloaded afterwards (see `downloads`). */
	| { kind: "add-document"; document: SyncDocument }
	/** Take the merged synced fields, keeping each field's own change time. */
	| { kind: "update-document"; document: SyncDocument }
	/** Move a document to the ID its twin has in the account, with the current-document pointer. */
	| { kind: "rekey-document"; from: string; to: string }
	/** Deleted elsewhere. Its Sessions stay. */
	| { kind: "remove-document"; id: string }
	| { kind: "set-device-only"; id: string; at: number }
	/** The server has this delete, or never knew the document. */
	| { kind: "drop-tombstone"; id: string }
	| { kind: "put-session"; session: SyncSession }
	| { kind: "put-setting"; key: string; entry: SettingEntry }
	| { kind: "put-goal-change"; change: DailyGoalChange }
	| { kind: "put-training-result"; result: TrainingResult };

/** The answer to First sync's one question, when a device has documents the account lacks. */
export type FirstSyncAnswer = "add" | "keep";

export type SyncInput = {
	device: DeviceState;
	server: ServerState;
	/** The time to stamp changes Sync itself makes, such as marking documents device-only. */
	now: number;
	/** A fresh document ID, for a document uploaded again after a delete elsewhere. */
	newId: () => string;
	firstSyncAnswer?: FirstSyncAnswer;
	/** The setting keys that sync. Every other setting stays on the device. */
	syncedSettings?: readonly string[];
};

export type SyncResult =
	| {
			status: "question";
			/** "This device has N documents … that aren't in your account". */
			documents: number;
	  }
	| {
			status: "synced";
			/** For the device to keep as its cursor's generation. */
			generation: string;
			/** The device's state once `writes` are applied. */
			device: DeviceState;
			/** The server's state once `push` is applied. */
			server: ServerState;
			writes: LocalWrite[];
			push: Push;
			/** Document IDs whose text to download, newest Position first. */
			downloads: string[];
	  };

/**
 * The server's answer to a pushed document it will not take: a new document whose text it
 * already holds under `existingId`, or a document whose ID it holds with another text
 * (`existingId` is then the same ID).
 */
export type Refusal = { id: string; existingId: string };
