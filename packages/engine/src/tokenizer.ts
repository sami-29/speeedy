/**
 * Turns one block's text into word tokens with their punctuation attached.
 *
 * One pass over the `Intl.Segmenter` stream decides where every punctuation mark goes. The
 * gap between two words is cut into whitespace-separated runs:
 * - a run touching the word before it belongs to that word ("stop.", "well-");
 * - a run touching the word after it belongs to that word ('"stop', "(really)");
 * - a run with spaces on both sides ("—" in "wait — what") trails the word before;
 * - a run touching both words ("?(") is split after the last opening mark.
 */

export type Token = {
	/** The word and its attached punctuation, without whitespace. */
	text: string;
	/** UTF-16 offset of the token's first character in the block text. */
	start: number;
	/** UTF-16 offset just past the token's last character. */
	end: number;
};

export type TokenContext = {
	inQuotes: boolean;
	inParens: boolean;
	inBrackets: boolean;
	closesAside: boolean;
};

const OPENERS = new Set(["(", "[", "{", "“", "„", "«", "‹", "‘", "¿", "¡"]);
const CLOSERS = /[)\]}"'”’»›]$/u;
const TRAILING_PUNCTUATION = /[,.;:!?…。！？؟，；：]+$/u;

type Piece = { text: string; start: number };

type Gap = { trailing: Piece[]; leading: Piece[] };

function makeSegmenter(language: string | undefined): Intl.Segmenter {
	try {
		return new Intl.Segmenter(language ?? "en", { granularity: "word" });
	} catch {
		return new Intl.Segmenter("en", { granularity: "word" });
	}
}

function runsOf(text: string, offset: number): Piece[] {
	return [...text.matchAll(/\S+/gu)].map((match) => ({
		text: match[0],
		start: offset + (match.index ?? 0),
	}));
}

function splitAfterOpeners(run: Piece): Gap {
	const chars = Array.from(run.text);
	let split = chars.length;
	while (split > 0 && OPENERS.has(chars[split - 1] ?? "")) split--;
	const trailing = chars.slice(0, split).join("");
	const leading = chars.slice(split).join("");
	return {
		trailing: trailing ? [{ text: trailing, start: run.start }] : [],
		leading: leading
			? [{ text: leading, start: run.start + trailing.length }]
			: [],
	};
}

/** Decide which punctuation in the text between two words goes to which word. */
function splitGap(text: string, offset: number): Gap {
	const runs = runsOf(text, offset);
	if (runs.length === 0) return { trailing: [], leading: [] };
	const startsWithSpace = /^\s/u.test(text);
	const endsWithSpace = /\s$/u.test(text);
	if (!startsWithSpace && !endsWithSpace && runs.length === 1) {
		return splitAfterOpeners(runs[0] as Piece);
	}
	const trailing: Piece[] = [];
	const leading: Piece[] = [];
	runs.forEach((run, i) => {
		const touchesBefore = i === 0 && !startsWithSpace;
		const touchesAfter = i === runs.length - 1 && !endsWithSpace;
		if (touchesAfter && !touchesBefore) leading.push(run);
		else trailing.push(run);
	});
	return { trailing, leading };
}

export function tokenize(text: string, language?: string): Token[] {
	const words: { start: number; end: number }[] = [];
	for (const segment of makeSegmenter(language).segment(text)) {
		if (segment.isWordLike) {
			words.push({
				start: segment.index,
				end: segment.index + segment.segment.length,
			});
		}
	}
	if (words.length === 0) return [];

	const leads: Piece[][] = words.map(() => []);
	const trails: Piece[][] = words.map(() => []);
	const first = words[0] as { start: number; end: number };
	leads[0] = runsOf(text.slice(0, first.start), 0);
	for (let i = 0; i < words.length - 1; i++) {
		const from = (words[i] as { end: number }).end;
		const to = (words[i + 1] as { start: number }).start;
		const gap = splitGap(text.slice(from, to), from);
		trails[i] = gap.trailing;
		leads[i + 1] = gap.leading;
	}
	const last = words[words.length - 1] as { end: number };
	trails[words.length - 1] = runsOf(text.slice(last.end), last.end);

	return words.map((word, i) => {
		const lead = leads[i] ?? [];
		const trail = trails[i] ?? [];
		const lastTrail = trail[trail.length - 1];
		return {
			text:
				lead.map((piece) => piece.text).join("") +
				text.slice(word.start, word.end) +
				trail.map((piece) => piece.text).join(""),
			start: lead[0]?.start ?? word.start,
			end: lastTrail ? lastTrail.start + lastTrail.text.length : word.end,
		};
	});
}

const isLetter = (char: string | undefined): boolean =>
	char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * Track quotes, parentheses and brackets across the tokens of one block, in a single pass
 * over the tokens. A token is inside one when it is open after the token's first character.
 */
export function contextOf(tokens: readonly Token[]): TokenContext[] {
	let doubleQuote = false;
	let singleQuote = false;
	let parens = 0;
	let brackets = 0;

	return tokens.map((token) => {
		const chars = Array.from(token.text);
		let marked: TokenContext | undefined;
		chars.forEach((char, i) => {
			switch (char) {
				case '"':
				case "“":
				case "«":
				case "»":
					doubleQuote = !doubleQuote;
					break;
				case "„":
					doubleQuote = true;
					break;
				case "”":
					doubleQuote = false;
					break;
				case "'": {
					const before = isLetter(chars[i - 1]);
					const after = isLetter(chars[i + 1]);
					if (before && !after) singleQuote = false;
					else if (!before && after) singleQuote = true;
					break;
				}
				case "‘":
					singleQuote = true;
					break;
				case "’":
					if (singleQuote && !isLetter(chars[i + 1])) singleQuote = false;
					break;
				case "‹":
				case "›":
					singleQuote = !singleQuote;
					break;
				case "(":
					parens++;
					break;
				case ")":
					parens = Math.max(0, parens - 1);
					break;
				case "[":
					brackets++;
					break;
				case "]":
					brackets = Math.max(0, brackets - 1);
					break;
			}
			if (i === 0) {
				marked = {
					inQuotes: doubleQuote || singleQuote,
					inParens: parens > 0,
					inBrackets: brackets > 0,
					closesAside: false,
				};
			}
		});
		const core = token.text.replace(TRAILING_PUNCTUATION, "");
		return {
			inQuotes: marked?.inQuotes ?? false,
			inParens: marked?.inParens ?? false,
			inBrackets: marked?.inBrackets ?? false,
			closesAside: CLOSERS.test(core),
		};
	});
}
