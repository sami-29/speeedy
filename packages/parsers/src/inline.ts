import type { Span } from "@speeedy/contracts";
import { clip } from "./clean";

/**
 * Markdown inline parsing: emphasis, strong, links, images, code spans, autolinks, escapes,
 * entities and raw HTML. It is one left-to-right pass with bounded look-ahead and one stack
 * per delimiter character, so cost stays linear however hostile the input is.
 */

export type RefMap = ReadonlyMap<string, string>;

export type InlineResult = {
	text: string;
	spans: Span[];
	/** The alt text when the whole input is exactly one image, else null. */
	soleImageAlt: string | null;
};

const MAX_DEST = 2048;
const MAX_TITLE = 600;
const MAX_REF_LABEL = 200;
const MAX_TAG = 2000;
const MAX_ALT = 1000;
/** Bounds the memory one paragraph can use for markup nodes. */
const MAX_INLINE_NODES = 200_000;

const BACKSLASH = 92;
const BACKTICK = 96;
const LT = 60;
const AMP = 38;
const BANG = 33;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const STAR = 42;
const UNDERSCORE = 95;

const SPECIAL = new Uint8Array(128);
for (const code of [
	BACKSLASH,
	BACKTICK,
	LT,
	AMP,
	BANG,
	OPEN_BRACKET,
	CLOSE_BRACKET,
	STAR,
	UNDERSCORE,
]) {
	SPECIAL[code] = 1;
}

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	copy: "©",
	reg: "®",
	trade: "™",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	euro: "€",
	pound: "£",
	yen: "¥",
	cent: "¢",
	sect: "§",
	para: "¶",
	deg: "°",
	plusmn: "±",
	times: "×",
	divide: "÷",
	middot: "·",
	bull: "•",
	larr: "←",
	rarr: "→",
};

/** Tags that separate words when removed, so `a<br>b` does not become `ab`. */
const SPACING_TAGS = new Set([
	"br",
	"p",
	"div",
	"hr",
	"li",
	"ul",
	"ol",
	"tr",
	"td",
	"th",
	"table",
	"blockquote",
	"pre",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
]);

const isAsciiPunct = (code: number): boolean =>
	(code >= 33 && code <= 47) ||
	(code >= 58 && code <= 64) ||
	(code >= 91 && code <= 96) ||
	(code >= 123 && code <= 126);

const isWhitespaceChar = (char: string): boolean => /\s/u.test(char);
const isPunctChar = (char: string): boolean => /[\p{P}\p{S}]/u.test(char);

/** Decode the entity starting at `src[at]` (`&`). Returns null when it is not a known one. */
function decodeEntity(
	src: string,
	at: number,
	allowControls: boolean,
): { text: string; end: number } | null {
	const limit = Math.min(src.length, at + 34);
	let semicolon = -1;
	for (let k = at + 1; k < limit; k++) {
		const code = src.charCodeAt(k);
		if (code === 59) {
			semicolon = k;
			break;
		}
		const alnum =
			(code >= 48 && code <= 57) ||
			(code >= 65 && code <= 90) ||
			(code >= 97 && code <= 122) ||
			code === 35;
		if (!alnum) return null;
	}
	if (semicolon === -1) return null;
	const body = src.slice(at + 1, semicolon);
	if (body.charCodeAt(0) === 35) {
		const hex = /^#[xX]([0-9a-fA-F]{1,6})$/.exec(body);
		const dec = /^#([0-9]{1,7})$/.exec(body);
		const code = hex?.[1]
			? Number.parseInt(hex[1], 16)
			: dec?.[1]
				? Number.parseInt(dec[1], 10)
				: -1;
		if (code < 1 || code > 0x10ffff) return null;
		if (code >= 0xd800 && code <= 0xdfff) return null;
		const control = code < 32 || (code >= 127 && code <= 159);
		if (control && !allowControls) return null;
		return { text: String.fromCodePoint(code), end: semicolon + 1 };
	}
	const named = NAMED_ENTITIES[body];
	return named === undefined ? null : { text: named, end: semicolon + 1 };
}

