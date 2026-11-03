/**
 * Lines to paragraphs: where one paragraph ends and the next begins, and how the lines of a
 * paragraph are joined, including words that a line break cut in two.
 *
 * Evidence that a paragraph ends, within a column: extra vertical space, a first-line indent
 * after a short or finished line, a short line that finishes a sentence, a bullet or number,
 * a change of type size. Where the text jumps to another column or page there is no spacing
 * to see, so a paragraph carries on unless the last line is short, or it finished a sentence
 * and the next line starts a new one (with an indent, when the document indents paragraphs).
 *
 * A line that ends in a hyphen is joined to the next without the hyphen only when the next
 * line starts in lower case and the word is not a compound that the document, or the stem
 * itself, says is hyphenated. "exam-" and "ple" become "example"; "well-" and "known",
 * "Jean-" and "Paul", "1990-" and "2000" keep their hyphens.
 */
import type { BodyStats } from "./furniture";
import type { Line, PageLines } from "./layout";

const SHORT = 0.75;
const HYPHENS = "-\u2010\u2011\u00ad";
const ENDS_WITH_HYPHEN = new RegExp(`[${HYPHENS}]$`);
const SENTENCE_END =
	/[.!?\u2026\u3002\uff01\uff1f:;]["'\u201d\u2019\u00bb)\]]*$/u;
const GLYPH_BULLET =
	/^[\u2022\u25e6\u25aa\u25ab\u2023\u25cf\u25cb\u25a0\u25a1\u25b6\u25ba\u00b7\u2219]\s/u;
const LIST_MARKER =
	/^(?:[-\u2013\u2014*]\s|\(?\d{1,3}[.)]\s|\[\d{1,3}\]\s|\(?[a-z][.)]\s)/;
const CONJUNCTIONS = new Set([
	"and",
	"or",
	"to",
	"und",
	"oder",
	"et",
	"ou",
	"y",
	"ve",
]);

/**
 * Stems that are nearly always hyphenated in English ("well-known", "self-paced"). A
 * heuristic: it only matters when the document does not spell the compound out elsewhere.
 */
const COMPOUND_STEMS = new Set([
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"self",
	"well",
	"ill",
	"ex",
	"all",
	"half",
	"quasi",
	"long",
	"short",
	"high",
	"low",
	"full",
	"vice",
	"ever",
	"so",
	"state",
	"non",
	"mid",
	"cross",
	"part",
	"semi",
	"multi",
	"open",
	"real",
	"large",
	"small",
	"first",
	"second",
	"third",
]);

type Placed = {
	line: Line;
	/** Index of the page the line came from. */
	page: number;
	left: number;
	right: number;
};

const isLetter = (char: string) => /^\p{L}$/u.test(char);
const isLower = (char: string) => /^\p{Ll}$/u.test(char);
const isUpper = (char: string) => /^\p{Lu}$/u.test(char);
const firstChar = (text: string) => {
	const code = text.codePointAt(0);
	return code === undefined ? "" : String.fromCodePoint(code);
};
const lastChar = (text: string) => {
	const code = text.charCodeAt(text.length - 1);
	if (code >= 0xdc00 && code <= 0xdfff && text.length > 1)
		return text.slice(-2);
	return text.slice(-1);
};
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const ALNUM = /[\p{L}\p{N}]/u;

/**
 * Cut anything that is not a letter or digit from both ends. Done with two scans because a
 * regex that trims the end backtracks quadratically on a long run of punctuation.
 */
const strip = (word: string): string => {
	let start = 0;
	let end = word.length;
	while (start < end) {
		const char = String.fromCodePoint(word.codePointAt(start) ?? 0);
		if (ALNUM.test(char)) break;
		start += char.length;
	}
	while (end > start) {
		const code = word.charCodeAt(end - 1);
		const char =
			code >= 0xdc00 && code <= 0xdfff && end - 2 >= start
				? word.slice(end - 2, end)
				: word.slice(end - 1, end);
		if (ALNUM.test(char)) break;
		end -= char.length;
	}
	return word.slice(start, end);
};

function percentile(values: number[], fraction: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
		0
	);
}

/** Left and right margins of each group of a page, ignoring short and odd lines. */
function measures(page: PageLines): Map<number, [number, number]> {
	const byGroup = new Map<number, Line[]>();
	for (const line of page.lines) {
		const list = byGroup.get(line.group);
		if (list) list.push(line);
		else byGroup.set(line.group, [line]);
	}
	const out = new Map<number, [number, number]>();
	for (const [group, lines] of byGroup) {
		const body = lines.filter((l) => l.text.length >= 15);
		const use = body.length >= 2 ? body : lines;
		out.set(group, [
			percentile(
				use.map((l) => l.x0),
				0.1,
			),
			percentile(
				use.map((l) => l.x1),
				0.9,
			),
		]);
	}
	return out;
}

