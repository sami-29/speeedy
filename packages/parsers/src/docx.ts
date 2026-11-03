import type { Block, Span } from "@speeedy/contracts";
import { clip, normalizeText, tidyLine } from "./clean";
import { safeHref, tidySpans } from "./html";
import { type BlockSink, ParseFailure } from "./types";
import { decodeXml, readXml } from "./xml";
import { isZip, openZip, type ZipArchive } from "./zip";

/**
 * DOCX to Document blocks, with no DOM and no Word library, so it runs in a Web Worker.
 *
 * A DOCX is a ZIP of XML parts. This reads `word/document.xml` as a stream of elements, with the
 * styles part (headings, quotes, code, captions, emphasis), the numbering part (list kind and
 * depth) and the relationships part (link targets) loaded first. Nothing outside the main part
 * is ever read as text: headers, footers, footnotes, comments, text boxes, macros and embedded
 * objects are ignored, and image bytes are never touched.
 *
 * Choices that the format leaves open:
 * - A table row becomes one `table-text` block, cells joined by a space, as HTML tables do. A
 *   nested table folds into the cell that holds it.
 * - An image becomes a placeholder after the paragraph (or row) it sits in.
 * - Deleted text (tracked changes), hidden text and `mc:Fallback` copies are left out. Inserted
 *   text stays.
 * - Language is never read from the file: Word and LibreOffice write a default (often `en-US`
 *   or `fr-FR`) whatever the text is, so the text decides.
 */

export type DocxMeta = { title: string | null };

const MAX_MAIN_PART = 64 * 1024 * 1024;
const MAX_SMALL_PART = 8 * 1024 * 1024;
const MAX_RELATIONSHIPS = 100_000;
const MAX_STYLES = 50_000;
const MAX_LISTS = 50_000;
const MAX_FIELD_DEPTH = 64;
const MAX_INSTRUCTION = 4000;
const MAX_STYLE_CHAIN = 24;
const MAX_LIST_DEPTH = 8;
const MAX_SPANS_PER_BLOCK = 50_000;
const MAX_ALT = 1000;
const MAX_TITLE = 200;
const EMU_PER_PIXEL = 9525;
const MAX_IMAGE_SIZE = 100_000;

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const DEFAULT_MAIN = "word/document.xml";

const unsupported = (why: string): ParseFailure =>
	new ParseFailure("unsupported", why);

// ---------------------------------------------------------------------------------------
// Files that are not a plain package
// ---------------------------------------------------------------------------------------

/** Whether the bytes contain `text` encoded as UTF-16LE (how a compound file names streams). */
function hasUtf16Name(bytes: Uint8Array, text: string): boolean {
	const first = text.charCodeAt(0);
	let at = bytes.indexOf(first);
	while (at >= 0 && at + text.length * 2 <= bytes.length) {
		let match = true;
		for (let i = 0; i < text.length; i++) {
			if (
				bytes[at + i * 2] !== text.charCodeAt(i) ||
				bytes[at + i * 2 + 1] !== 0
			) {
				match = false;
				break;
			}
		}
		if (match) return true;
		at = bytes.indexOf(first, at + 1);
	}
	return false;
}

/** The error for bytes that are not a ZIP package: a protected file, an old .doc, or junk. */
function notAPackage(bytes: Uint8Array): ParseFailure {
	if (CFB_MAGIC.every((value, index) => bytes[index] === value)) {
		if (
			hasUtf16Name(bytes, "EncryptedPackage") ||
			hasUtf16Name(bytes, "DRMEncryptedTransform") ||
			hasUtf16Name(bytes, "DRMContent")
		) {
			return new ParseFailure(
				"drm",
				"This Word file is protected by a password or by rights management. Remove the protection in Word and open it again.",
			);
		}
		if (hasUtf16Name(bytes, "WordDocument")) {
			return unsupported(
				"This is an older Word file (.doc) with a .docx name. Save it as .docx in Word and open it again.",
			);
		}
	}
	return unsupported("This file is not a Word document.");
}

// ---------------------------------------------------------------------------------------
// Package parts
// ---------------------------------------------------------------------------------------

