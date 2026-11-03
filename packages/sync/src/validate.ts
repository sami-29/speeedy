import { SyncError } from "./errors.ts";
import type { Push } from "./types.ts";

/**
 * The server's guard on a push: every record in it must be one the merge can interpret,
 * or the whole push is refused. Extra fields are allowed (the Library's records carry their
 * own) and are dropped where the merge copies a record.
 */

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A time or a count: a finite number, 0 or more. */
const isCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

const isIndex = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) >= 0;

const isString = (value: unknown): value is string => typeof value === "string";

const isDocument = (doc: unknown) =>
	isRecord(doc) &&
	isString(doc.id) &&
	isString(doc.contentHash) &&
	isString(doc.language) &&
	isString(doc.title) &&
	isCount(doc.titleChangedAt) &&
	(doc.languageOverride === null || isString(doc.languageOverride)) &&
	isCount(doc.languageOverrideChangedAt) &&
	isRecord(doc.position) &&
	isIndex(doc.position.block) &&
	isIndex(doc.position.offset) &&
	isCount(doc.progress) &&
	doc.progress <= 1 &&
	isCount(doc.positionChangedAt);

const isTombstone = (each: unknown) =>
	isRecord(each) &&
	isString(each.id) &&
	isString(each.contentHash) &&
	isCount(each.deletedAt);

const isSession = (each: unknown) =>
	isRecord(each) &&
	isString(each.id) &&
	(each.documentId === null || isString(each.documentId)) &&
	isString(each.date) &&
	isCount(each.startedAt) &&
	isCount(each.activeMs) &&
	isCount(each.wordsRead) &&
	isCount(each.wpm);

const isSetting = (entry: unknown) =>
	isRecord(entry) && isCount(entry.changedAt);

const isGoalChange = (each: unknown) =>
	isRecord(each) &&
	isString(each.id) &&
	isCount(each.minutes) &&
	isString(each.effectiveDate) &&
	isCount(each.changedAt);

const isTrainingResult = (each: unknown) =>
	isRecord(each) &&
	isString(each.id) &&
	isString(each.kind) &&
	isCount(each.completedAt) &&
	isRecord(each.scores) &&
	Object.values(each.scores).every(
		(score) => typeof score === "number" && Number.isFinite(score),
	);

const every = (list: unknown, check: (each: unknown) => boolean) =>
	Array.isArray(list) && list.every(check);

/** Throws `invalid-argument` unless every record in `push` can be merged. */
export function checkPush(push: unknown): asserts push is Push {
	const valid =
		isRecord(push) &&
		every(push.documents, isDocument) &&
		every(push.uploads, isString) &&
		every(push.tombstones, isTombstone) &&
		every(push.sessions, isSession) &&
		isRecord(push.settings) &&
		Object.values(push.settings).every(isSetting) &&
		every(push.dailyGoalChanges, isGoalChange) &&
		every(push.trainingResults, isTrainingResult);
	if (!valid) {
		throw new SyncError(
			"invalid-argument",
			"The push holds a record that is not one.",
		);
	}
}