const isShort = (p: Placed): boolean => {
	const width = p.right - p.left;
	return width > 20 && p.line.x1 - p.left < SHORT * width;
};

const endsSentence = (text: string) => SENTENCE_END.test(text);
const startsLower = (text: string) => isLower(firstChar(text));
const startsUpper = (text: string) => isUpper(firstChar(text));

function isBullet(text: string, previous: Placed): boolean {
	if (GLYPH_BULLET.test(text)) return true;
	return (
		LIST_MARKER.test(text) &&
		(endsSentence(previous.line.text) || isShort(previous))
	);
}

const sizeChanged = (a: Line, b: Line) =>
	Math.abs(a.size - b.size) >= 0.12 * a.size;
const fontChanged = (a: Line, b: Line) =>
	a.font !== b.font && a.font !== "" && b.font !== "";

function breaksWithinColumn(
	prev: Placed,
	cur: Placed,
	stats: BodyStats,
): boolean {
	const a = prev.line;
	const b = cur.line;
	const gap = a.y - b.y;
	// Line spacing grows and shrinks with the type, so a wrapped heading is not split.
	const pitch = stats.pitch * (b.size / stats.size);
	if (gap > pitch + 0.45 * b.size) return true;
	if (sizeChanged(a, b)) return true;
	if (isBullet(b.text, prev)) return true;
	if (ENDS_WITH_HYPHEN.test(a.text)) return false;
	const short = isShort(prev);
	if (fontChanged(a, b) && (short || isShort(cur))) return true;
	if (short && endsSentence(a.text)) return true;
	if (
		short &&
		startsUpper(b.text) &&
		a.x1 - prev.left < 0.5 * (prev.right - prev.left)
	) {
		return true;
	}
	const jump = b.x0 - a.x0;
	return (
		jump > 0.6 * b.size &&
		b.x0 - cur.left < 6 * b.size &&
		(endsSentence(a.text) || short)
	);
}

function breaksAcross(
	prev: Placed,
	cur: Placed,
	stats: BodyStats,
	indentStyle: boolean,
): boolean {
	const a = prev.line;
	const b = cur.line;
	if (a.spanning !== b.spanning) {
		// The short last line of a paragraph that spans the columns sits in the left column
		// and so reads as a column line. It still follows on from the line above it.
		const tail =
			a.spanning &&
			prev.page === cur.page &&
			a.y - b.y <= stats.pitch + 0.45 * b.size &&
			Math.abs(b.x0 - a.x0) < 0.6 * b.size;
		if (!tail) return true;
	}
	if (sizeChanged(a, b)) return true;
	if (GLYPH_BULLET.test(b.text)) return true;
	if (fontChanged(a, b) && (isShort(prev) || isShort(cur))) return true;
	if (ENDS_WITH_HYPHEN.test(a.text)) return false;
	if (isShort(prev)) return true;
	if (endsSentence(a.text)) {
		if (startsLower(b.text)) return false;
		return indentStyle ? b.x0 - cur.left > 0.6 * b.size : true;
	}
	return false;
}

type Evidence = { hyphenated: Set<string>; closed: Set<string> };

/** The last word of `text` without the hyphens that end it. */
const stemOf = (text: string): string => {
	let end = text.length;
	while (end > 0 && HYPHENS.includes(text.charAt(end - 1))) end--;
	let start = end;
	while (start > 0 && !/\s/.test(text.charAt(start - 1))) start--;
	return text.slice(start, end);
};

const headOf = (text: string): string => {
	const match = /^[\p{L}\p{M}]+/u.exec(
		(text.split(/\s+/)[0] ?? "").replace(/^[^\p{L}\p{N}]+/u, ""),
	);
	return match ? match[0] : "";
};

/** Which hyphenated spellings and which closed spellings the document itself uses. */
function gatherEvidence(placed: Placed[]): Evidence {
	const wantHyphen = new Set<string>();
	const wantClosed = new Set<string>();
	for (let i = 0; i + 1 < placed.length; i++) {
		const text = (placed[i] as Placed).line.text;
		if (!ENDS_WITH_HYPHEN.test(text)) continue;
		const stem = strip(stemOf(text)).toLowerCase();
		const head = headOf((placed[i + 1] as Placed).line.text).toLowerCase();
		if (stem === "" || head === "" || stem.includes("-")) continue;
		wantHyphen.add(`${stem}-${head}`);
		wantClosed.add(`${stem}${head}`);
	}
	const evidence: Evidence = { hyphenated: new Set(), closed: new Set() };
	if (wantHyphen.size === 0) return evidence;
	for (const { line } of placed) {
		for (const raw of line.text.split(/\s+/)) {
			const word = strip(raw).toLowerCase();
			if (word === "") continue;
			if (wantHyphen.has(word)) evidence.hyphenated.add(word);
			else if (wantClosed.has(word)) evidence.closed.add(word);
		}
	}
	return evidence;
}

