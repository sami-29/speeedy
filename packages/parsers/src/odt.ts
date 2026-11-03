import type { Block, Span } from "@speeedy/contracts";
import { clip, normalizeText, tidyLine } from "./clean";
import { safeHref, tidySpans } from "./html";
import { type BlockSink, ParseFailure } from "./types";
import { decodeXml, readXml } from "./xml";
import { isZip, openZip, type ZipArchive } from "./zip";

/**
 * ODT to Document blocks, with no DOM and no office library, so it runs in a Web Worker.
 *
 * An ODT is a ZIP of XML parts. This reads `content.xml` as a stream of elements, after the
 * styles part and the document's own automatic styles have told it which style is bold, italic,
 * a quotation or code, and which list style numbers its items. Only the body of `content.xml`
 * is ever read as text: headers and footers (they live in `styles.xml`), footnotes, comments,
 * tracked deletions, indexes, macros, form controls and embedded objects are left out, and
 * image bytes are never touched.
 *
 * Choices that the format leaves open:
 * - A table row becomes one `table-text` block, cells joined by a space, as HTML tables do. A
 *   nested table folds into the cell that holds it.
 * - A text box is read as ordinary paragraphs: after the paragraph that holds it, or where a
 *   page-anchored box sits. Many layout-heavy documents keep all their text in boxes.
 * - An image becomes a placeholder after the paragraph (or row) it sits in, with the alt text
 *   from `svg:title`, else `svg:desc`.
 * - Consecutive code paragraphs (`Preformatted Text`) become one code block, one line each.
 * - A heading in a list stays a heading. Every other paragraph in a list item is a list item.
 * - Language is never read from the file: LibreOffice writes a default whatever the text is,
 *   so the text decides.
 * - A password-protected document (its `content.xml` has encryption data in the manifest) is
 *   reported as `drm`, the same typed reason a protected book gets.
 */

export type OdtMeta = { title: string | null };

const MAX_CONTENT = 64 * 1024 * 1024;
const MAX_SMALL_PART = 16 * 1024 * 1024;
const MAX_STYLES = 50_000;
const MAX_LIST_STYLES = 10_000;
const MAX_STYLE_CHAIN = 24;
const MAX_LIST_DEPTH = 10;
const MAX_LEVELS = 10;
const MAX_SPANS_PER_BLOCK = 50_000;
const MAX_ALT = 1000;
const MAX_TITLE = 200;
const MAX_REPEAT = 200;
const TEXT_MIME = "application/vnd.oasis.opendocument.text";

const NOT_A_DOCUMENT = "This file is not an OpenDocument text file (.odt).";

const unsupported = (why: string): ParseFailure =>
	new ParseFailure("unsupported", why);

const PASSWORD_MESSAGE =
	"This document is protected by a password. Remove the password in LibreOffice or OpenOffice and open it again.";

async function readPart(
	zip: ZipArchive,
	name: string,
	max: number,
): Promise<Uint8Array | null> {
	try {
		return await zip.read(name, max);
	} catch (error) {
		if (error instanceof ParseFailure && error.reason === "drm") {
			throw new ParseFailure("drm", PASSWORD_MESSAGE);
		}
		throw error;
	}
}

// ---------------------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------------------

type StyleFamily = "text" | "paragraph";
type StyleKind = "quote" | "code" | "caption";

type StyleDef = {
	display: string;
	parent: string | null;
	bold: boolean | null;
	italic: boolean | null;
	hidden: boolean;
};

type StyleInfo = {
	bold: boolean | null;
	italic: boolean | null;
	hidden: boolean;
	heading: number;
	kind: StyleKind | null;
};

const QUOTE_STYLES = new Set([
	"quotations",
	"quotation",
	"blockquote",
	"quote",
]);
const CODE_STYLES = new Set([
	"preformattedtext",
	"sourcecode",
	"code",
	"htmlpreformatted",
]);

/** `Heading_20_1` to `heading1`: ODF encodes a space in a style name as `_20_`. */
const plainName = (raw: string): string =>
	raw
		.replace(/_20_/g, " ")
		.toLowerCase()
		.replace(/[\s_-]+/g, "");

