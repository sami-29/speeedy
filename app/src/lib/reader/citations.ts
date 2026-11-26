/** Numbered references in brackets: [1], [1, 2], [1-5], [1, 3–7]. */
const NUMBERED = /\s*\[\s*\d[\d,;\s–-]*\]/g;

/** Author and year in parentheses: (Smith, 2020), (Smith et al., 2020; Jones & Lee, 2021b). */
const AUTHOR_YEAR =
	/\s*\(\s*[A-Z][A-Za-z'’.&\s]+(?:et\s+al\.?)?,?\s*\d{4}[a-z]?(?:\s*[;,]\s*[A-Z][A-Za-z'’.&\s]+(?:et\s+al\.?)?,?\s*\d{4}[a-z]?)*\s*\)/g;

/**
 * The text without inline academic citations, as 1.x's "remove citations" did. The space
 * before a citation goes with it, so "boils [1]." reads "boils.". Line breaks stay.
 */
export function removeCitations(text: string): string {
	return text
		.replace(NUMBERED, "")
		.replace(AUTHOR_YEAR, "")
		.replace(/[ \t]{2,}/g, " ");
}