type Relationship = { type: string; target: string; external: boolean };

function joinPath(base: string, target: string): string {
	if (target.startsWith("/")) return target.slice(1);
	const out = base === "" ? [] : base.split("/").filter(Boolean);
	for (const segment of target.split("/")) {
		if (segment === "..") out.pop();
		else if (segment !== "." && segment !== "") out.push(segment);
	}
	return out.join("/");
}

async function readText(
	zip: ZipArchive,
	path: string,
	max = MAX_SMALL_PART,
): Promise<string | null> {
	const bytes = await zip.read(path, max);
	return bytes === null ? null : decodeXml(bytes);
}

async function readRelationships(
	zip: ZipArchive,
	path: string,
): Promise<Map<string, Relationship>> {
	const rels = new Map<string, Relationship>();
	const xml = await readText(zip, path);
	if (xml === null) return rels;
	readXml(xml, {
		open(name, attribs) {
			if (name !== "Relationship") return;
			const id = attribs.Id;
			if (id === undefined) return;
			if (rels.size >= MAX_RELATIONSHIPS) {
				throw new ParseFailure(
					"too-big",
					"This file has more links than Speeedy can open.",
				);
			}
			rels.set(id, {
				type: attribs.Type ?? "",
				target: attribs.Target ?? "",
				external: attribs.TargetMode?.toLowerCase() === "external",
			});
		},
	});
	return rels;
}

const firstOfType = (
	rels: Map<string, Relationship>,
	suffix: string,
): Relationship | undefined => {
	for (const rel of rels.values()) {
		if (rel.type.endsWith(suffix) && !rel.external) return rel;
	}
	return undefined;
};

// ---------------------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------------------

type StyleKind = "quote" | "code" | "caption";

type StyleDef = {
	name: string;
	basedOn: string | null;
	outline: number | null;
	numId: number | null;
	ilvl: number | null;
	bold: boolean | null;
	italic: boolean | null;
};

type StyleInfo = {
	heading: number;
	kind: StyleKind | null;
	numId: number | null;
	ilvl: number | null;
	bold: boolean;
	italic: boolean;
};

const NO_STYLE: StyleInfo = {
	heading: 0,
	kind: null,
	numId: null,
	ilvl: null,
	bold: false,
	italic: false,
};

const QUOTE_STYLES = new Set([
	"quote",
	"intensequote",
	"blockquotation",
	"blockquote",
	"blocktext",
	"quotations",
]);
const CODE_STYLES = new Set([
	"sourcecode",
	"code",
	"htmlpreformatted",
	"preformattedtext",
	"macrotext",
]);

type Classified = { heading: number; kind: StyleKind | null } | null;

/** Name a style by what Word and LibreOffice call it, compared without spaces or case. */
function classify(raw: string): Classified {
	const name = raw.toLowerCase().replace(/[\s_-]+/g, "");
	const heading = /^heading([1-9])$/.exec(name);
	if (heading?.[1]) {
		const level = Number(heading[1]);
		return level <= 6 ? { heading: level, kind: null } : null;
	}
	if (name === "title") return { heading: 1, kind: null };
	if (QUOTE_STYLES.has(name)) return { heading: 0, kind: "quote" };
	if (CODE_STYLES.has(name)) return { heading: 0, kind: "code" };
	if (name === "caption") return { heading: 0, kind: "caption" };
	return null;
}

const toggle = (attribs: Record<string, string>): boolean => {
	const value = attribs["w:val"]?.toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
};

const toInt = (value: string | undefined): number | null => {
	if (value === undefined) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
};

class Styles {
	private readonly defs = new Map<string, StyleDef>();
	private readonly resolved = new Map<string, StyleInfo>();

	add(id: string, def: StyleDef): void {
		if (this.defs.size >= MAX_STYLES) {
			throw new ParseFailure(
				"too-big",
				"This file has more styles than Speeedy can open.",
			);
		}
		this.defs.set(id, def);
	}

	get(id: string): StyleInfo {
		const known = this.resolved.get(id);
		if (known) return known;
		const info = this.resolve(id);
		this.resolved.set(id, info);
		return info;
	}