function classify(raw: string): Pick<StyleInfo, "heading" | "kind"> | null {
	const name = plainName(raw);
	const heading = /^heading([1-9]|10)$/.exec(name);
	if (heading?.[1]) return { heading: Number(heading[1]), kind: null };
	if (name === "title") return { heading: 1, kind: null };
	if (QUOTE_STYLES.has(name)) return { heading: 0, kind: "quote" };
	if (CODE_STYLES.has(name)) return { heading: 0, kind: "code" };
	if (name === "caption") return { heading: 0, kind: "caption" };
	return null;
}

const NO_INFO: StyleInfo = {
	bold: null,
	italic: null,
	hidden: false,
	heading: 0,
	kind: null,
};

function weight(value: string | undefined): boolean | null {
	if (value === undefined) return null;
	if (value === "bold") return true;
	if (value === "normal") return false;
	const number = Number.parseInt(value, 10);
	return Number.isFinite(number) ? number >= 600 : null;
}

function slant(value: string | undefined): boolean | null {
	if (value === undefined) return null;
	if (value === "italic" || value === "oblique") return true;
	return value === "normal" ? false : null;
}

class Styles {
	private readonly defs = new Map<string, StyleDef>();
	private readonly resolved = new Map<string, StyleInfo>();
	private readonly lists = new Map<string, boolean[]>();
	private current: StyleDef | null = null;
	private currentList: boolean[] | null = null;
	private currentListName = "";

	private static key(family: StyleFamily, name: string): string {
		return `${family}:${name}`;
	}

	open(name: string, attribs: Record<string, string>): void {
		switch (name) {
			case "style:style": {
				const family = attribs["style:family"];
				const id = attribs["style:name"];
				this.current = null;
				if ((family !== "text" && family !== "paragraph") || id === undefined) {
					return;
				}
				if (this.defs.size >= MAX_STYLES) {
					throw new ParseFailure(
						"too-big",
						"This file has more styles than Speeedy can open.",
					);
				}
				const def: StyleDef = {
					display: attribs["style:display-name"] ?? "",
					parent: attribs["style:parent-style-name"] ?? null,
					bold: null,
					italic: null,
					hidden: false,
				};
				this.defs.set(Styles.key(family, id), def);
				this.current = def;
				return;
			}
			case "style:text-properties": {
				const def = this.current;
				if (def === null) return;
				const bold = weight(attribs["fo:font-weight"]);
				if (bold !== null) def.bold = bold;
				const italic = slant(attribs["fo:font-style"]);
				if (italic !== null) def.italic = italic;
				if (attribs["text:display"] === "none") def.hidden = true;
				return;
			}
			case "text:list-style": {
				this.currentList = [];
				this.currentListName = attribs["style:name"] ?? "";
				return;
			}
			case "text:list-level-style-number":
			case "text:list-level-style-bullet":
			case "text:list-level-style-image": {
				const list = this.currentList;
				const level = Number.parseInt(attribs["text:level"] ?? "", 10);
				if (list === null || !Number.isFinite(level)) return;
				if (level >= 1 && level <= MAX_LEVELS) {
					list[level - 1] = name === "text:list-level-style-number";
				}
			}
		}
	}

	close(name: string): void {
		if (name === "style:style") this.current = null;
		else if (name === "text:list-style") {
			if (
				this.currentList !== null &&
				this.currentListName !== "" &&
				this.lists.size < MAX_LIST_STYLES
			) {
				this.lists.set(this.currentListName, this.currentList);
			}
			this.currentList = null;
		}
	}

	/** Whether level `level` (1-based) of the named list style numbers its items. */
	ordered(listStyle: string | null, level: number): boolean {
		if (listStyle === null) return false;
		return this.lists.get(listStyle)?.[level - 1] === true;
	}

	get(family: StyleFamily, name: string): StyleInfo {
		const key = Styles.key(family, name);
		const known = this.resolved.get(key);
		if (known) return known;
		const defined = this.defs.has(key);
		const info = this.resolve(family, name);
		if (defined || this.resolved.size < MAX_STYLES * 2) {
			this.resolved.set(key, info);
		}
		return info;
	}

