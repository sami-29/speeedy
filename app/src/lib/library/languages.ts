/** The languages a reader can pick for a document. The detected one is always available. */
export const LANGUAGES = [
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
] as const;

/** The language's name in English, or the tag itself when the browser does not know it. */
export function languageName(tag: string): string {
	try {
		return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
	} catch {
		return tag;
	}
}
