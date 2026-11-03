import type { Block, Span } from "@speeedy/contracts";
import { clip, collapseSpaces, isBlank, tidyLine } from "./clean";
import { parseInline, type RefMap, referenceKey } from "./inline";
import type { BlockSink } from "./types";

/**
 * Markdown to Document blocks. This is a line-based reader for the CommonMark constructs a
 * reading app needs (headings, paragraphs, lists, quotes, fenced and indented code, tables,
 * images, links, emphasis) plus YAML front matter for the title and language. Anything it
 * does not understand stays visible as ordinary text. Every loop is bounded by the input
 * length, and nothing recurses, so deep nesting costs nothing extra.
 */

export type MarkdownMeta = { title: string | null; language: string | null };

const MAX_LIST_DEPTH = 10;
const MAX_REFERENCES = 50_000;
const MAX_FRONT_MATTER_LINES = 100;
const MAX_TITLE = 200;

type FrontMatter = { meta: MarkdownMeta; offset: number };

const FRONT_MATTER_LINE =
	/^(?:[A-Za-z_][\w-]{0,40}:.*|[ \t]+.*|-[ \t].*|#.*|)$/;

function unquote(value: string): string {
	const trimmed = value.trim();
	const first = trimmed[0];
	if (
		trimmed.length >= 2 &&
		(first === '"' || first === "'") &&
		trimmed.endsWith(first)
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function readFrontMatter(text: string): FrontMatter | null {
	if (!text.startsWith("---\n")) return null;
	let pos = 4;
	let title: string | null = null;
	let language: string | null = null;
	for (let count = 0; count < MAX_FRONT_MATTER_LINES; count++) {
		if (pos > text.length) return null;
		let end = text.indexOf("\n", pos);
		if (end === -1) end = text.length;
		const line = text.slice(pos, end);
		if (line.length > 2000) return null;
		if (line === "---" || line === "...") {
			return {
				meta: { title, language },
				offset: Math.min(end + 1, text.length),
			};
		}
		if (!FRONT_MATTER_LINE.test(line)) return null;
		const match = /^(title|lang|language):(.*)$/.exec(line);
		if (match?.[1] && match[2] !== undefined) {
			const value = tidyLine(unquote(match[2]));
			if (match[1] === "title") title = value ? clip(value, MAX_TITLE) : title;
			else language = value || language;
		}
		pos = end + 1;
	}
	return null;
}

const DEFINITION =
	/^ {0,3}\[([^\]]{1,200})\]:[ \t]*(\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;

function matchDefinition(line: string): { key: string; url: string } | null {
	const first = line.trimStart()[0];
	if (first !== "[") return null;
	const match = DEFINITION.exec(line);
	if (!match?.[1] || !match[2]) return null;
	return {
		key: referenceKey(match[1]),
		url: match[2].replace(/^<(.*)>$/, "$1"),
	};
}

function collectReferences(text: string, from: number): Map<string, string> {
	const refs = new Map<string, string>();
	let pos = from;
	while (pos < text.length && refs.size < MAX_REFERENCES) {
		let end = text.indexOf("\n", pos);
		if (end === -1) end = text.length;
		if (end - pos < 4000) {
			const line = text.slice(pos, end);
			const def = matchDefinition(line);
			if (def && !refs.has(def.key)) refs.set(def.key, def.url);
		}
		pos = end + 1;
	}
	return refs;
}

/** Leading columns (a tab counts as four) and the index of the first other character. */
function leading(line: string): { indent: number; offset: number } {
	let indent = 0;
	let offset = 0;
	for (; offset < line.length; offset++) {
		const char = line.charCodeAt(offset);
		if (char === 32) indent++;
		else if (char === 9) indent += 4;
		else break;
	}
	return { indent, offset };
}

function isHorizontalRule(body: string): boolean {
	const mark = body[0];
	if (mark !== "-" && mark !== "*" && mark !== "_") return false;
	let marks = 0;
	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (char === mark) marks++;
		else if (char !== " " && char !== "\t") return false;
	}
	return marks >= 3;
}

/** 1 for a `===` underline, 2 for a `---` underline, 0 otherwise. */
function setextLevel(body: string): 0 | 1 | 2 {
	const trimmed = body.trimEnd();
	const mark = trimmed[0];
	if (mark !== "=" && mark !== "-") return 0;
	for (let i = 1; i < trimmed.length; i++) if (trimmed[i] !== mark) return 0;
	if (mark === "=") return 1;
	return trimmed.length >= 2 ? 2 : 0;
}

function isTableDelimiter(line: string): boolean {
	let dashes = 0;
	let pipes = 0;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === "-") dashes++;
		else if (char === "|") pipes++;
		else if (char !== ":" && char !== " " && char !== "\t") return false;
	}
	return dashes > 0 && pipes > 0;
}

function splitRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < s.length; i++) {
		const char = s[i] as string;
		if (char === "\\" && s[i + 1] === "|") {
			current += "|";
			i++;
		} else if (char === "|") {
			cells.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	cells.push(current);
	return cells.map((cell) => cell.trim()).filter((cell) => cell !== "");
}

type Marker = { ordered: boolean; content: string };

function matchListMarker(body: string, paragraphOpen: boolean): Marker | null {
	const first = body.charCodeAt(0);
	if (first === 45 || first === 43 || first === 42) {
		const next = body[1];
		if (next === undefined)
			return paragraphOpen ? null : { ordered: false, content: "" };
		if (next !== " " && next !== "\t") return null;
		return { ordered: false, content: body.slice(2) };
	}
	if (first >= 48 && first <= 57) {
		let i = 1;
		while (i < 10 && body.charCodeAt(i) >= 48 && body.charCodeAt(i) <= 57) i++;
		const delimiter = body[i];
		if (delimiter !== "." && delimiter !== ")") return null;
		const number = Number.parseInt(body.slice(0, i), 10);
		if (paragraphOpen && number !== 1) return null;
		const next = body[i + 1];
		if (next === undefined)
			return paragraphOpen ? null : { ordered: true, content: "" };
		if (next !== " " && next !== "\t") return null;
		return { ordered: true, content: body.slice(i + 2) };
	}
	return null;
}

function fenceOpening(body: string): { char: string; length: number } | null {
	const char = body[0];
	if (char !== "`" && char !== "~") return null;
	let length = 0;
	while (body[length] === char) length++;
	if (length < 3) return null;
	if (char === "`" && body.indexOf("`", length) !== -1) return null;
	return { char, length };
}

function isFenceClose(body: string, char: string, length: number): boolean {
	let count = 0;
	while (body[count] === char) count++;
	if (count < length) return false;
	return isBlank(body.slice(count));
}

/** Count `>` markers and return the text after them. */
function readQuote(body: string): { depth: number; rest: string } {
	let depth = 0;
	let p = 0;
	for (;;) {
		if (body[p] !== ">") break;
		depth++;
		p++;
		if (body[p] === " ") p++;
		let q = p;
		while (body[q] === " ") q++;
		if (body[q] === ">") p = q;
		else break;
	}
	return { depth, rest: body.slice(p) };
}

export function markdownToBlocks(text: string, sink: BlockSink): MarkdownMeta {
	const front = readFrontMatter(text);
	const start = front?.offset ?? 0;
	const refs: RefMap = collectReferences(text, start);
	const length = text.length;

	let firstHeading: string | null = null;
	let paragraph: string[] = [];
	let quote: { depth: number; lines: string[] } | null = null;
	let item: { depth: number; ordered: boolean; lines: string[] } | null = null;
	const listIndents: number[] = [];
	let listActive = false;
	let fence: {
		char: string;
		length: number;
		indent: number;
		start: number;
		end: number;
	} | null = null;
	let code: { start: number; end: number } | null = null;
	let inTable = false;
	let inComment = false;

	const emit = (
		make: (text: string, spans: Span[]) => Block,
		raw: string,
	): string | null => {
		const result = parseInline(collapseSpaces(raw), refs);
		if (result.text === "") return null;
		sink.push(make(result.text, result.spans));
		return result.text;
	};

	const flushParagraph = () => {
		if (paragraph.length === 0) return;
		const raw = paragraph.join(" ");
		paragraph = [];
		const result = parseInline(collapseSpaces(raw), refs);
		if (result.soleImageAlt !== null) {
			sink.push({ kind: "image-placeholder", alt: result.soleImageAlt });
		} else if (result.text !== "") {
			sink.push({ kind: "paragraph", text: result.text, spans: result.spans });
		}
	};
	const flushQuote = () => {
		if (!quote) return;
		const raw = quote.lines.join(" ");
		quote = null;
		emit((text, spans) => ({ kind: "quote", text, spans }), raw);
	};
	const flushItem = () => {
		if (!item) return;
		const { depth, ordered, lines } = item;
		item = null;
		emit(
			(text, spans) => ({ kind: "list-item", depth, ordered, text, spans }),
			lines.join(" "),
		);
	};
	const flushCode = () => {
		if (!code) return;
		const raw = text
			.slice(code.start, code.end)
			.replace(/^(?: {1,4}|\t)/gm, "");
		code = null;
		if (raw.trim() !== "") sink.push({ kind: "code", text: raw, spans: [] });
	};
	const closeFence = () => {
		if (!fence) return;
		let raw = fence.end > fence.start ? text.slice(fence.start, fence.end) : "";
		if (fence.indent > 0) {
			raw = raw.replace(new RegExp(`^ {1,${fence.indent}}`, "gm"), "");
		}
		fence = null;
		if (raw.trim() !== "") sink.push({ kind: "code", text: raw, spans: [] });
	};
	const flushAll = () => {
		flushParagraph();
		flushQuote();
		flushItem();
		flushCode();
	};
	const endList = () => {
		listIndents.length = 0;
		listActive = false;
	};
	const pushHeading = (level: 1 | 2 | 3 | 4 | 5 | 6, raw: string) => {
		const heading = emit(
			(headingText, spans) => ({
				kind: "heading",
				level,
				text: headingText,
				spans,
			}),
			raw,
		);
		if (heading !== null && firstHeading === null)
			firstHeading = clip(tidyLine(heading), MAX_TITLE);
	};

	let lineStart = start;
	while (lineStart <= length) {
		let lineEnd = text.indexOf("\n", lineStart);
		if (lineEnd === -1) lineEnd = length;
		const line = lineEnd === lineStart ? "" : text.slice(lineStart, lineEnd);
		const here = lineStart;
		lineStart = lineEnd + 1;

		if (fence) {
			const { indent, offset } = leading(line);
			if (
				indent < 4 &&
				isFenceClose(line.slice(offset), fence.char, fence.length)
			) {
				closeFence();
			} else {
				fence.end = lineEnd;
			}
			continue;
		}
		if (inComment) {
			if (line.includes("-->")) inComment = false;
			continue;
		}
		if (isBlank(line)) {
			flushParagraph();
			flushQuote();
			flushItem();
			inTable = false;
			continue;
		}
		const { indent, offset } = leading(line);
		const body = line.slice(offset);

		if (code) {
			if (indent >= 4) {
				code.end = lineEnd;
				continue;
			}
			flushCode();
		}
		if (inTable) {
			if (body.includes("|")) {
				const cells = splitRow(line);
				if (cells.length > 0) {
					emit(
						(t, spans) => ({ kind: "table-text", text: t, spans }),
						cells.join(" "),
					);
				}
				continue;
			}
			inTable = false;
		}
		if (
			indent >= 4 &&
			paragraph.length === 0 &&
			!item &&
			!listActive &&
			!quote
		) {
			code = { start: here, end: lineEnd };
			continue;
		}

		if (indent < 4 && body.charCodeAt(0) === 62) {
			flushParagraph();
			flushItem();
			endList();
			const { depth, rest } = readQuote(body);
			if (isBlank(rest)) {
				flushQuote();
			} else {
				if (quote && quote.depth !== depth) flushQuote();
				quote ??= { depth, lines: [] };
				quote.lines.push(rest.trim());
			}
			continue;
		}
		flushQuote();

		if (indent < 4) {
			const opening = fenceOpening(body);
			if (opening) {
				flushParagraph();
				flushItem();
				endList();
				fence = { ...opening, indent, start: lineEnd + 1, end: lineEnd + 1 };
				continue;
			}
			if (body.charCodeAt(0) === 35) {
				let hashes = 0;
				while (body.charCodeAt(hashes) === 35) hashes++;
				const after = body[hashes];
				if (
					hashes <= 6 &&
					(after === undefined || after === " " || after === "\t")
				) {
					flushParagraph();
					flushItem();
					endList();
					let content = body.slice(hashes).trim();
					let closing = 0;
					while (content.charCodeAt(content.length - 1 - closing) === 35)
						closing++;
					if (closing > 0) {
						const kept = content.slice(0, content.length - closing);
						if (kept === "" || kept.endsWith(" ") || kept.endsWith("\t")) {
							content = kept.trim();
						}
					}
					pushHeading(hashes as 1 | 2 | 3 | 4 | 5 | 6, content);
					continue;
				}
			}
			if (paragraph.length > 0) {
				const level = setextLevel(body);
				if (level > 0) {
					const raw = paragraph.join(" ");
					paragraph = [];
					pushHeading(level as 1 | 2, raw);
					continue;
				}
			}
			if (isHorizontalRule(body)) {
				flushParagraph();
				flushItem();
				endList();
				continue;
			}
			if (body.startsWith("<!--") && !body.includes("-->")) {
				flushParagraph();
				inComment = true;
				continue;
			}
		}

		if (body.includes("|") && paragraph.length === 0 && !item) {
			let nextEnd = text.indexOf("\n", lineStart);
			if (nextEnd === -1) nextEnd = length;
			if (
				lineStart < length &&
				isTableDelimiter(text.slice(lineStart, nextEnd))
			) {
				endList();
				const cells = splitRow(line);
				if (cells.length > 0) {
					emit(
						(t, spans) => ({ kind: "table-text", text: t, spans }),
						cells.join(" "),
					);
				}
				lineStart = nextEnd + 1;
				inTable = true;
				continue;
			}
		}

		const marker = matchListMarker(body, paragraph.length > 0);
		if (marker) {
			flushParagraph();
			flushItem();
			while (
				listIndents.length > 0 &&
				(listIndents[listIndents.length - 1] as number) > indent
			) {
				listIndents.pop();
			}
			const top = listIndents[listIndents.length - 1];
			if (top === undefined || top < indent) {
				if (listIndents.length <= MAX_LIST_DEPTH) listIndents.push(indent);
			}
			listActive = true;
			item = {
				depth: Math.min(listIndents.length - 1, MAX_LIST_DEPTH),
				ordered: marker.ordered,
				lines: marker.content.trim() === "" ? [] : [marker.content.trim()],
			};
			continue;
		}

		if (paragraph.length === 0 && !item && matchDefinition(line)) continue;

		if (item) {
			item.lines.push(body.trim());
			continue;
		}
		if (indent < 2) endList();
		paragraph.push(body.trim());
	}

	closeFence();
	flushAll();
	const title = front?.meta.title ?? firstHeading;
	return { title, language: front?.meta.language ?? null };
}
