import type {
	SettingEntry,
	Stamped,
	SyncDocument,
	SyncSession,
	SyncTombstone,
} from "./types.ts";

const missing = (): never => {
	throw new Error("not implemented");
};

export function canonicalJson(_value: unknown): string {
	return missing();
}

export function pickLatest<T>(_a: Stamped<T>, _b: Stamped<T>): Stamped<T> {
	return missing();
}

export function mergeDocument(
	_a: SyncDocument,
	_b: SyncDocument,
): SyncDocument {
	return missing();
}

export function mergeSession(_a: SyncSession, _b: SyncSession): SyncSession {
	return missing();
}

export function mergeSessions(
	_a: readonly SyncSession[],
	_b: readonly SyncSession[],
): SyncSession[] {
	return missing();
}

export function mergeTombstone(
	_a: SyncTombstone,
	_b: SyncTombstone,
): SyncTombstone {
	return missing();
}

export function mergeTombstones(
	_a: readonly SyncTombstone[],
	_b: readonly SyncTombstone[],
): SyncTombstone[] {
	return missing();
}

export function mergeInsertOnce<T extends { id: string }>(
	_kept: readonly T[],
	_incoming: readonly T[],
): T[] {
	return missing();
}

export function mergeSettings(
	_a: Record<string, SettingEntry>,
	_b: Record<string, SettingEntry>,
): Record<string, SettingEntry> {
	return missing();
}
