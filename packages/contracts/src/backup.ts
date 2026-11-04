/**
 * The backup file: one versioned JSON holding a reader's Library and stats, so they can own
 * their data without an account and restore it on any device. The Sync export ("Download my
 * data") is the same shape plus an `account` section, so there is one definition of it here.
 *
 * The file is read as hostile input. `parseBackup` checks the size, the version and every
 * field against this definition and returns fresh copies of what it accepts, or says why not.
 * It never throws and never keeps anything it was not told to expect.
 *
 * The launcher's source URL stays on the device: no field here can hold one, and a file that
 * carries one is refused.
 */

import { type Document, validateDocument } from "./document";
import type { Position } from "./position";

export const BACKUP_FORMAT = "speeedy-backup";

/** Bump when the shape changes. A reader refuses every newer version. */
export const BACKUP_VERSION = 1;

/** Where a document came from. Session analytics report it as an enum. */
export type BackupDocumentSource = "own" | "demo" | "share";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * A document with its text. The fields after `progress` are the ones only a device keeps; a
 * file from the server may leave them out, and a restore fills them in.
 */
export type BackupDocument = {
	id: string;
	title: string;
	titleChangedAt: number;
	/** The language the parser detected: a BCP 47 tag, `und` when unknown. */
	language: string;
	languageOverride: string | null;
	languageOverrideChangedAt: number;
	/** SHA-256 of the text and its structure. A restore recomputes it and refuses a mismatch. */
	contentHash: string;
	position: Position;
	/** The share of the text before `position`, 0 to 1. */
	progress: number;
	positionChangedAt: number;
	source?: BackupDocumentSource;
	createdAt?: number;
	lastReadAt?: number | null;
	/** Kept off Sync on the reader's say-so; a restore keeps it that way. */
	deviceOnly?: boolean;
	deviceOnlyChangedAt?: number;
	document: Document;
};

export type BackupSession = {
	id: string;
	documentId: string | null;
	/** The local calendar date the Session started on, `YYYY-MM-DD`. */
	date: string;
	startedAt: number;
	activeMs: number;
	wordsRead: number;
	wpm: number;
	/** Recorded while its document was kept on this device only. */
	localOnly?: true;
};

export type BackupTrainingResult = {
	id: string;
	kind: string;
	completedAt: number;
	scores: Record<string, number>;
};

export type BackupDailyGoalChange = {
	id: string;
	minutes: number;
	/** The local calendar date the goal applies from, `YYYY-MM-DD`. */
	effectiveDate: string;
	changedAt: number;
};

/** One setting with its own change time. A list, so a key can never be `__proto__` in effect. */
export type BackupSetting = {
	key: string;
	value: JsonValue;
	changedAt: number;
};

export type BackupFile = {
	format: typeof BACKUP_FORMAT;
	version: number;
	/** Epoch milliseconds. */
	exportedAt: number;
	documents: BackupDocument[];
	sessions: BackupSession[];
	trainingResults: BackupTrainingResult[];
	dailyGoalChanges: BackupDailyGoalChange[];
	settings: BackupSetting[];
};

/** "Download my data": the backup file plus what the server knows about the Account. */
export type SyncExport = BackupFile & { account: Record<string, unknown> };

export type BackupLimits = {
	/** The file's size. Checked before the text is parsed. */
	bytes: number;
	documents: number;
	sessions: number;
	trainingResults: number;
	dailyGoalChanges: number;
	settings: number;
};

export const BACKUP_LIMITS: BackupLimits = {
	bytes: 200_000_000,
	documents: 20_000,
	sessions: 500_000,
	trainingResults: 100_000,
	dailyGoalChanges: 50_000,
	settings: 1_000,
};

export type BackupFailure =
	/** Over the size cap. */
	| "too-large"
	| "not-json"
	/** JSON, but not a Speeedy backup. */
	| "not-a-backup"
	/** Written by a newer Speeedy: "Update Speeedy to open this file". */
	| "newer-version"
	/** A backup of this version with something wrong in it. */
	| "damaged";

export type BackupParse =
	| { ok: true; backup: BackupFile }
	| { ok: false; failure: BackupFailure; detail: string };

const MAX_TIME = 8.64e15;
const MAX_ID = 128;
const MAX_TITLE = 1_000;
const MAX_SETTING_KEY = 200;
const MAX_SETTING_NODES = 1_000;
const MAX_SETTING_DEPTH = 8;
const MAX_SETTING_STRING = 10_000;
const MAX_KIND = 100;
const MAX_SCORES = 50;

