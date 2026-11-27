/**
 * The closed lists and buckets behind the activation and retention events: where a Session
 * came from, which surface it ran on, which launch channel sent the reader, how long the
 * device has known them, and what an import was or why it failed. The events carry these
 * values and nothing else, so none of them can single out a reader.
 */

const NOT_IMPLEMENTED = "not implemented";

export const SESSION_SOURCES: readonly string[] = [];
export const SURFACES: readonly string[] = [];
export const REFS: readonly string[] = [];
export const DAYS_SINCE_FIRST_BUCKETS: readonly string[] = [];
export const LIFETIME_SESSIONS_BUCKETS: readonly string[] = [];
export const FILE_FORMATS: readonly string[] = [];
export const PARSE_FAILURE_REASONS: readonly string[] = [];

/** The allowlisted `ref` for a raw `?ref=` value: `other` for anything off the list, nothing without one. */
export function refFor(_raw: string | null | undefined): string | undefined {
	throw new Error(NOT_IMPLEMENTED);
}

/** The bucket for the whole days since the reader's first Session. */
export function daysSinceFirstBucket(_days: number): string {
	throw new Error(NOT_IMPLEMENTED);
}

/** The bucket for the reader's lifetime Sessions, counting the one that is starting. */
export function lifetimeSessionsBucket(_count: number): string {
	throw new Error(NOT_IMPLEMENTED);
}