/** Backslash escapes and entities, for link destinations. */
function decodeDestination(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		if (code === BACKSLASH && isAsciiPunct(raw.charCodeAt(i + 1))) {
			out += raw[i + 1];
			i++;
		} else if (code === AMP) {
			const entity = decodeEntity(raw, i, true);
			if (entity) {
				out += entity.text;
				i = entity.end - 1;
			} else {
				out += "&";
			}
		} else {
			out += raw[i];
		}
	}
	return out;
}

/**
 * The link target to keep, or null to keep only the label. Only http, https, mailto, tel
 * and scheme-less (relative or fragment) targets survive, however the scheme is spelled.
 */
export function safeHref(raw: string): string | null {
	let cleaned = "";
	for (const char of decodeDestination(raw)) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 32 || (code >= 127 && code <= 159)) continue;
		if (code === 0x200b || code === 0xfeff || code === 0x2060) continue;
		cleaned += char;
	}
	if (cleaned === "") return null;
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned.slice(0, 40));
	if (scheme?.[1] && !ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) return null;
	return clip(cleaned, MAX_DEST);
}

const normalizeKey = (label: string): string =>
	label.toLowerCase().replace(/\s+/g, " ").trim();

/** The lookup key for a reference label: case-folded, whitespace collapsed. */
export function referenceKey(label: string): string {
	return normalizeKey(label);
}

type TextNode = { type: "text"; text: string; image?: boolean };
type DelimNode = {
	type: "delim";
	char: number;
	count: number;
	remaining: number;
	/** Characters consumed as a closer (taken from the start of the run). */
	left: number;
	/** Characters consumed as an opener (taken from the end of the run). */
	right: number;
	canOpen: boolean;
	canClose: boolean;
	id: number;
	index: number;
	openPos: number;
};
type Node = TextNode | DelimNode;
type Match = { open: DelimNode; close: DelimNode; kind: "emphasis" | "strong" };
type LinkRecord = { from: number; to: number; href: string };
type Bracket = {
	node: number;
	image: boolean;
	delimFloor: number;
	matchesLength: number;
	linksLength: number;
	labelStart: number;
};

function plainAlt(label: string): string {
	let out = "";
	for (let i = 0; i < label.length && out.length < MAX_ALT; i++) {
		const code = label.charCodeAt(i);
		if (code === BACKSLASH && isAsciiPunct(label.charCodeAt(i + 1))) {
			out += label[i + 1];
			i++;
		} else if (code === STAR || code === BACKTICK) {
			// emphasis and code marks are not part of the alt text
		} else if (code === OPEN_BRACKET || code === CLOSE_BRACKET) {
			// nor are nested brackets
		} else {
			out += label[i];
		}
	}
	return clip(out.replace(/\s+/g, " ").trim(), MAX_ALT);
}

type Destination = { href: string; end: number };

/** Parse `(dest "title")` starting at the `(` at `at`. */
function parseInlineDestination(src: string, at: number): Destination | null {
	const n = src.length;
	let p = at + 1;
	while (p < n && (src[p] === " " || src[p] === "\t")) p++;
	let dest: string;
	if (src[p] === "<") {
		let q = p + 1;
		while (q < n && q - p <= MAX_DEST && src[q] !== ">" && src[q] !== "<") q++;
		if (src[q] !== ">") return null;
		dest = src.slice(p + 1, q);
		p = q + 1;
	} else {
		const start = p;
		let depth = 0;
		while (p < n && p - start <= MAX_DEST) {
			const char = src[p] as string;
			if (char <= " " || char === "[" || char === "]") break;
			if (char === "\\" && p + 1 < n) {
				p += 2;
				continue;
			}
			if (char === "(") depth++;
			else if (char === ")") {
				if (depth === 0) break;
				depth--;
			}
			p++;
		}
		if (p - start > MAX_DEST || depth !== 0) return null;
		dest = src.slice(start, p);
	}
	while (p < n && (src[p] === " " || src[p] === "\t")) p++;
	const open = src[p];
	if (open === '"' || open === "'" || open === "(") {
		const close = open === "(" ? ")" : open;
		let q = p + 1;
		while (q < n && q - p <= MAX_TITLE && src[q] !== close) q++;
		if (src[q] !== close) return null;
		p = q + 1;
		while (p < n && (src[p] === " " || src[p] === "\t")) p++;
	}
	if (src[p] !== ")") return null;
	return { href: dest, end: p + 1 };
}

const AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>.]{1,255}(?:\.[^\s@<>.]{1,255}){1,8}$/;

export function parseInline(src: string, refs: RefMap): InlineResult {
	const nodes: Node[] = [];
	const matches: Match[] = [];
	const links: LinkRecord[] = [];
	const brackets: Bracket[] = [];
	const starStack: DelimNode[] = [];
	const underStack: DelimNode[] = [];
	let deactivatedBelow = 0;
	let delimId = 0;
	let buffer = "";
	let backtickRuns: Map<number, number[]> | null = null;
	let nextGt = -2;
	let noCommentEnd = false;
	const n = src.length;

	const flush = () => {
		if (buffer !== "") {
			nodes.push({ type: "text", text: buffer });
			buffer = "";
		}
	};

	const buildBacktickRuns = (): Map<number, number[]> => {
		const runs = new Map<number, number[]>();
		for (let i = 0; i < n; i++) {
			if (src.charCodeAt(i) !== BACKTICK) continue;
			let j = i;
			while (j < n && src.charCodeAt(j) === BACKTICK) j++;
			const length = j - i;
			const list = runs.get(length);
			if (list) list.push(i);
			else runs.set(length, [i]);
			i = j - 1;
		}
		return runs;
	};

	const findBacktickCloser = (length: number, after: number): number => {
		backtickRuns ??= buildBacktickRuns();
		const list = backtickRuns.get(length);
		if (!list) return -1;
		let lo = 0;
		let hi = list.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((list[mid] as number) < after) lo = mid + 1;
			else hi = mid;
		}
		return lo < list.length ? (list[lo] as number) : -1;
	};

	const floorId = (): number => {
		const top = brackets[brackets.length - 1];
		return top ? top.delimFloor : 0;
	};

	const dropDelimiters = (fromId: number) => {
		while (
			starStack.length > 0 &&
			(starStack[starStack.length - 1] as DelimNode).id >= fromId
		) {
			starStack.pop();
		}
		while (
			underStack.length > 0 &&
			(underStack[underStack.length - 1] as DelimNode).id >= fromId
		) {
			underStack.pop();
		}
	};

	const closeEmphasis = (closer: DelimNode) => {
		const own = closer.char === STAR ? starStack : underStack;
		const other = closer.char === STAR ? underStack : starStack;
		while (closer.remaining > 0 && closer.canClose) {
			const opener = own[own.length - 1];
			if (!opener || opener.id < floorId()) break;
			const use = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
			matches.push({
				open: opener,
				close: closer,
				kind: use === 2 ? "strong" : "emphasis",
			});
			opener.remaining -= use;
			opener.right += use;
			closer.remaining -= use;
			closer.left += use;
			while (
				other.length > 0 &&
				(other[other.length - 1] as DelimNode).id > opener.id
			) {
				other.pop();
			}
			if (opener.remaining === 0) own.pop();
		}
	};

	const resolveBracket = (at: number): number => {
		// `at` is the index of `]`. Returns the index to continue from.
		const bracket = brackets.pop() as Bracket;
		const active = bracket.image || brackets.length >= deactivatedBelow;
		deactivatedBelow = Math.min(deactivatedBelow, brackets.length);
		let href: string | null = null;
		let end = at + 1;
		if (active) {
			const labelRaw = src.slice(bracket.labelStart, at);
			const next = src[at + 1];
			if (next === "(") {
				const parsed = parseInlineDestination(src, at + 1);
				if (parsed) {
					href = parsed.href;
					end = parsed.end;
				}
			} else if (labelRaw.length <= MAX_REF_LABEL) {
				let key = labelRaw;
				let after = at + 1;
				let usable = true;
				if (next === "[") {
					let q = at + 2;
					while (q < n && q - at <= MAX_REF_LABEL && src[q] !== "]") q++;
					if (src[q] === "]") {
						const second = src.slice(at + 2, q);
						if (second !== "") key = second;
						after = q + 1;
					} else {
						usable = false;
					}
				}
				const found = usable ? refs.get(normalizeKey(key)) : undefined;
				if (found !== undefined) {
					href = found;
					end = after;
				}
			}
		}
		if (href === null) {
			buffer += "]";
			return at + 1;
		}
		flush();
		if (bracket.image) {
			const alt = plainAlt(src.slice(bracket.labelStart, at));
			nodes.length = bracket.node;
			matches.length = bracket.matchesLength;
			links.length = bracket.linksLength;
			dropDelimiters(bracket.delimFloor);
			nodes.push({ type: "text", text: alt, image: true });
		} else {
			const safe = safeHref(href);
			nodes[bracket.node] = { type: "text", text: "" };
			dropDelimiters(bracket.delimFloor);
			if (safe)
				links.push({ from: bracket.node, to: nodes.length, href: safe });
			deactivatedBelow = brackets.length;
		}
		return end;
	};

	let i = 0;
	while (i < n) {
		if (nodes.length > MAX_INLINE_NODES) {
			// Past this point markup is not worth the memory: keep the rest as plain text.
			buffer += src.slice(i);
			break;
		}
		let j = i;
		while (j < n) {
			const code = src.charCodeAt(j);
			if (code < 128 && SPECIAL[code] === 1) break;
			j++;
		}
		if (j > i) buffer += src.slice(i, j);
		if (j >= n) break;
		const code = src.charCodeAt(j);

		if (code === BACKSLASH) {
			if (isAsciiPunct(src.charCodeAt(j + 1))) {
				buffer += src[j + 1];
				i = j + 2;
			} else {
				buffer += "\\";
				i = j + 1;
			}
		} else if (code === BACKTICK) {
			let k = j;
			while (k < n && src.charCodeAt(k) === BACKTICK) k++;
			const length = k - j;
			const closer = findBacktickCloser(length, k);
			if (closer === -1) {
				buffer += src.slice(j, k);
				i = k;
			} else {
				let content = src.slice(k, closer);
				if (
					content.length >= 2 &&
					content.startsWith(" ") &&
					content.endsWith(" ") &&
					content.trim() !== ""
				) {
					content = content.slice(1, -1);
				}
				buffer += content;
				i = closer + length;
			}
		} else if (code === LT) {
			i = readAngle(j);
		} else if (code === AMP) {
			const entity = decodeEntity(src, j, false);
			if (entity) {
				buffer += entity.text;
				i = entity.end;
			} else {
				buffer += "&";
				i = j + 1;
			}
		} else if (code === BANG) {
			if (src.charCodeAt(j + 1) === OPEN_BRACKET) {
				flush();
				brackets.push({
					node: nodes.length,
					image: true,
					delimFloor: delimId,
					matchesLength: matches.length,
					linksLength: links.length,
					labelStart: j + 2,
				});
				nodes.push({ type: "text", text: "![" });
				i = j + 2;
			} else {
				buffer += "!";
				i = j + 1;
			}
		} else if (code === OPEN_BRACKET) {
			flush();
			brackets.push({
				node: nodes.length,
				image: false,
				delimFloor: delimId,
				matchesLength: matches.length,
				linksLength: links.length,
				labelStart: j + 1,
			});
			nodes.push({ type: "text", text: "[" });
			i = j + 1;
		} else if (code === CLOSE_BRACKET) {
			if (brackets.length === 0) {
				buffer += "]";
				i = j + 1;
			} else {
				i = resolveBracket(j);
			}
		} else {
			// `*` or `_`: a delimiter run
			let k = j;
			while (k < n && src.charCodeAt(k) === code) k++;
			const before = charBefore(j);
			const after = charAfter(k);
			const beforeSpace = isWhitespaceChar(before);
			const afterSpace = isWhitespaceChar(after);
			const beforePunct = isPunctChar(before);
			const afterPunct = isPunctChar(after);
			const leftFlanking =
				!afterSpace && (!afterPunct || beforeSpace || beforePunct);
			const rightFlanking =
				!beforeSpace && (!beforePunct || afterSpace || afterPunct);
			const canOpen =
				code === STAR
					? leftFlanking
					: leftFlanking && (!rightFlanking || beforePunct);
			const canClose =
				code === STAR
					? rightFlanking
					: rightFlanking && (!leftFlanking || afterPunct);
			flush();
			const node: DelimNode = {
				type: "delim",
				char: code,
				count: k - j,
				remaining: k - j,
				left: 0,
				right: 0,
				canOpen,
				canClose,
				id: delimId++,
				index: nodes.length,
				openPos: 0,
			};
			nodes.push(node);
			if (canClose) closeEmphasis(node);
			if (node.remaining > 0 && canOpen) {
				(code === STAR ? starStack : underStack).push(node);
			}
			i = k;
		}
	}
	flush();

	function charBefore(at: number): string {
		if (at <= 0) return " ";
		const low = src.charCodeAt(at - 1);
		if (low >= 0xdc00 && low <= 0xdfff && at >= 2) return src.slice(at - 2, at);
		return src[at - 1] as string;
	}

	function charAfter(at: number): string {
		if (at >= n) return " ";
		const high = src.charCodeAt(at);
		if (high >= 0xd800 && high <= 0xdbff && at + 1 < n) {
			return src.slice(at, at + 2);
		}
		return src[at] as string;
	}

	function readAngle(j: number): number {
		if (src.startsWith("<!--", j)) {
			if (!noCommentEnd) {
				const end = src.indexOf("-->", j + 4);
				if (end !== -1) return end + 3;
				noCommentEnd = true;
			}
			buffer += "<";
			return j + 1;
		}
		if (nextGt === -2 || (nextGt !== -1 && nextGt < j)) {
			nextGt = src.indexOf(">", j + 1);
		}
		if (nextGt === -1 || nextGt - j > MAX_TAG) {
			buffer += "<";
			return j + 1;
		}
		const content = src.slice(j + 1, nextGt);
		if (content.includes("<")) {
			buffer += "<";
			return j + 1;
		}
		const end = nextGt + 1;
		if (AUTOLINK.test(content)) {
			flush();
			nodes.push({ type: "text", text: content });
			const safe = safeHref(content);
			if (safe)
				links.push({ from: nodes.length - 1, to: nodes.length, href: safe });
			return end;
		}
		if (EMAIL.test(content)) {
			flush();
			nodes.push({ type: "text", text: content });
			links.push({
				from: nodes.length - 1,
				to: nodes.length,
				href: `mailto:${content}`,
			});
			return end;
		}
		const first = content.charCodeAt(0);
		const isLetter = (c: number) =>
			(c >= 65 && c <= 90) || (c >= 97 && c <= 122);
		const nameStart = first === 47 ? 1 : 0;
		if (
			isLetter(content.charCodeAt(nameStart)) ||
			first === 33 ||
			first === 63
		) {
			const name = /^[A-Za-z][A-Za-z0-9]*/.exec(
				content.slice(nameStart, nameStart + 12),
			);
			if (name && SPACING_TAGS.has(name[0].toLowerCase())) buffer += " ";
			return end;
		}
		buffer += "<";
		return j + 1;
	}

	// Render: build the text and turn matched delimiters into spans.
	const before = new Int32Array(nodes.length + 1);
	const parts: string[] = [];
	let position = 0;
	for (let k = 0; k < nodes.length; k++) {
		before[k] = position;
		const node = nodes[k] as Node;
		if (node.type === "text") {
			parts.push(node.text);
			position += node.text.length;
		} else {
			const literal = node.count - node.left - node.right;
			if (literal > 0) {
				parts.push(String.fromCharCode(node.char).repeat(literal));
				position += literal;
			}
			node.openPos = position;
		}
	}
	before[nodes.length] = position;

	let spans: Span[] = [];
	for (const match of matches) {
		const start = match.open.openPos;
		const end = before[match.close.index] as number;
		if (start < end) spans.push({ kind: match.kind, start, end });
	}
	for (const link of links) {
		const start = before[link.from] as number;
		const end = before[link.to] as number;
		if (start < end) spans.push({ kind: "link", start, end, href: link.href });
	}

	let text = parts.join("");
	const trimmedStart = text.length - text.trimStart().length;
	const trimmed = text.trim();
	if (trimmed.length !== text.length) {
		const length = trimmed.length;
		spans = spans
			.map((span) => ({
				...span,
				start: Math.max(0, span.start - trimmedStart),
				end: Math.min(length, span.end - trimmedStart),
			}))
			.filter((span) => span.start < span.end);
		text = trimmed;
	}
	spans.sort(
		(a, b) =>
			a.start - b.start ||
			b.end - a.end ||
			(a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
	);

	const only = nodes.length === 1 ? nodes[0] : undefined;
	const soleImageAlt = only?.type === "text" && only.image ? only.text : null;
	return { text, spans, soleImageAlt };
}
