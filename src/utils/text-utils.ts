/** Word count: Intl.Segmenter when available, else whitespace split. */
export function countWords(text: string): number {
	if (!text.trim()) return 0;

	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
		let total = 0;
		for (const seg of segmenter.segment(text)) {
			if (seg.isWordLike) total++;
		}
		return total;
	}

	return text
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0).length;
}

/** Minutes to read at WPM, ×1.3 for pauses. */
export function estimateReadingMinutes(wordCount: number, wpm: number): string {
	if (wordCount <= 0 || wpm <= 0) return "0";

	const totalSeconds = (wordCount / wpm) * 60 * 1.3;
	const minutes = totalSeconds / 60;

	if (minutes < 1) return "<1 min";
	const m = Math.ceil(minutes);
	return `${m} min`;
}
/** HTML → plain text; block tags → paragraph breaks, br → newline. */
export function htmlToPlainText(html: string): string {
	if (!html) return "";

	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	const body = doc.body;

	let text = "";

	function traverse(node: Node) {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent;
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			const tagName = el.tagName.toUpperCase();

			const isBlock =
				/^(P|DIV|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER)$/.test(
					tagName,
				);

			if (isBlock && text && !text.endsWith("\n\n")) {
				text += text.endsWith("\n") ? "\n" : "\n\n";
			}

			if (tagName === "BR") {
				text += "\n";
			}

			for (const child of Array.from(el.childNodes)) {
				traverse(child);
			}

			if (isBlock && !text.endsWith("\n\n")) {
				text += "\n\n";
			}
		}
	}

	traverse(body);
	return text.trim();
}

/** Strip inline academic citations from text.
 *  Handles numeric brackets [1], [1, 2], [1-5] and
 *  author-year parentheticals (Smith, 2020), (Smith et al., 2020; Jones, 2021). */
export function stripCitations(text: string): string {
	// Numeric bracket citations: [1], [1, 2], [1-5], [1, 3–7]
	const numericBracket = /\[\s*\d[\d,;\s\u2013-]*\]/g;

	// Author-year parenthetical citations:
	// (Smith, 2020), (Smith et al., 2020), (Smith & Jones, 2019; Doe, 2021)
	const authorYear =
		/\(\s*[A-Z][A-Za-z''\u2019.&\s]+(?:et\s+al\.?)?,?\s*\d{4}[a-z]?(?:\s*[;,]\s*[A-Z][A-Za-z''\u2019.&\s]+(?:et\s+al\.?)?,?\s*\d{4}[a-z]?)*\s*\)/g;

	return text
		.replace(numericBracket, "")
		.replace(authorYear, "")
		.replace(/ {2,}/g, " ")
		.trim();
}