	private resolve(startId: string): StyleInfo {
		const info: StyleInfo = { ...NO_STYLE };
		let classified = false;
		let bold: boolean | null = null;
		let italic: boolean | null = null;
		let id: string | null = startId;
		const seen = new Set<string>();
		for (
			let step = 0;
			id !== null && step < MAX_STYLE_CHAIN && !seen.has(id);
			step++
		) {
			seen.add(id);
			const def = this.defs.get(id);
			if (!classified) {
				const found = (def ? classify(def.name) : null) ?? classify(id);
				if (found) {
					info.heading = found.heading;
					info.kind = found.kind;
					classified = true;
				} else if (def && def.outline !== null) {
					if (def.outline >= 0 && def.outline <= 5) {
						info.heading = def.outline + 1;
					}
					classified = true;
				}
			}
			if (def) {
				if (info.numId === null && def.numId !== null) info.numId = def.numId;
				if (info.ilvl === null && def.ilvl !== null) info.ilvl = def.ilvl;
				if (bold === null) bold = def.bold;
				if (italic === null) italic = def.italic;
			}
			id = def?.basedOn ?? null;
		}
		const name = (this.defs.get(startId)?.name ?? startId).toLowerCase();
		info.bold = bold ?? name === "strong";
		info.italic = italic ?? name === "emphasis";
		return info;
	}
}

function readStyles(xml: string): Styles {
	const styles = new Styles();
	let id: string | null = null;
	let def: StyleDef | null = null;
	let inPPr = false;
	let inRPr = false;
	let inNumPr = false;
	let skip = 0;
	readXml(xml, {
		open(name, a) {
			if (skip > 0) {
				skip++;
				return;
			}
			if (name === "w:tblStylePr") {
				skip = 1;
				return;
			}
			if (name === "w:style") {
				id = a["w:styleId"] ?? null;
				def = {
					name: "",
					basedOn: null,
					outline: null,
					numId: null,
					ilvl: null,
					bold: null,
					italic: null,
				};
				return;
			}
			if (def === null) return;
			if (name === "w:name") def.name = a["w:val"] ?? "";
			else if (name === "w:basedOn") def.basedOn = a["w:val"] ?? null;
			else if (name === "w:pPr") inPPr = true;
			else if (name === "w:rPr") inRPr = true;
			else if (name === "w:numPr" && inPPr) inNumPr = true;
			else if (name === "w:outlineLvl" && inPPr)
				def.outline = toInt(a["w:val"]);
			else if (name === "w:numId" && inNumPr) def.numId = toInt(a["w:val"]);
			else if (name === "w:ilvl" && inNumPr) def.ilvl = toInt(a["w:val"]);
			else if (name === "w:b" && inRPr) def.bold = toggle(a);
			else if (name === "w:i" && inRPr) def.italic = toggle(a);
		},
		close(name) {
			if (skip > 0) {
				skip--;
				return;
			}
			if (name === "w:style") {
				if (id !== null && def !== null) styles.add(id, def);
				id = null;
				def = null;
			} else if (name === "w:pPr") inPPr = false;
			else if (name === "w:rPr") inRPr = false;
			else if (name === "w:numPr") inNumPr = false;
		},
	});
	return styles;
}

// ---------------------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------------------

class Numbering {
	readonly abstracts = new Map<number, string[]>();
	readonly nums = new Map<number, number>();

	/** The number format of a list level (`bullet`, `decimal`, `none`, ...), if the file says. */
	format(numId: number, level: number): string | undefined {
		const abstract = this.nums.get(numId);
		return abstract === undefined
			? undefined
			: this.abstracts.get(abstract)?.[level];
	}
}