	private resolve(family: StyleFamily, startName: string): StyleInfo {
		const info: StyleInfo = { ...NO_INFO };
		let classified = false;
		let hiddenSet = false;
		let name: string | null = startName;
		const seen = new Set<string>();
		for (
			let step = 0;
			name !== null && step < MAX_STYLE_CHAIN && !seen.has(name);
			step++
		) {
			seen.add(name);
			const def: StyleDef | undefined = this.defs.get(Styles.key(family, name));
			if (!classified) {
				const found = (def ? classify(def.display) : null) ?? classify(name);
				if (found) {
					info.heading = found.heading;
					info.kind = found.kind;
					classified = true;
				}
			}
			if (def) {
				if (info.bold === null) info.bold = def.bold;
				if (info.italic === null) info.italic = def.italic;
				if (!hiddenSet && def.hidden) {
					info.hidden = true;
					hiddenSet = true;
				}
			}
			name = def?.parent ?? null;
		}
		if (family === "text") {
			const plain = plainName(startName);
			if (info.bold === null && plain === "strongemphasis") info.bold = true;
			if (info.italic === null && plain === "emphasis") info.italic = true;
		}
		return info;
	}
}

// ---------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------

/** Whether the manifest lists encryption data for `content.xml`. */
function contentIsEncrypted(xml: string): boolean {
	let entry = "";
	let encrypted = false;
	readXml(xml, {
		open(name, attribs) {
			if (name === "manifest:file-entry") {
				entry = (attribs["manifest:full-path"] ?? "").toLowerCase();
			} else if (
				name === "manifest:encryption-data" &&
				entry === "content.xml"
			) {
				encrypted = true;
			}
		},
		close(name) {
			if (name === "manifest:file-entry") entry = "";
		},
	});
	return encrypted;
}

function readTitle(xml: string): string | null {
	let inTitle = false;
	let title = "";
	readXml(xml, {
		open(name) {
			if (name === "dc:title") inTitle = true;
		},
		close(name) {
			if (name === "dc:title") inTitle = false;
		},
		text(data) {
			if (inTitle && title.length < MAX_TITLE * 4) title += data;
		},
	});
	const tidy = clip(tidyLine(normalizeText(title)), MAX_TITLE);
	return tidy === "" ? null : tidy;
}

// ---------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------

