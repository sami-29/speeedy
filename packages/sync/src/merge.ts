import { SyncError } from "./errors.ts";
import type {
	SettingEntry,
	Stamped,
	SyncDocument,
	SyncSession,
	SyncTombstone,
} from "./types.ts";

/**
 * JSON with object keys sorted at every depth, so two equal values always give the same
 * string. Undefined fields are left out, as `JSON.stringify` does. The sorted copy has no
 * prototype, so a "__proto__" key is kept as a key like any other.
 */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) => {
		if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
			return inner;
		}
		const sorted: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(inner).sort()) {
			sorted[key] = (inner as Record<string, unknown>)[key];
		}
		return sorted;
	});
}

/** The larger value by canonical JSON: the tie-break every device applies the same way. */
const larger = <T>(a: T, b: T): T =>
	canonicalJson(b) > canonicalJson(a) ? b : a;

/**
 * A time or amount as the merge orders it. NaN compares false with everything, which would
 * make the winner depend on argument order, so it counts as the earliest of all.
 */
const ordered = (time: number) => (Number.isNaN(time) ? -Infinity : time);

/** The record with the larger `key`; equal keys keep the larger record. Order-independent. */
function laterBy<T>(a: T, b: T, key: (record: T) => number): T {
	const x = ordered(key(a));
	const y = ordered(key(b));
	if (x !== y) return x > y ? a : b;
	return larger(a, b);
}

/** Last write wins. Equal times keep the larger value, so the order of merging never matters. */
export function pickLatest<T>(a: Stamped<T>, b: Stamped<T>): Stamped<T> {
	return laterBy(a, b, (each) => each.at);
}

/**
 * Two copies of one document. Each field group keeps whichever side changed it last: the
 * title, the language override, and the Position with its progress. Two different
 * documents (another ID or another text) are refused, never blended.
 */
export function mergeDocument(a: SyncDocument, b: SyncDocument): SyncDocument {
	if (a.id !== b.id || a.contentHash !== b.contentHash) {
		throw new SyncError(
			"invalid-argument",
			"Only two copies of one document merge.",
		);
	}
	const title = pickLatest(
		{ value: a.title, at: a.titleChangedAt },
		{ value: b.title, at: b.titleChangedAt },
	);
	const override = pickLatest(
		{ value: a.languageOverride, at: a.languageOverrideChangedAt },
		{ value: b.languageOverride, at: b.languageOverrideChangedAt },
	);
	const read = pickLatest(
		{
			value: { position: a.position, progress: a.progress },
			at: a.positionChangedAt,
		},
		{
			value: { position: b.position, progress: b.progress },
			at: b.positionChangedAt,
		},
	);
	return {
		id: a.id,
		contentHash: a.contentHash,
		// The same text parses to the same language; the larger keeps the merge symmetric.
		language: larger(a.language, b.language),
		title: title.value,
		titleChangedAt: title.at,
		languageOverride: override.value,
		languageOverrideChangedAt: override.at,
		position: read.value.position,
		progress: read.value.progress,
		positionChangedAt: read.at,
	};
}

/** A Session only grows: the copy with more active time wins. */
export function mergeSession(a: SyncSession, b: SyncSession): SyncSession {
	return laterBy(a, b, (each) => each.activeMs);
}

const byId = <T extends { id: string }>(records: Iterable<T>): T[] =>
	[...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function unionBy<T extends { id: string }>(
	a: readonly T[],
	b: readonly T[],
	merge: (kept: T, incoming: T) => T,
): T[] {
	const merged = new Map<string, T>();
	for (const record of [...a, ...b]) {
		const held = merged.get(record.id);
		merged.set(record.id, held === undefined ? record : merge(held, record));
	}
	return byId(merged.values());
}

/** Every Session from both sides, by ID, sorted by ID. */
export function mergeSessions(
	a: readonly SyncSession[],
	b: readonly SyncSession[],
): SyncSession[] {
	return unionBy(a, b, mergeSession);
}

/** The latest delete of one document. */
export function mergeTombstone(
	a: SyncTombstone,
	b: SyncTombstone,
): SyncTombstone {
	return laterBy(a, b, (each) => each.deletedAt);
}

export function mergeTombstones(
	a: readonly SyncTombstone[],
	b: readonly SyncTombstone[],
): SyncTombstone[] {
	return unionBy(a, b, mergeTombstone);
}

/**
 * Records written once and never changed, such as Training results and Daily Goal changes:
 * a record already kept is never replaced. Sorted by ID.
 */
export function mergeInsertOnce<T extends { id: string }>(
	kept: readonly T[],
	incoming: readonly T[],
): T[] {
	return unionBy(kept, incoming, (held) => held);
}

/** Settings merge one key at a time, each by its own change time. */
export function mergeSettings(
	a: Record<string, SettingEntry>,
	b: Record<string, SettingEntry>,
): Record<string, SettingEntry> {
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
	// Object.fromEntries defines every key as data, "__proto__" included.
	return Object.fromEntries(
		keys.map((key) => {
			const mine = Object.hasOwn(a, key) ? a[key] : undefined;
			const theirs = Object.hasOwn(b, key) ? b[key] : undefined;
			if (mine === undefined) return [key, theirs as SettingEntry];
			if (theirs === undefined) return [key, mine];
			return [key, pickEntry(mine, theirs)];
		}),
	);
}

const pickEntry = (a: SettingEntry, b: SettingEntry): SettingEntry =>
	pickLatest({ value: a, at: a.changedAt }, { value: b, at: b.changedAt })
		.value;
