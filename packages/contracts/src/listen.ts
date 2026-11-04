/**
 * Languages in Listen: the primary language of a tag, and the fixed list of them that the
 * `listen_start` event may carry. The list is closed so a language can never be a way to send
 * free text: anything off it goes as `other`.
 */

/** Other tags for a language the lists below name once. */
const ALIASES: Readonly<Record<string, string>> = {
	nb: "no",
	nn: "no",
	iw: "he",
};

const PRIMARY = /^[a-z]{2,3}$/;

/**
 * The primary language of a BCP 47 tag, lower case, with the region and script dropped
 * (`en-GB` and `en_GB` are `en`) and a few synonyms joined (`nb` is `no`). Undefined for
 * nothing, `und` and anything that is not a tag.
 */
export function baseLanguage(
	tag: string | null | undefined,
): string | undefined {
	if (typeof tag !== "string") return undefined;
	const primary = tag.toLowerCase().split(/[-_]/, 1)[0] ?? "";
	if (!PRIMARY.test(primary) || primary === "und") return undefined;
	return ALIASES[primary] ?? primary;
}

/** The languages a reader can pick for a document, and `other` for the rest. */
export const LISTEN_LANGUAGES = [
	"en",
	"es",
	"fr",
	"de",
	"it",
	"pt",
	"nl",
	"sv",
	"da",
	"no",
	"fi",
	"pl",
	"cs",
	"sk",
	"sl",
	"hr",
	"sr",
	"ru",
	"uk",
	"bg",
	"tr",
	"el",
	"hu",
	"ro",
	"ar",
	"he",
	"hi",
	"ja",
	"ko",
	"zh",
	"other",
] as const;

export type ListenLanguage = (typeof LISTEN_LANGUAGES)[number];

/** A document's language as the `listen_start` event carries it. */
export function listenLanguage(tag: string | null | undefined): ListenLanguage {
	const base = baseLanguage(tag);
	return (LISTEN_LANGUAGES as readonly string[]).includes(base ?? "")
		? (base as ListenLanguage)
		: "other";
}
