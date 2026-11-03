/**
 * Sync's merge rules as pure functions: records in, merged records out. Nothing here
 * touches IndexedDB, the network or a clock, so the app and the Worker run the same rules.
 */

export {
	canonicalJson,
	mergeDocument,
	mergeInsertOnce,
	mergeSession,
	mergeSessions,
	mergeSettings,
	mergeTombstone,
	mergeTombstones,
	pickLatest,
} from "./merge.ts";
export { applyPush, SYNCED_SETTINGS, syncDevice } from "./sync.ts";
export type * from "./types.ts";
