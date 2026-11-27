/**
 * The closed lists and buckets behind the activation and retention events: where a Session
 * came from, which surface it ran on, which launch channel sent the reader, how long the
 * device has known them, and what an import was or why it failed. The events carry these
 * values and nothing else, so none of them can single out a reader.
 */

/** Where the text being read came from. */
export const SESSION_SOURCES = ["own", "demo", "share"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

/** Where Speeedy runs: a browser tab, an installed app, the Android app, or a Share Link opened. */
export const SURFACES = ["web", "pwa", "twa", "share-link"] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * The launch channels a `?ref=` may name: `hn`, the four Reddit subs of the launch plan, `ph`,
 * `alternativeto`, the four stores, `github`, `newsletter`, `changelog` and `readme`. A value
 * off this list is sent as `other`.
 */
const ALLOWED_REFS = [
	"hn",
	"reddit-speedreading",
	"reddit-opensource",
	"reddit-sideproject",
	"reddit-studytips",
	"ph",
	"alternativeto",
	"chrome-store",
	"edge-store",
	"amo",
	"play",
	"github",
	"newsletter",
	"changelog",
	"readme",
] as const;

export const REFS = [...ALLOWED_REFS, "other"] as const;
export type Ref = (typeof REFS)[number];

/**
 * The allowlisted `ref` for a raw `?ref=` value: the value itself when it is on the list,
 * `other` for anything else, and nothing when there was no `ref`. The raw value is never kept.
 */
export function refFor(raw: string | null | undefined): Ref | undefined {
	if (raw === null || raw === undefined) return undefined;
	return (ALLOWED_REFS as readonly string[]).includes(raw)
		? (raw as Ref)
		: "other";
}

export const DAYS_SINCE_FIRST_BUCKETS = [
	"0",
	"1-6",
	"7-29",
	"30-89",
	"90-plus",
] as const;
export type DaysSinceFirstBucket = (typeof DAYS_SINCE_FIRST_BUCKETS)[number];

export const LIFETIME_SESSIONS_BUCKETS = [
	"1",
	"2-5",
	"6-20",
	"21-plus",
] as const;
export type LifetimeSessionsBucket = (typeof LIFETIME_SESSIONS_BUCKETS)[number];

/** The bucket for the whole days since the reader's first Session. */
export function daysSinceFirstBucket(days: number): DaysSinceFirstBucket {
	if (!(days >= 1)) return "0";
	if (days < 7) return "1-6";
	if (days < 30) return "7-29";
	if (days < 90) return "30-89";
	return "90-plus";
}

/** The bucket for the reader's lifetime Sessions, counting the one that is starting. */
export function lifetimeSessionsBucket(count: number): LifetimeSessionsBucket {
	if (!(count >= 2)) return "1";
	if (count < 6) return "2-5";
	if (count < 21) return "6-20";
	return "21-plus";
}

/** The format of a file the reader opened. `other` is a format this list does not name. */
export const FILE_FORMATS = [
	"txt",
	"markdown",
	"csv",
	"html",
	"docx",
	"epub",
	"odt",
	"rtf",
	"doc",
	"pdf",
	"other",
] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

/** Why a file could not be read. The parsers' reasons, one to one. */
export const PARSE_FAILURE_REASONS = [
	"drm",
	"scanned-pdf",
	"unsupported",
	"empty",
	"encoding-suspect",
	"too-big",
] as const;
export type ParseFailureReason = (typeof PARSE_FAILURE_REASONS)[number];