function readNumbering(xml: string): Numbering {
	const numbering = new Numbering();
	let abstractId: number | null = null;
	let formats: string[] = [];
	let level: number | null = null;
	let numId: number | null = null;
	const check = () => {
		if (numbering.abstracts.size + numbering.nums.size > MAX_LISTS) {
			throw new ParseFailure(
				"too-big",
				"This file has more lists than Speeedy can open.",
			);
		}
	};
	readXml(xml, {
		open(name, a) {
			if (name === "w:abstractNum") {
				abstractId = toInt(a["w:abstractNumId"]);
				formats = [];
			} else if (name === "w:lvl" && abstractId !== null && numId === null) {
				level = toInt(a["w:ilvl"]);
			} else if (name === "w:numFmt" && level !== null && abstractId !== null) {
				if (level >= 0 && level < 16) formats[level] = a["w:val"] ?? "";
			} else if (name === "w:num") {
				numId = toInt(a["w:numId"]);
			} else if (name === "w:abstractNumId" && numId !== null) {
				const target = toInt(a["w:val"]);
				if (target !== null) numbering.nums.set(numId, target);
				check();
			}
		},
		close(name) {
			if (name === "w:lvl") level = null;
			else if (name === "w:abstractNum") {
				if (abstractId !== null) numbering.abstracts.set(abstractId, formats);
				abstractId = null;
				check();
			} else if (name === "w:num") numId = null;
		},
	});
	return numbering;
}

// ---------------------------------------------------------------------------------------
// Core properties (title)
// ---------------------------------------------------------------------------------------

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

function makeBlock(ctx: Ctx, text: string, spans: Span[]): Block {
	switch (ctx.kind) {
		case "heading":
			return { kind: "heading", level: ctx.level, text, spans };
		case "list-item":
			return {
				kind: "list-item",
				depth: ctx.depth,
				ordered: ctx.ordered,
				text,
				spans,
			};
		case "quote":
			return { kind: "quote", text, spans };
		case "code":
			return { kind: "code", text, spans };
		case "caption":
			return { kind: "caption", text, spans };
		case "table-text":
			return { kind: "table-text", text, spans };
		default:
			return { kind: "paragraph", text, spans };
	}
}

type Field = { instruction: string; result: boolean; href: string | null };

type Drawing = {
	alt: string;
	title: string;
	pictureAlt: string;
	width: number;
	height: number;
	picture: boolean;
};

const NEEDS_COLLAPSE = /[^\S ]| {2}/;

/** Names whose whole subtree is dropped: old values, copies and content that is not body text. */
function isSkipped(name: string): boolean {
	return (
		name === "w:del" ||
		name === "w:moveFrom" ||
		name === "mc:Fallback" ||
		name === "w:txbxContent" ||
		name === "w:delText" ||
		name.endsWith("Change")
	);
}