const ID = /^[A-Za-z0-9_-]+$/;
const HASH = /^[0-9a-f]{64}$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields => {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const isTime = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= 0 &&
	value <= MAX_TIME;

const isNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isId = (value: unknown): value is string =>
	typeof value === "string" && value.length <= MAX_ID && ID.test(value);

const isDate = (value: unknown): value is string => {
	if (typeof value !== "string" || !LOCAL_DATE.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
};

const isLanguage = (value: unknown): value is string =>
	typeof value === "string" && value.length <= 35 && LANGUAGE_TAG.test(value);

const hasOnlyKeys = (record: Fields, allowed: readonly string[]): boolean =>
	Object.keys(record).every((key) => allowed.includes(key));

/** A setting's value: plain JSON, shallow and small, with no key that could reach a prototype. */
function copyJson(
	value: unknown,
	depth: number,
	budget: { nodes: number },
): JsonValue {
	budget.nodes += 1;
	if (budget.nodes > MAX_SETTING_NODES || depth > MAX_SETTING_DEPTH) {
		throw new RangeError("too big");
	}
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new RangeError("not finite");
		return value;
	}
	if (typeof value === "string") {
		if (value.length > MAX_SETTING_STRING) throw new RangeError("too long");
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((each) => copyJson(each, depth + 1, budget));
	}
	if (isRecord(value)) {
		const copy: Record<string, JsonValue> = {};
		for (const key of Object.keys(value)) {
			if (FORBIDDEN_KEYS.has(key) || key.length > MAX_SETTING_KEY) {
				throw new RangeError("bad key");
			}
			Object.defineProperty(copy, key, {
				value: copyJson(value[key], depth + 1, budget),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return copy;
	}
	throw new RangeError("not JSON");
}

class Damaged extends Error {}

const fail = (detail: string): never => {
	throw new Damaged(detail);
};

const list = (value: unknown, name: string, max: number): unknown[] => {
	if (!Array.isArray(value)) return fail(`${name} must be a list`);
	if (value.length > max) return fail(`${name} has more than ${max} entries`);
	return value;
};

function readDocument(value: unknown, at: string): BackupDocument {
	if (!isRecord(value)) return fail(`${at} is not an object`);
	if (
		!hasOnlyKeys(value, [
			"id",
			"title",
			"titleChangedAt",
			"language",
			"languageOverride",
			"languageOverrideChangedAt",
			"contentHash",
			"position",
			"progress",
			"positionChangedAt",
			"source",
			"createdAt",
			"lastReadAt",
			"deviceOnly",
			"deviceOnlyChangedAt",
			"document",
		])
	) {
		return fail(`${at} has a field this version does not know`);
	}
	if (!isId(value.id)) return fail(`${at}.id is not an ID`);
	if (
		typeof value.title !== "string" ||
		value.title.trim() === "" ||
		value.title.length > MAX_TITLE
	) {
		return fail(`${at}.title is not a title`);
	}
	if (!isTime(value.titleChangedAt)) return fail(`${at}.titleChangedAt`);
	if (!isLanguage(value.language)) return fail(`${at}.language`);
	if (value.languageOverride !== null && !isLanguage(value.languageOverride)) {
		return fail(`${at}.languageOverride`);
	}
	if (!isTime(value.languageOverrideChangedAt)) {
		return fail(`${at}.languageOverrideChangedAt`);
	}
	if (typeof value.contentHash !== "string" || !HASH.test(value.contentHash)) {
		return fail(`${at}.contentHash is not a SHA-256 hash`);
	}
	const position = value.position;
	if (
		!isRecord(position) ||
		!hasOnlyKeys(position, ["block", "offset"]) ||
		!Number.isSafeInteger(position.block) ||
		!Number.isSafeInteger(position.offset) ||
		(position.block as number) < 0 ||
		(position.offset as number) < 0
	) {
		return fail(`${at}.position is not a Position`);
	}
	if (!isNumber(value.progress) || value.progress < 0 || value.progress > 1) {
		return fail(`${at}.progress`);
	}
	if (!isTime(value.positionChangedAt)) return fail(`${at}.positionChangedAt`);
	const checked = validateDocument(value.document);
	if (!checked.ok) return fail(`${at}.document: ${checked.error}`);

	const out: BackupDocument = {
		id: value.id,
		title: value.title,
		titleChangedAt: value.titleChangedAt,
		language: value.language,
		languageOverride: value.languageOverride,
		languageOverrideChangedAt: value.languageOverrideChangedAt,
		contentHash: value.contentHash,
		position: {
			block: position.block as number,
			offset: position.offset as number,
		},
		progress: value.progress,
		positionChangedAt: value.positionChangedAt,
		document: checked.document,
	};
	if (value.source !== undefined) {
		if (
			value.source !== "own" &&
			value.source !== "demo" &&
			value.source !== "share"
		) {
			return fail(`${at}.source`);
		}
		out.source = value.source;
	}
	if (value.createdAt !== undefined) {
		if (!isTime(value.createdAt)) return fail(`${at}.createdAt`);
		out.createdAt = value.createdAt;
	}
	if (value.lastReadAt !== undefined) {
		if (value.lastReadAt !== null && !isTime(value.lastReadAt)) {
			return fail(`${at}.lastReadAt`);
		}
		out.lastReadAt = value.lastReadAt;
	}
	if (value.deviceOnly !== undefined) {
		if (typeof value.deviceOnly !== "boolean") return fail(`${at}.deviceOnly`);
		out.deviceOnly = value.deviceOnly;
	}
	if (value.deviceOnlyChangedAt !== undefined) {
		if (!isTime(value.deviceOnlyChangedAt)) {
			return fail(`${at}.deviceOnlyChangedAt`);
		}
		out.deviceOnlyChangedAt = value.deviceOnlyChangedAt;
	}
	return out;
}

function readSession(value: unknown, at: string): BackupSession {
	if (!isRecord(value)) return fail(`${at} is not an object`);
	if (
		!hasOnlyKeys(value, [
			"id",
			"documentId",
			"date",
			"startedAt",
			"activeMs",
			"wordsRead",
			"wpm",
			"localOnly",
		])
	) {
		return fail(`${at} has a field this version does not know`);
	}
	if (!isId(value.id)) return fail(`${at}.id`);
	if (value.documentId !== null && !isId(value.documentId)) {
		return fail(`${at}.documentId`);
	}
	if (!isDate(value.date)) return fail(`${at}.date`);
	if (!isTime(value.startedAt)) return fail(`${at}.startedAt`);
	if (
		!isNumber(value.activeMs) ||
		value.activeMs < 0 ||
		value.activeMs > 7 * 86_400_000
	) {
		return fail(`${at}.activeMs`);
	}
	if (
		!Number.isSafeInteger(value.wordsRead) ||
		(value.wordsRead as number) < 0 ||
		(value.wordsRead as number) > 100_000_000
	) {
		return fail(`${at}.wordsRead`);
	}
	if (!isNumber(value.wpm) || value.wpm < 0 || value.wpm > 100_000) {
		return fail(`${at}.wpm`);
	}
	const out: BackupSession = {
		id: value.id,
		documentId: value.documentId,
		date: value.date,
		startedAt: value.startedAt,
		activeMs: value.activeMs,
		wordsRead: value.wordsRead as number,
		wpm: value.wpm,
	};
	if (value.localOnly !== undefined) {
		if (value.localOnly !== true) return fail(`${at}.localOnly`);
		out.localOnly = true;
	}
	return out;
}

function readTrainingResult(value: unknown, at: string): BackupTrainingResult {
	if (!isRecord(value)) return fail(`${at} is not an object`);
	if (!hasOnlyKeys(value, ["id", "kind", "completedAt", "scores"])) {
		return fail(`${at} has a field this version does not know`);
	}
	if (!isId(value.id)) return fail(`${at}.id`);
	if (
		typeof value.kind !== "string" ||
		value.kind === "" ||
		value.kind.length > MAX_KIND
	) {
		return fail(`${at}.kind`);
	}
	if (!isTime(value.completedAt)) return fail(`${at}.completedAt`);
	if (!isRecord(value.scores)) return fail(`${at}.scores`);
	const keys = Object.keys(value.scores);
	if (keys.length > MAX_SCORES) return fail(`${at}.scores has too many`);
	const scores: Record<string, number> = {};
	for (const key of keys) {
		const score = value.scores[key];
		if (FORBIDDEN_KEYS.has(key) || key.length > MAX_KIND || !isNumber(score)) {
			return fail(`${at}.scores`);
		}
		Object.defineProperty(scores, key, {
			value: score,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return {
		id: value.id,
		kind: value.kind,
		completedAt: value.completedAt,
		scores,
	};
}

function readGoalChange(value: unknown, at: string): BackupDailyGoalChange {
	if (!isRecord(value)) return fail(`${at} is not an object`);
	if (!hasOnlyKeys(value, ["id", "minutes", "effectiveDate", "changedAt"])) {
		return fail(`${at} has a field this version does not know`);
	}
	if (!isId(value.id)) return fail(`${at}.id`);
	if (
		!Number.isSafeInteger(value.minutes) ||
		(value.minutes as number) < 1 ||
		(value.minutes as number) > 1440
	) {
		return fail(`${at}.minutes`);
	}
	if (!isDate(value.effectiveDate)) return fail(`${at}.effectiveDate`);
	if (!isTime(value.changedAt)) return fail(`${at}.changedAt`);
	return {
		id: value.id,
		minutes: value.minutes as number,
		effectiveDate: value.effectiveDate,
		changedAt: value.changedAt,
	};
}

function readSetting(value: unknown, at: string): BackupSetting {
	if (!isRecord(value)) return fail(`${at} is not an object`);
	if (!hasOnlyKeys(value, ["key", "value", "changedAt"])) {
		return fail(`${at} has a field this version does not know`);
	}
	if (
		typeof value.key !== "string" ||
		value.key === "" ||
		value.key.length > MAX_SETTING_KEY ||
		FORBIDDEN_KEYS.has(value.key)
	) {
		return fail(`${at}.key`);
	}
	if (!Object.hasOwn(value, "value")) return fail(`${at}.value is missing`);
	if (!isTime(value.changedAt)) return fail(`${at}.changedAt`);
	let copy: JsonValue;
	try {
		copy = copyJson(value.value, 0, { nodes: 0 });
	} catch {
		return fail(`${at}.value is not a small plain JSON value`);
	}
	return { key: value.key, value: copy, changedAt: value.changedAt };
}

/** Read every entry of a section, refusing a repeated ID (or other unique key). */
function readAll<T>(
	value: unknown,
	name: string,
	max: number,
	read: (each: unknown, at: string) => T,
	unique: (each: T) => string[],
): T[] {
	const seen = new Set<string>();
	return list(value, name, max).map((each, index) => {
		const record = read(each, `${name}[${index}]`);
		for (const key of unique(record)) {
			if (seen.has(key))
				return fail(`${name}[${index}] repeats an earlier entry`);
			seen.add(key);
		}
		return record;
	});
}

/**
 * Check an unknown value against the backup format. A file of a newer version is refused
 * before anything else about it is read. Never throws.
 */
export function validateBackup(
	value: unknown,
	limits: BackupLimits = BACKUP_LIMITS,
): BackupParse {
	if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
		return {
			ok: false,
			failure: "not-a-backup",
			detail: "this is not a Speeedy backup file",
		};
	}
	const version = value.version;
	if (typeof version === "number" && Number.isSafeInteger(version)) {
		if (version > BACKUP_VERSION) {
			return {
				ok: false,
				failure: "newer-version",
				detail: `backup version ${version} is newer than ${BACKUP_VERSION}`,
			};
		}
	}
	try {
		if (
			typeof version !== "number" ||
			!Number.isSafeInteger(version) ||
			version < 1
		) {
			return fail("version must be a whole number from 1");
		}
		if (
			!hasOnlyKeys(value, [
				"format",
				"version",
				"exportedAt",
				"documents",
				"sessions",
				"trainingResults",
				"dailyGoalChanges",
				"settings",
				"account",
			])
		) {
			return fail("the file has a section this version does not know");
		}
		if (value.account !== undefined && !isRecord(value.account)) {
			return fail("account must be an object");
		}
		if (!isTime(value.exportedAt)) return fail("exportedAt");
		const documents = readAll(
			value.documents,
			"documents",
			limits.documents,
			readDocument,
			(each) => [`id:${each.id}`, `hash:${each.contentHash}`],
		);
		const sessions = readAll(
			value.sessions,
			"sessions",
			limits.sessions,
			readSession,
			(each) => [each.id],
		);
		const trainingResults = readAll(
			value.trainingResults,
			"trainingResults",
			limits.trainingResults,
			readTrainingResult,
			(each) => [each.id],
		);
		const dailyGoalChanges = readAll(
			value.dailyGoalChanges,
			"dailyGoalChanges",
			limits.dailyGoalChanges,
			readGoalChange,
			(each) => [each.id],
		);
		const settings = readAll(
			value.settings,
			"settings",
			limits.settings,
			readSetting,
			(each) => [each.key],
		);
		return {
			ok: true,
			backup: {
				format: BACKUP_FORMAT,
				version,
				exportedAt: value.exportedAt,
				documents,
				sessions,
				trainingResults,
				dailyGoalChanges,
				settings,
			},
		};
	} catch (error) {
		return {
			ok: false,
			failure: "damaged",
			detail:
				error instanceof Damaged ? error.message : "the file could not be read",
		};
	}
}

/** Read the text of a backup file: size first, then JSON, then the format. Never throws. */
export function parseBackup(
	text: string,
	limits: BackupLimits = BACKUP_LIMITS,
): BackupParse {
	// A string is never longer than its UTF-8 bytes, so this can only be too lenient.
	if (text.length > limits.bytes) {
		return {
			ok: false,
			failure: "too-large",
			detail: `the file is over ${limits.bytes} bytes`,
		};
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { ok: false, failure: "not-json", detail: "the file is not JSON" };
	}
	return validateBackup(value, limits);
}
