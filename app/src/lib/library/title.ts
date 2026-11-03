import { blockText, type Document } from "@speeedy/contracts";

const LIMIT = 60;

/** The name a document gets when it has no title and no text. */
export const UNTITLED = "Untitled";

/**
 * The title for a new Library entry: the one the parser found, else the opening words of the
 * text cut at a word, else a plain name.
 */
export function documentTitle(
	parsed: string | null,
	document: Document,
): string {
	const found = parsed?.trim();
	if (found) return found;
	for (const block of document.blocks) {
		const text = blockText(block).replace(/\s+/g, " ").trim();
		if (text === "") continue;
		if (text.length <= LIMIT) return text;
		const cut = text.slice(0, LIMIT);
		const space = cut.lastIndexOf(" ");
		const words = space > LIMIT / 3 ? cut.slice(0, space) : cut;
		return `${words.replace(/[\s,;:.\-–—]+$/, "")}…`;
	}
	return UNTITLED;
}