type Ctx =
	| { kind: "paragraph" | "quote" | "code" | "caption" | "table-text" }
	| { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
	| { kind: "list-item"; depth: number; ordered: boolean };

const PARAGRAPH: Ctx = { kind: "paragraph" };
const TABLE_ROW: Ctx = { kind: "table-text" };

/** Elements whose whole subtree is not body text a reader should get. */
const SKIPPED = new Set([
	"text:tracked-changes",
	"text:note",
	"office:annotation",
	"text:table-of-content",
	"text:illustration-index",
	"text:table-index",
	"text:object-index",
	"text:user-index",
	"text:alphabetical-index",
	"text:hidden-paragraph",
	"text:hidden-text",
	"text:page-number",
	"text:page-count",
	"text:ruby-text",
	"text:sequence-decls",
	"text:variable-decls",
	"text:user-field-decls",
	"text:dde-connection-decls",
	"office:forms",
	"office:scripts",
	"office:event-listeners",
	"office:font-face-decls",
	"office:automatic-styles",
	"office:styles",
	"office:master-styles",
	"office:settings",
	"office:meta",
	"office:binary-data",
	"draw:object",
	"draw:object-ole",
	"draw:plugin",
	"draw:applet",
	"draw:floating-frame",
	"draw:contour-polygon",
	"draw:contour-path",
]);

type Inline = {
	bold: boolean | null;
	italic: boolean | null;
	hidden: boolean;
	href: string | null;
};

type Frame = { title: string; desc: string; image: boolean; box: boolean };

/** What a paragraph in progress holds, set aside while a text box inside it is read. */
type Saved = {
	parts: string[];
	length: number;
	lastSpace: boolean;
	spans: Span[];
	tailStrong: Span | null;
	tailEmphasis: Span | null;
	tailLink: Span | null;
	pending: Block[];
	current: Ctx;
	inParagraph: boolean;
	tableDepth: number;
	lists: (string | null)[];
	inline: Inline[];
};

type Box = { saved: Saved; out: Block[] };

function readBody(xml: string, styles: Styles, sink: BlockSink): void {
	let parts: string[] = [];
	let length = 0;
	let lastSpace = false;
	let spans: Span[] = [];
	let tailStrong: Span | null = null;
	let tailEmphasis: Span | null = null;
	let tailLink: Span | null = null;
	let pending: Block[] = [];
	let heldCode: string | null = null;

	let skip = 0;
	let tableDepth = 0;
	let inParagraph = false;
	let current: Ctx = PARAGRAPH;
	let lists: (string | null)[] = [];
	let inline: Inline[] = [];
	const frames: Frame[] = [];
	const boxes: Box[] = [];
	let redirect: Block[] | null = null;
	let capture: "title" | "desc" | null = null;

	const flushCode = (): void => {
		if (heldCode === null) return;
		sink.push({ kind: "code", text: heldCode, spans: [] });
		heldCode = null;
	};

	const emit = (block: Block): void => {
		if (redirect !== null) {
			redirect.push(block);
			return;
		}
		if (block.kind === "code") {
			heldCode = heldCode === null ? block.text : `${heldCode}\n${block.text}`;
			return;
		}
		flushCode();
		sink.push(block);
	};

	const makeBlock = (ctx: Ctx, text: string, marks: Span[]): Block => {
		switch (ctx.kind) {
			case "heading":
				return { kind: "heading", level: ctx.level, text, spans: marks };
			case "list-item":
				return {
					kind: "list-item",
					depth: ctx.depth,
					ordered: ctx.ordered,
					text,
					spans: marks,
				};
			case "quote":
				return { kind: "quote", text, spans: marks };
			case "code":
				return { kind: "code", text, spans: [] };
			case "caption":
				return { kind: "caption", text, spans: marks };
			case "table-text":
				return { kind: "table-text", text, spans: marks };
			default:
				return { kind: "paragraph", text, spans: marks };
		}
	};

	const reset = (): void => {
		parts = [];
		length = 0;
		lastSpace = false;
		spans = [];
		tailStrong = null;
		tailEmphasis = null;
		tailLink = null;
	};

	const flush = (ctx: Ctx): void => {
		const queued = pending;
		pending = [];
		let text = parts.length === 1 ? (parts[0] ?? "") : parts.join("");
		if (ctx.kind === "code") {
			text = text.trimEnd();
			if (text.trim() === "") text = "";
		} else if (lastSpace) {
			text = text.slice(0, -1);
		}
		if (text !== "") {
			emit(
				makeBlock(ctx, text, ctx.kind === "code" ? [] : tidySpans(spans, text)),
			);
		}
		reset();
		for (const image of queued) emit(image);
	};

	const mark = (
		tail: Span | null,
		start: number,
		end: number,
		kind: "strong" | "emphasis" | "link",
		href: string | null,
	): Span | null => {
		if (
			tail !== null &&
			tail.end === start &&
			(tail.kind !== "link" || tail.href === href)
		) {
			tail.end = end;
			return tail;
		}
		if (spans.length >= MAX_SPANS_PER_BLOCK) return tail;
		const span: Span =
			kind === "link"
				? { kind, start, end, href: href ?? "" }
				: { kind, start, end };
		spans.push(span);
		return span;
	};

	const append = (data: string, raw: boolean): void => {
		if (data === "") return;
		const clean = normalizeText(data);
		if (clean === "") return;
		let chunk: string;
		if (raw) {
			chunk = clean;
			lastSpace = false;
		} else {
			chunk = /[^\S ]| {2}/.test(clean) ? clean.replace(/\s+/g, " ") : clean;
			if (chunk.charCodeAt(0) === 32 && (length === 0 || lastSpace)) {
				chunk = chunk.slice(1);
			}
			if (chunk === "") return;
			lastSpace = chunk.charCodeAt(chunk.length - 1) === 32;
		}
		const start = length;
		parts.push(chunk);
		length += chunk.length;
		if (current.kind === "code" && tableDepth === 0) return;
		const top = inline[inline.length - 1];
		const strong = top?.bold === true;
		const emphasis = top?.italic === true;
		const href = top?.href ?? null;
		if (strong) tailStrong = mark(tailStrong, start, length, "strong", null);
		if (emphasis) {
			tailEmphasis = mark(tailEmphasis, start, length, "emphasis", null);
		}
		if (href !== null) tailLink = mark(tailLink, start, length, "link", href);
	};

	const separate = (): void => {
		if (length > 0 && !lastSpace) append(" ", false);
	};

	const isHidden = (): boolean => inline[inline.length - 1]?.hidden === true;
	const isCode = (): boolean => current.kind === "code" && tableDepth === 0;

	const paragraphContext = (
		style: string | null,
		isHeading: boolean,
		level: string | undefined,
	): Ctx => {
		const info = style === null ? NO_INFO : styles.get("paragraph", style);
		if (isHeading) {
			const parsed = Number.parseInt(level ?? "", 10);
			const wanted =
				Number.isFinite(parsed) && parsed >= 1 ? parsed : info.heading || 1;
			return {
				kind: "heading",
				level: Math.min(wanted, 6) as 1 | 2 | 3 | 4 | 5 | 6,
			};
		}
		if (info.heading > 0) {
			return {
				kind: "heading",
				level: Math.min(info.heading, 6) as 1 | 2 | 3 | 4 | 5 | 6,
			};
		}
		if (lists.length > 0 && tableDepth === 0) {
			const depth = Math.min(lists.length - 1, MAX_LIST_DEPTH);
			return {
				kind: "list-item",
				depth,
				ordered: styles.ordered(lists[lists.length - 1] ?? null, lists.length),
			};
		}
		return info.kind === null ? PARAGRAPH : { kind: info.kind };
	};

	const startParagraph = (
		isHeading: boolean,
		attribs: Record<string, string>,
	): void => {
		if (tableDepth === 0) flush(current);
		else separate();
		const style = attribs["text:style-name"] ?? null;
		current = paragraphContext(style, isHeading, attribs["text:outline-level"]);
		inParagraph = true;
	};

	readXml(xml, {
		open(name, attribs) {
			styles.open(name, attribs);
			if (skip > 0) {
				skip++;
				return;
			}
			if (SKIPPED.has(name) || attribs["text:display"] === "none") {
				skip = 1;
				return;
			}
			switch (name) {
				case "text:h":
				case "text:p": {
					const style = attribs["text:style-name"];
					if (style !== undefined && styles.get("paragraph", style).hidden) {
						skip = 1;
						return;
					}
					startParagraph(name === "text:h", attribs);
					return;
				}
				case "text:list": {
					if (tableDepth === 0) flush(current);
					lists.push(
						attribs["text:style-name"] ?? lists[lists.length - 1] ?? null,
					);
					return;
				}
				case "table:table":
					if (tableDepth === 0) flush(current);
					tableDepth++;
					return;
				case "table:table-row":
					if (tableDepth === 1) flush(current);
					return;
				case "table:table-cell":
					separate();
					return;
				case "text:span":
				case "text:a": {
					const style = attribs["text:style-name"];
					const info =
						style === undefined ? NO_INFO : styles.get("text", style);
					const href =
						name === "text:a" && attribs["xlink:href"] !== undefined
							? safeHref(attribs["xlink:href"])
							: null;
					// Each frame holds what is in force at that depth, so reading a text node
					// never walks the stack.
					const parent = inline[inline.length - 1];
					inline.push({
						bold: info.bold ?? parent?.bold ?? null,
						italic: info.italic ?? parent?.italic ?? null,
						hidden: info.hidden || parent?.hidden === true,
						href: href ?? parent?.href ?? null,
					});
					return;
				}
				case "text:s": {
					if (!inParagraph || isHidden()) return;
					if (isCode()) {
						const count = Number.parseInt(attribs["text:c"] ?? "1", 10);
						const n = Number.isFinite(count)
							? Math.min(Math.max(count, 1), MAX_REPEAT)
							: 1;
						append(" ".repeat(n), true);
					} else separate();
					return;
				}
				case "text:tab":
					if (!inParagraph || isHidden()) return;
					if (isCode()) append("\t", true);
					else separate();
					return;
				case "text:line-break":
					if (!inParagraph || isHidden()) return;
					if (isCode()) append("\n", true);
					else separate();
					return;
				case "draw:frame":
					frames.push({ title: "", desc: "", image: false, box: false });
					return;
				case "draw:text-box": {
					const frame = frames[frames.length - 1];
					if (frame) frame.box = true;
					const out: Block[] = [];
					boxes.push({
						saved: {
							parts,
							length,
							lastSpace,
							spans,
							tailStrong,
							tailEmphasis,
							tailLink,
							pending,
							current,
							inParagraph,
							tableDepth,
							lists,
							inline,
						},
						out,
					});
					reset();
					pending = [];
					current = PARAGRAPH;
					inParagraph = false;
					tableDepth = 0;
					lists = [];
					inline = [];
					redirect = out;
					return;
				}
				case "draw:image": {
					const frame = frames[frames.length - 1];
					if (frame) frame.image = true;
					return;
				}
				case "svg:title":
					if (frames.length > 0) capture = "title";
					return;
				case "svg:desc":
					if (frames.length > 0) capture = "desc";
					return;
			}
		},
		close(name) {
			styles.close(name);
			if (skip > 0) {
				skip--;
				return;
			}
			switch (name) {
				case "text:h":
				case "text:p":
					if (tableDepth === 0) flush(current);
					else separate();
					inParagraph = false;
					current = PARAGRAPH;
					return;
				case "text:list":
					lists.pop();
					return;
				case "table:table":
					tableDepth--;
					return;
				case "table:table-row":
					if (tableDepth === 1) {
						flush(TABLE_ROW);
					}
					return;
				case "table:table-cell":
					separate();
					return;
				case "text:span":
				case "text:a":
					inline.pop();
					return;
				case "svg:title":
				case "svg:desc":
					capture = null;
					return;
				case "draw:text-box": {
					const box = boxes.pop();
					if (box === undefined) return;
					flush(current);
					const saved = box.saved;
					parts = saved.parts;
					length = saved.length;
					lastSpace = saved.lastSpace;
					spans = saved.spans;
					tailStrong = saved.tailStrong;
					tailEmphasis = saved.tailEmphasis;
					tailLink = saved.tailLink;
					pending = saved.pending;
					current = saved.current;
					inParagraph = saved.inParagraph;
					tableDepth = saved.tableDepth;
					lists = saved.lists;
					inline = saved.inline;
					redirect = boxes[boxes.length - 1]?.out ?? null;
					if (inParagraph || tableDepth > 0) pending.push(...box.out);
					else for (const block of box.out) emit(block);
					return;
				}
				case "draw:frame": {
					const frame = frames.pop();
					if (frame === undefined || !frame.image) return;
					const alt = clip(
						tidyLine(normalizeText(frame.title || frame.desc)),
						MAX_ALT,
					);
					const image: Block = { kind: "image-placeholder", alt };
					if (inParagraph || tableDepth > 0) pending.push(image);
					else emit(image);
				}
			}
		},
		text(data) {
			if (skip > 0) return;
			if (capture !== null) {
				const frame = frames[frames.length - 1];
				if (frame && frame[capture].length < MAX_ALT * 2)
					frame[capture] += data;
				return;
			}
			const frame = frames[frames.length - 1];
			if ((frame !== undefined && !frame.box) || !inParagraph || isHidden()) {
				return;
			}
			append(data, false);
		},
	});
	flush(current);
	flushCode();
}

// ---------------------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------------------

/**
 * Turn ODT bytes into blocks. Throws `ParseFailure` for a protected, corrupt or oversized
 * file; the caller turns that into a typed `ParseError`.
 */
export async function odtToBlocks(
	bytes: Uint8Array,
	sink: BlockSink,
): Promise<OdtMeta> {
	if (!isZip(bytes)) throw unsupported(NOT_A_DOCUMENT);
	const zip = openZip(bytes);

	const mime = await readPart(zip, "mimetype", 1024);
	if (mime !== null) {
		const type = new TextDecoder().decode(mime).trim();
		if (!type.startsWith(TEXT_MIME)) {
			throw unsupported(
				type.startsWith("application/vnd.oasis.opendocument.")
					? "This is an OpenDocument file, but not a text document (.odt)."
					: NOT_A_DOCUMENT,
			);
		}
	}

	const manifest = await readPart(zip, "META-INF/manifest.xml", MAX_SMALL_PART);
	if (manifest !== null && contentIsEncrypted(decodeXml(manifest))) {
		throw new ParseFailure("drm", PASSWORD_MESSAGE);
	}

	const content = await readPart(zip, "content.xml", MAX_CONTENT);
	if (content === null) throw unsupported(NOT_A_DOCUMENT);

	const styles = new Styles();
	const stylesPart = await readPart(zip, "styles.xml", MAX_SMALL_PART);
	if (stylesPart !== null) {
		readXml(decodeXml(stylesPart), {
			open: (name, attribs) => styles.open(name, attribs),
			close: (name) => styles.close(name),
		});
	}
	readBody(decodeXml(content), styles, sink);

	const meta = await readPart(zip, "meta.xml", MAX_SMALL_PART);
	return { title: meta === null ? null : readTitle(decodeXml(meta)) };
}