type Join = { drop: number; separator: string };

/** How to attach `next` to text that ends in a hyphen. */
function joinAfterHyphen(text: string, next: string, evidence: Evidence): Join {
	const hyphen = lastChar(text);
	const before = lastChar(text.slice(0, text.length - hyphen.length));
	const after = firstChar(next);
	if (hyphen === "\u00ad") {
		return isLetter(after)
			? { drop: hyphen.length, separator: "" }
			: { drop: hyphen.length, separator: " " };
	}
	if (before === "" || /\s/.test(before)) return { drop: 0, separator: " " };
	if (!isLetter(before)) return { drop: 0, separator: "" };
	if (!isLower(after))
		return {
			drop: 0,
			separator: isLetter(after) || /\d/.test(after) ? "" : " ",
		};
	const stem = strip(stemOf(text)).toLowerCase();
	const head = headOf(next).toLowerCase();
	if (CONJUNCTIONS.has(head) && next.startsWith(head))
		return { drop: 0, separator: " " };
	// "state-of-the-" and "art": the word already has a hyphen, so this one is real too.
	if (stemOf(text).includes("-")) return { drop: 0, separator: "" };
	if (evidence.hyphenated.has(`${stem}-${head}`))
		return { drop: 0, separator: "" };
	if (evidence.closed.has(`${stem}${head}`))
		return { drop: hyphen.length, separator: "" };
	// A single letter before the hyphen is a label ("e-mail", "x-ray", "T-shirt"), and a
	// number word makes a compound ("two-word", "three-dimensional").
	if (stem.length === 1 || COMPOUND_STEMS.has(stem)) {
		return { drop: 0, separator: "" };
	}
	return { drop: hyphen.length, separator: "" };
}

function joinSeparator(text: string, next: string): string {
	if (CJK.test(lastChar(text)) && CJK.test(firstChar(next))) return "";
	// An en or em dash tight against a word ends a clause: it joins the next line without a gap.
	if (/\S[\u2013\u2014]$/.test(text.slice(-2))) return "";
	return " ";
}

/** True when the document starts its paragraphs with an indent. */
function usesIndent(placed: Placed[], stats: BodyStats): boolean {
	let indented = 0;
	let total = 0;
	for (let i = 1; i < placed.length; i++) {
		const prev = placed[i - 1] as Placed;
		const cur = placed[i] as Placed;
		if (prev.line.group !== cur.line.group || prev.page !== cur.page) continue;
		if (!breaksWithinColumn(prev, cur, stats)) continue;
		total++;
		if (cur.line.x0 - cur.left > 0.6 * cur.line.size) indented++;
	}
	return total >= 3 && indented >= 0.5 * total;
}

/** Turn the lines of every page, in reading order, into paragraph strings. */
export function buildParagraphs(
	pages: PageLines[],
	stats: BodyStats,
): string[] {
	const placed: Placed[] = [];
	pages.forEach((page, index) => {
		const margins = measures(page);
		for (const line of page.lines) {
			const [left, right] = margins.get(line.group) ?? [line.x0, line.x1];
			placed.push({ line, page: index, left, right });
		}
	});
	if (placed.length === 0) return [];

	const evidence = gatherEvidence(placed);
	const indentStyle = usesIndent(placed, stats);
	const paragraphs: string[] = [];
	let parts: string[] = [];

	const flush = () => {
		if (parts.length > 0)
			paragraphs.push(parts.join("").replace(/\s+/g, " ").trim());
		parts = [];
	};

	for (let i = 0; i < placed.length; i++) {
		const cur = placed[i] as Placed;
		const prev = placed[i - 1];
		const text = cur.line.text;
		if (!prev) {
			parts.push(text);
			continue;
		}
		const sameColumn =
			prev.line.group === cur.line.group && prev.page === cur.page;
		const split = sameColumn
			? breaksWithinColumn(prev, cur, stats)
			: breaksAcross(prev, cur, stats, indentStyle);
		if (split) {
			flush();
			parts.push(text);
			continue;
		}
		const last = parts[parts.length - 1] ?? "";
		if (ENDS_WITH_HYPHEN.test(last)) {
			const join = joinAfterHyphen(last, text, evidence);
			if (join.drop > 0)
				parts[parts.length - 1] = last.slice(0, last.length - join.drop);
			if (join.separator !== "") parts.push(join.separator);
		} else {
			const separator = joinSeparator(last, text);
			if (separator !== "") parts.push(separator);
		}
		parts.push(text);
	}
	flush();
	return paragraphs.filter((p) => p !== "");
}