/** The target of a `HYPERLINK` field instruction, or null for other fields and internal links. */
function fieldHref(instruction: string): string | null {
	const match =
		/^\s*HYPERLINK\s+((?:\\[a-z]\s+(?:"[^"]*"\s+)?)*)(?:"([^"]*)"|(\S+))/i.exec(
			instruction.slice(0, MAX_INSTRUCTION),
		);
	if (!match) return null;
	if (/\\l\b/i.test(match[1] ?? "")) return null;
	const target = match[2] ?? match[3];
	return target === undefined ? null : safeHref(target);
}

function pixels(emu: string | undefined): number {
	const value = toInt(emu);
	if (value === null) return 0;
	const px = Math.round(value / EMU_PER_PIXEL);
	return px >= 1 && px <= MAX_IMAGE_SIZE ? px : 0;
}

type BodyEnv = {
	styles: Styles;
	numbering: Numbering;
	links: Map<string, string>;
};

function readBody(xml: string, env: BodyEnv, sink: BlockSink): void {
	// The text being built: one paragraph, or one table row.
	let parts: string[] = [];
	let length = 0;
	let lastSpace = false;
	let spans: Span[] = [];
	let tailStrong: Span | null = null;
	let tailEmphasis: Span | null = null;
	let tailLink: Span | null = null;
	let pending: Block[] = [];

	// Where we are.
	let skip = 0;
	let tableDepth = 0;
	let inParagraph = 0;
	let inPPr = false;
	let inNumPr = false;
	let inRun = 0;
	let inRPr = false;
	let inText = false;
	let inInstruction = false;

	// The paragraph.
	let style: string | null = null;
	let listId: number | null = null;
	let listLevel: number | null = null;
	let current: Ctx = PARAGRAPH;

	// The run.
	let bold: boolean | null = null;
	let italic: boolean | null = null;
	let boldCs = false;
	let italicCs = false;
	let rtl = false;
	let hidden = false;
	let runStyle: string | null = null;

	const hrefs: (string | null)[] = [];
	const fields: Field[] = [];
	let uncountedFields = 0;

	let drawing = 0;
	let draw: Drawing = emptyDrawing();
	let vmlAlt = "";

	function emptyDrawing(): Drawing {
		return {
			alt: "",
			title: "",
			pictureAlt: "",
			width: 0,
			height: 0,
			picture: false,
		};
	}

	const isCode = (): boolean => current.kind === "code" && tableDepth === 0;

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
			sink.push(
				makeBlock(ctx, text, ctx.kind === "code" ? [] : tidySpans(spans, text)),
			);
		}
		reset();
		for (const image of queued) sink.push(image);
	};

	const separate = (): void => {
		if (length > 0 && !lastSpace) append(" ", false);
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

	const activeHref = (): string | null => {
		const direct = hrefs[hrefs.length - 1];
		if (direct) return direct;
		for (let i = fields.length - 1; i >= 0; i--) {
			const field = fields[i];
			if (field?.result && field.href) return field.href;
		}
		return null;
	};

	const runStyleInfo = (): StyleInfo =>
		runStyle === null ? NO_STYLE : env.styles.get(runStyle);

	function append(data: string, plain: boolean): void {
		if (data === "") return;
		const clean = normalizeText(data);
		if (clean === "") return;
		let chunk: string;
		if (plain) {
			chunk = clean;
			lastSpace = false;
		} else {
			chunk = NEEDS_COLLAPSE.test(clean) ? clean.replace(/\s+/g, " ") : clean;
			if (chunk.charCodeAt(0) === 32 && (length === 0 || lastSpace)) {
				chunk = chunk.slice(1);
			}
			if (chunk === "") return;
			lastSpace = chunk.charCodeAt(chunk.length - 1) === 32;
		}
		const start = length;
		parts.push(chunk);
		length += chunk.length;
		if (plain) return;
		const info = runStyleInfo();
		const strong = bold ?? ((rtl && boldCs) || info.bold);
		const emphasis = italic ?? ((rtl && italicCs) || info.italic);
		if (strong) tailStrong = mark(tailStrong, start, length, "strong", null);
		if (emphasis) {
			tailEmphasis = mark(tailEmphasis, start, length, "emphasis", null);
		}
		const href = activeHref();
		if (href !== null) tailLink = mark(tailLink, start, length, "link", href);
	}

	const addText = (data: string): void => {
		if (hidden) return;
		append(data, isCode());
	};

	const resolveContext = (): Ctx => {
		const info = style === null ? NO_STYLE : env.styles.get(style);
		if (info.heading > 0) {
			return {
				kind: "heading",
				level: Math.min(info.heading, 6) as 1 | 2 | 3 | 4 | 5 | 6,
			};
		}
		const numId = listId ?? info.numId;
		if (numId !== null && numId !== 0) {
			const level = Math.min(
				Math.max(listLevel ?? info.ilvl ?? 0, 0),
				MAX_LIST_DEPTH,
			);
			const format = env.numbering.format(numId, level);
			if (format !== "none") {
				return {
					kind: "list-item",
					depth: level,
					ordered: format !== undefined && format !== "bullet",
				};
			}
		}
		if (info.kind !== null) return { kind: info.kind };
		return PARAGRAPH;
	};

	const queueImage = (alt: string, width: number, height: number): void => {
		const image: Block = {
			kind: "image-placeholder",
			alt: clip(tidyLine(normalizeText(alt)), MAX_ALT),
		};
		if (width > 0) image.width = width;
		if (height > 0) image.height = height;
		pending.push(image);
	};

	const beginRun = (): void => {
		bold = null;
		italic = null;
		boldCs = false;
		italicCs = false;
		rtl = false;
		hidden = false;
		runStyle = null;
	};

	const endField = (): void => {
		if (uncountedFields > 0) uncountedFields--;
		else fields.pop();
	};

	const open = (name: string, a: Record<string, string>): void => {
		if (skip > 0) {
			skip++;
			return;
		}
		if (isSkipped(name)) {
			skip = 1;
			return;
		}
		switch (name) {
			case "w:p":
				if (tableDepth === 0 && (length > 0 || pending.length > 0)) {
					flush(current);
				}
				inParagraph++;
				style = null;
				listId = null;
				listLevel = null;
				current = PARAGRAPH;
				break;
			case "w:pPr":
				if (inParagraph > 0 && inRun === 0) inPPr = true;
				break;
			case "w:pStyle":
				if (inPPr) style = a["w:val"] ?? null;
				break;
			case "w:numPr":
				if (inPPr) inNumPr = true;
				break;
			case "w:numId":
				if (inNumPr) listId = toInt(a["w:val"]);
				break;
			case "w:ilvl":
				if (inNumPr) listLevel = toInt(a["w:val"]);
				break;
			case "w:r":
				inRun++;
				beginRun();
				break;
			case "w:rPr":
				if (inRun > 0 && !inPPr) inRPr = true;
				break;
			case "w:b":
				if (inRPr) bold = toggle(a);
				break;
			case "w:i":
				if (inRPr) italic = toggle(a);
				break;
			case "w:bCs":
				if (inRPr) boldCs = toggle(a);
				break;
			case "w:iCs":
				if (inRPr) italicCs = toggle(a);
				break;
			case "w:rtl":
				if (inRPr) rtl = toggle(a);
				break;
			case "w:vanish":
				if (inRPr) hidden = toggle(a);
				break;
			case "w:rStyle":
				if (inRPr) runStyle = a["w:val"] ?? null;
				break;
			case "w:t":
				if (inRun > 0 && inParagraph > 0) inText = true;
				break;
			case "w:instrText":
				if (fields.length > 0 && uncountedFields === 0) inInstruction = true;
				break;
			case "w:tab":
				if (inRun > 0 && !inRPr) addText(isCode() ? "\t" : " ");
				break;
			case "w:br":
			case "w:cr":
				if (inRun > 0) addText(isCode() ? "\n" : " ");
				break;
			case "w:noBreakHyphen":
				if (inRun > 0) addText("-");
				break;
			case "w:hyperlink": {
				const id = a["r:id"];
				hrefs.push(id === undefined ? null : (env.links.get(id) ?? null));
				break;
			}
			case "w:fldSimple": {
				const instruction = a["w:instr"] ?? "";
				fields.push({
					instruction,
					result: true,
					href: fieldHref(instruction),
				});
				break;
			}
			case "w:fldChar": {
				const type = a["w:fldCharType"];
				if (type === "begin") {
					if (fields.length >= MAX_FIELD_DEPTH) uncountedFields++;
					else fields.push({ instruction: "", result: false, href: null });
				} else if (type === "separate") {
					const field = fields[fields.length - 1];
					if (field && uncountedFields === 0) {
						field.result = true;
						field.href = fieldHref(field.instruction);
					}
				} else if (type === "end") {
					endField();
				}
				break;
			}
			case "w:tbl":
				tableDepth++;
				break;
			case "w:drawing":
				drawing++;
				draw = emptyDrawing();
				break;
			case "wp:docPr":
				if (drawing > 0) {
					draw.alt = a.descr ?? "";
					draw.title = a.title ?? "";
				}
				break;
			case "pic:cNvPr":
				if (drawing > 0) draw.pictureAlt = a.descr ?? "";
				break;
			case "wp:extent":
				if (drawing > 0 && draw.width === 0) {
					draw.width = pixels(a.cx);
					draw.height = pixels(a.cy);
				}
				break;
			case "a:blip":
				if (drawing > 0) draw.picture = true;
				break;
			case "w:pict":
			case "w:object":
				vmlAlt = "";
				break;
			case "v:shape":
			case "v:rect":
				if (a.alt) vmlAlt = a.alt;
				break;
			case "v:imagedata":
				if (drawing === 0) queueImage(vmlAlt || (a["o:title"] ?? ""), 0, 0);
				break;
			default:
				break;
		}
	};

	const close = (name: string): void => {
		if (skip > 0) {
			skip--;
			return;
		}
		switch (name) {
			case "w:p":
				if (inParagraph > 0) inParagraph--;
				if (tableDepth > 0) separate();
				else flush(current);
				break;
			case "w:pPr":
				if (inPPr) {
					inPPr = false;
					current = resolveContext();
				}
				break;
			case "w:numPr":
				inNumPr = false;
				break;
			case "w:r":
				if (inRun > 0) inRun--;
				inText = false;
				break;
			case "w:rPr":
				inRPr = false;
				break;
			case "w:t":
				inText = false;
				break;
			case "w:instrText":
				inInstruction = false;
				break;
			case "w:hyperlink":
				hrefs.pop();
				break;
			case "w:fldSimple":
				fields.pop();
				break;
			case "w:tc":
				if (tableDepth > 0) separate();
				break;
			case "w:tr":
				if (tableDepth === 1) flush(TABLE_ROW);
				else if (tableDepth > 1) separate();
				break;
			case "w:tbl":
				if (tableDepth > 0) tableDepth--;
				break;
			case "w:drawing":
				if (drawing > 0) drawing--;
				if (draw.picture) {
					queueImage(
						draw.alt || draw.pictureAlt || draw.title,
						draw.width,
						draw.height,
					);
				}
				draw = emptyDrawing();
				break;
			default:
				break;
		}
	};

	readXml(xml, {
		open,
		close,
		text(data) {
			if (skip > 0) return;
			if (inText) addText(data);
			else if (inInstruction) {
				const field = fields[fields.length - 1];
				if (field && field.instruction.length < MAX_INSTRUCTION) {
					field.instruction += data;
				}
			}
		},
	});
	flush(tableDepth > 0 ? TABLE_ROW : current);
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

/**
 * Turn DOCX bytes into blocks. Throws `ParseFailure` for a protected, corrupt or oversized
 * file; the caller turns that into a typed `ParseError`.
 */
export async function docxToBlocks(
	bytes: Uint8Array,
	sink: BlockSink,
): Promise<DocxMeta> {
	if (!isZip(bytes)) throw notAPackage(bytes);
	const zip = openZip(bytes);

	const rootRels = await readRelationships(zip, "_rels/.rels");
	const mainPath = joinPath(
		"",
		firstOfType(rootRels, "/officeDocument")?.target ?? DEFAULT_MAIN,
	);
	const main = await zip.read(mainPath, MAX_MAIN_PART);
	if (main === null) throw unsupported("This file is not a Word document.");

	const slash = mainPath.lastIndexOf("/");
	const directory = slash < 0 ? "" : mainPath.slice(0, slash + 1);
	const fileName = mainPath.slice(slash + 1);
	const rels = await readRelationships(
		zip,
		`${directory}_rels/${fileName}.rels`,
	);
	const partFor = (suffix: string, fallback: string): string => {
		const rel = firstOfType(rels, suffix);
		return joinPath(directory, rel?.target ?? fallback);
	};

	const stylesXml = await readText(zip, partFor("/styles", "styles.xml"));
	const numberingXml = await readText(
		zip,
		partFor("/numbering", "numbering.xml"),
	);
	const links = new Map<string, string>();
	for (const [id, rel] of rels) {
		if (rel.external && rel.type.endsWith("/hyperlink")) {
			const href = safeHref(rel.target);
			if (href !== null) links.set(id, href);
		}
	}

	const env: BodyEnv = {
		styles: stylesXml === null ? new Styles() : readStyles(stylesXml),
		numbering:
			numberingXml === null ? new Numbering() : readNumbering(numberingXml),
		links,
	};
	readBody(decodeXml(main), env, sink);

	const coreRel = firstOfType(rootRels, "/core-properties");
	const coreXml = await readText(
		zip,
		joinPath("", coreRel?.target ?? "docProps/core.xml"),
	);
	return { title: coreXml === null ? null : readTitle(coreXml) };
}
