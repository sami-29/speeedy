import type { Block, Span } from "@speeedy/contracts";
import { clip, normalizeText, tidyLine } from "./clean";
import { decodeWindows1252 } from "./cp1252";
import { fieldHref } from "./docx";
import { tidySpans } from "./html";
import { brokenTextFailure, SuspectCounter } from "./suspect";
import { type BlockSink, ParseFailure } from "./types";

/**
 * RTF to Document blocks. Hand-written, no DOM and no dependency, so it runs in a Web Worker.
 *
 * RTF is a stream of groups (`{ ... }`), control words (`\name`, an optional number, one
 * optional space that belongs to the word) and text. The parser reads the bytes once, left to
 * right, keeping a stack of group states, so the work is linear in the file size.
 *
 * What it reads:
 * - Text, with `\uN` (and the `\ucN` fallback characters that follow it), `\'hh` bytes decoded
 *   through the code page of the current font (its `\cpgN`, else its `\fcharsetN`, else the
 *   document's `\ansicpgN`), and raw bytes above 0x7f the same way. Double-byte code pages
 *   (Shift JIS, GBK, Big5, Korean) work because escaped bytes are decoded together.
 * - Paragraphs (`\par`), table cells (`\cell`, table-text blocks), list items (`\lsN` with the
 *   label in `\listtext`), headings (a style named "heading N" or an outline level 0 to 5) and
 *   quotes (a style named Quote), bold and italic runs (also the complex-script `\ab` and `\ai`
 *   while a right-to-left run is active), and HYPERLINK fields (as link spans).
 * - The document title (`\info` then `\title`).
 *
 * What it leaves out, on purpose: font, colour, style and list tables, headers, footers,
 * footnotes, comments, text boxes and any group marked `\*` that it does not know. A picture
 * becomes an image placeholder with no alt text and its data is skipped, `\binN` raw data
 * included.
 *
 * Hostile input:
 * - Group depth is capped (MAX_DEPTH), so a million `{` is a typed error, not a stack overflow.
 * - A control word's letters and number are scanned once and only the first 32 letters are
 *   kept; numbers stop accumulating after nine digits.
 * - Tables the file can grow (fonts, styles) and the text the file can make us hold (a field
 *   instruction, a title, a list label, a style name) are capped.
 * - Spans per block are capped; blocks are capped by the BlockSink.
 * - A fallback skip (`\uc`) ends at the next brace, so it cannot swallow the file.
 * - Everything after the closing brace of the document is ignored.
 */

export type RtfMeta = { title: string | null };

const MAX_DEPTH = 500;
const MAX_FONTS = 10_000;
const MAX_STYLES = 10_000;
const MAX_CAPTURE = 4000;
const MAX_LISTTEXT = 16;
const MAX_TITLE = 200;
const MAX_SPANS = 50_000;
const MAX_LIST_DEPTH = 8;
const MAX_WORD = 32;
const PENDING_SIZE = 4096;

const unsupported = (why = "Speeedy could not read this file."): ParseFailure =>
	new ParseFailure("unsupported", why);

/** The offset of the opening brace of `{\rtf`, or -1. A byte-order mark and blank space may come first. */
function headerAt(bytes: Uint8Array): number {
	let at = 0;
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) at = 3;
	while (
		at < 64 &&
		(bytes[at] === 0x20 ||
			bytes[at] === 0x09 ||
			bytes[at] === 0x0a ||
			bytes[at] === 0x0d)
	) {
		at++;
	}
	if (
		bytes[at] !== 0x7b ||
		bytes[at + 1] !== 0x5c ||
		bytes[at + 2] !== 0x72 ||
		bytes[at + 3] !== 0x74 ||
		bytes[at + 4] !== 0x66
	) {
		return -1;
	}
	const next = bytes[at + 5];
	if (next === undefined) return -1;
	const letter =
		(next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a);
	return letter ? -1 : at;
}

/** Does the file open with an RTF header? */
export function isRtf(bytes: Uint8Array): boolean {
	return headerAt(bytes) >= 0;
}

// ---------------------------------------------------------------------------------------
// Code pages
// ---------------------------------------------------------------------------------------

/**
 * `\fcharsetN` to a Windows code page. These are the Windows character-set constants
 * (LOGFONT `lfCharSet`) and their code pages. 0 (ANSI) and 1 (default) mean "the document's
 * code page", so they are not listed.
 */
const CHARSET_CODE_PAGE: Record<number, number> = {
	77: 10000,
	128: 932,
	129: 949,
	134: 936,
	136: 950,
	161: 1253,
	162: 1254,
	163: 1258,
	177: 1255,
	178: 1256,
	186: 1257,
	204: 1251,
	222: 874,
	238: 1250,
};

function codePageLabel(codePage: number): string {
	if (codePage >= 1250 && codePage <= 1258) return `windows-${codePage}`;
	switch (codePage) {
		case 874:
			return "windows-874";
		case 932:
			return "shift_jis";
		case 936:
			return "gbk";
		case 949:
			return "euc-kr";
		case 950:
			return "big5";
		case 10000:
			return "macintosh";
		case 65001:
			return "utf-8";
		default:
			// 437, 850 and the rest have no TextDecoder label; Windows-1252 is the nearest.
			return "windows-1252";
	}
}

const decoders = new Map<string, TextDecoder>();

/** Decode bytes in a code page. `stream` keeps a half-read double-byte pair for the next call. */
function decodeRun(label: string, bytes: Uint8Array, stream: boolean): string {
	if (label === "windows-1252") return decodeWindows1252(bytes);
	return decoderFor(label).decode(bytes, { stream });
}

function decoderFor(label: string): TextDecoder {
	let decoder = decoders.get(label);
	if (!decoder) {
		try {
			decoder = new TextDecoder(label);
		} catch {
			decoder = new TextDecoder("windows-1252");
		}
		decoders.set(label, decoder);
	}
	return decoder;
}

// ---------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------

/** Groups whose whole content is not body text. */
const SKIP_DESTINATIONS = new Set([
	"colortbl",
	"listtable",
	"listoverridetable",
	"revtbl",
	"rsidtbl",
	"generator",
	"themedata",
	"colorschememapping",
	"latentstyles",
	"xmlnstbl",
	"filetbl",
	"header",
	"headerl",
	"headerr",
	"headerf",
	"footer",
	"footerl",
	"footerr",
	"footerf",
	"footnote",
	"annotation",
	"atnauthor",
	"atnid",
	"atnparent",
	"atrfstart",
	"atrfend",
	"atntime",
	"bkmkstart",
	"bkmkend",
	"xe",
	"tc",
	"tcn",
	"txe",
	"rxe",
	"datafield",
	"falt",
	"panose",
	"fname",
	"ftnsep",
	"ftnsepc",
	"aftnsep",
	"aftnsepc",
	"ftncn",
	"aftncn",
	"object",
	"objdata",
	"shpinst",
	"shprslt",
	"shptxt",
	"pntext",
	"pnseclvl",
	"pgdsctbl",
	"protusertbl",
	"userprops",
	"wgrffmtfilter",
	"formfield",
	"nonshppict",
	"blipuid",
	"mmathpr",
	"background",
	"passwordhash",
	"docvar",
	"fchars",
	"lchars",
]);

/** `\*` destinations that are still read. Any other `\*` group is skipped. */
const READ_STAR = new Set(["fldinst", "listtext", "shppict", "ud"]);

const SYMBOLS: Record<string, string> = {
	emdash: "—",
	endash: "–",
	emspace: " ",
	enspace: " ",
	qmspace: " ",
	bullet: "•",
	lquote: "‘",
	rquote: "’",
	ldblquote: "“",
	rdblquote: "”",
	zwj: "‍",
	zwnj: "‌",
	tab: "\t",
	line: " ",
};

// What a group captures instead of putting it in the paragraph.
const CAP_NONE = 0;
const CAP_LISTTEXT = 1;
const CAP_FLDINST = 2;
const CAP_TITLE = 3;
const CAP_STYLE = 4;

// Named groups that change how their children are read.
const DEST_NONE = 0;
const DEST_FONTTBL = 1;
const DEST_STYLESHEET = 2;
const DEST_INFO = 3;
const DEST_STYLEDEF = 4;

type StyleDef = { id: number; outline: number };
type StyleInfo = { heading: number; quote: boolean };

type State = {
	skip: boolean;
	cap: number;
	dest: number;
	uc: number;
	font: number;
	b: boolean;
	i: boolean;
	ab: boolean;
	ai: boolean;
	cs: boolean;
	href: string | null;
	fieldHref: string | null;
	star: boolean;
	/** Inside `\upr`, where the ANSI copy of a Unicode-aware value is kept and skipped. */
	upr: boolean;
	style: StyleDef | null;
};

type Font = { charset: number; cpg: number };

const ORDERED_LABEL = /^[0-9A-Za-z]{1,5}[.)]$/;
const HEADING_NAME = /^heading\s*([1-9])$/i;
const QUOTE_NAME = /^(?:quote|block quote|block text|intense quote)$/i;

/** Collects one paragraph's text and inline spans. */
class Paragraph {
	parts: string[] = [];
	length = 0;
	images = 0;
	private lastSpace = true;
	private spans: Span[] = [];
	private strong = -1;
	private emphasis = -1;
	private link = -1;
	private href: string | null = null;

	private close(kind: "strong" | "emphasis", from: number): void {
		if (this.spans.length < MAX_SPANS) {
			this.spans.push({ kind, start: from, end: this.length });
		}
	}

	private sync(bold: boolean, italic: boolean, href: string | null): void {
		if (bold) {
			if (this.strong < 0) this.strong = this.length;
		} else if (this.strong >= 0) {
			this.close("strong", this.strong);
			this.strong = -1;
		}
		if (italic) {
			if (this.emphasis < 0) this.emphasis = this.length;
		} else if (this.emphasis >= 0) {
			this.close("emphasis", this.emphasis);
			this.emphasis = -1;
		}
		if (href !== this.href) {
			this.closeLink();
			this.href = href;
			this.link = href === null ? -1 : this.length;
		}
	}

	private closeLink(): void {
		if (this.link >= 0 && this.href !== null && this.spans.length < MAX_SPANS) {
			this.spans.push({
				kind: "link",
				start: this.link,
				end: this.length,
				href: this.href,
			});
		}
		this.link = -1;
	}

	/** Add text, collapsing runs of white space and dropping it at the start. */
	append(
		raw: string,
		bold: boolean,
		italic: boolean,
		href: string | null,
	): void {
		const text = normalizeText(raw);
		let segment = -1;
		const flush = (end: number) => {
			this.sync(bold, italic, href);
			this.parts.push(text.slice(segment, end));
			this.length += end - segment;
			this.lastSpace = false;
			segment = -1;
		};
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (code === 32 || code === 9 || code === 10) {
				if (segment >= 0) flush(i);
				if (!this.lastSpace) {
					this.parts.push(" ");
					this.length++;
					this.lastSpace = true;
				}
			} else if (segment < 0) {
				segment = i;
			}
		}
		if (segment >= 0) flush(text.length);
	}

	/** The finished text and spans, or null when the paragraph holds no text. The paragraph is reset. */
	take(): { text: string; spans: Span[] } | null {
		this.sync(false, false, null);
		let text = this.parts.join("");
		if (text.endsWith(" ")) text = text.slice(0, -1);
		const spans = this.spans;
		this.parts = [];
		this.length = 0;
		this.lastSpace = true;
		this.spans = [];
		this.strong = -1;
		this.emphasis = -1;
		this.link = -1;
		this.href = null;
		if (text === "") return null;
		return { text, spans: tidySpans(spans, text) };
	}
}

export function rtfToBlocks(bytes: Uint8Array, sink: BlockSink): RtfMeta {
	const header = headerAt(bytes);
	if (header < 0) throw unsupported("This file is not an RTF document.");
	const n = bytes.length;
	const stats = new SuspectCounter();
	const ascii = new TextDecoder("utf-8");

	// Document-wide tables and settings.
	let codePage = 1252;
	let defaultFont = -1;
	const fonts = new Map<number, Font>();
	const styles = new Map<number, StyleInfo>();
	let title: string | null = null;

	// Paragraph properties persist across \par until \pard.
	const props = { style: -1, intbl: false, ls: 0, ilvl: 0, outline: -1 };
	const paragraph = new Paragraph();
	let listText = "";
	let listOrdered = false;
	let fieldInstruction = "";
	let titleText = "";
	let styleName = "";

	let state: State = {
		skip: false,
		cap: CAP_NONE,
		dest: DEST_NONE,
		uc: 1,
		font: -1,
		b: false,
		i: false,
		ab: false,
		ai: false,
		cs: false,
		href: null,
		fieldHref: null,
		star: false,
		upr: false,
		style: null,
	};
	const stack: State[] = [];
	let skipFallback = 0;

	// Escaped and raw bytes above 0x7f wait here so a double-byte pair is decoded whole.
	const pending = new Uint8Array(PENDING_SIZE);
	let pendingLength = 0;

	const append = (text: string, from: "body" | "capture"): void => {
		if (from === "body") {
			stats.add(text);
			paragraph.append(
				text,
				state.cs ? state.ab : state.b,
				state.cs ? state.ai : state.i,
				state.href,
			);
			return;
		}
		switch (state.cap) {
			case CAP_LISTTEXT:
				if (listText.length < MAX_LISTTEXT)
					listText += text.slice(0, MAX_LISTTEXT - listText.length);
				break;
			case CAP_FLDINST:
				if (fieldInstruction.length < MAX_CAPTURE)
					fieldInstruction += text.slice(
						0,
						MAX_CAPTURE - fieldInstruction.length,
					);
				break;
			case CAP_TITLE:
				if (titleText.length < MAX_CAPTURE)
					titleText += text.slice(0, MAX_CAPTURE - titleText.length);
				break;
			case CAP_STYLE:
				if (styleName.length < MAX_TITLE)
					styleName += text.slice(0, MAX_TITLE - styleName.length);
				break;
		}
	};

	/** Put text in the paragraph, or in whatever the current group captures. */
	const emit = (text: string): void => {
		if (state.skip || text === "") return;
		append(text, state.cap === CAP_NONE ? "body" : "capture");
	};

	/** A high surrogate from `\\uN` waits here for its low half in the next `\\uN`. */
	let highSurrogate = 0;

	const route = (text: string): void => {
		if (highSurrogate !== 0) {
			highSurrogate = 0;
			emit("\ufffd");
		}
		emit(text);
	};

	const unicode = (code: number): void => {
		const isHigh = code >= 0xd800 && code <= 0xdbff;
		const isLow = code >= 0xdc00 && code <= 0xdfff;
		if (isLow && highSurrogate !== 0) {
			const pair = String.fromCharCode(highSurrogate, code);
			highSurrogate = 0;
			emit(pair);
			return;
		}
		if (highSurrogate !== 0) {
			highSurrogate = 0;
			emit("\ufffd");
		}
		if (isHigh) highSurrogate = code;
		else emit(String.fromCharCode(code));
	};

	const labelForFont = (): string => {
		const font = fonts.get(state.font >= 0 ? state.font : defaultFont);
		let page = codePage;
		if (font) {
			const mapped = CHARSET_CODE_PAGE[font.charset];
			if (font.cpg > 0) page = font.cpg;
			else if (mapped !== undefined) page = mapped;
		}
		return codePageLabel(page);
	};

	const flushPending = (): void => {
		if (pendingLength === 0) return;
		const text = decodeRun(
			labelForFont(),
			pending.subarray(0, pendingLength),
			false,
		);
		pendingLength = 0;
		route(text);
	};

	const addPending = (byte: number): void => {
		if (state.skip) return;
		pending[pendingLength++] = byte;
		if (pendingLength === PENDING_SIZE) {
			const text = decodeRun(labelForFont(), pending, true);
			pendingLength = 0;
			route(text);
		}
	};

	const emitAscii = (from: number, to: number): void => {
		if (from >= to) return;
		flushPending();
		route(ascii.decode(bytes.subarray(from, to)));
	};

	const flushParagraph = (kind: "paragraph" | "table-text"): void => {
		const taken = paragraph.take();
		const images = paragraph.images;
		paragraph.images = 0;
		const ordered = listOrdered;
		listOrdered = false;
		if (taken) {
			const info = styles.get(props.style);
			const level =
				props.outline >= 0 && props.outline <= 5
					? props.outline + 1
					: (info?.heading ?? 0);
			let block: Block;
			if (kind === "table-text" || props.intbl) {
				block = { kind: "table-text", text: taken.text, spans: taken.spans };
			} else if (level > 0) {
				// A heading is bold by its style; a bold span over all of it says nothing.
				const spans = taken.spans.filter(
					(span) =>
						!(
							span.kind === "strong" &&
							span.start === 0 &&
							span.end === taken.text.length
						),
				);
				block = {
					kind: "heading",
					level: level as 1 | 2 | 3 | 4 | 5 | 6,
					text: taken.text,
					spans,
				};
			} else if (props.ls > 0) {
				block = {
					kind: "list-item",
					depth: Math.min(props.ilvl, MAX_LIST_DEPTH),
					ordered,
					text: taken.text,
					spans: taken.spans,
				};
			} else if (info?.quote) {
				block = { kind: "quote", text: taken.text, spans: taken.spans };
			} else {
				block = { kind: "paragraph", text: taken.text, spans: taken.spans };
			}
			sink.push(block);
		}
		for (let k = 0; k < images; k++) {
			sink.push({ kind: "image-placeholder", alt: "" });
		}
	};

	let i = header + 1;

	const finishCapture = (closing: State, parent: State): void => {
		switch (closing.cap) {
			case CAP_LISTTEXT:
				listOrdered = ORDERED_LABEL.test(listText.trim());
				listText = "";
				break;
			case CAP_FLDINST:
				if (!parent.skip) parent.fieldHref = fieldHref(fieldInstruction);
				fieldInstruction = "";
				break;
			case CAP_TITLE: {
				const value = clip(tidyLine(titleText), MAX_TITLE);
				if (title === null && value !== "") title = value;
				titleText = "";
				break;
			}
			case CAP_STYLE: {
				const def = closing.style;
				if (def && def.id >= 0 && styles.size < MAX_STYLES) {
					const name = styleName.replace(/;\s*$/, "").trim();
					const heading = HEADING_NAME.exec(name);
					let level = 0;
					if (heading?.[1]) level = Math.min(Number(heading[1]), 6);
					else if (def.outline >= 0 && def.outline <= 5)
						level = def.outline + 1;
					styles.set(def.id, { heading: level, quote: QUOTE_NAME.test(name) });
				}
				styleName = "";
				break;
			}
		}
	};

	const word = (name: string, param: number | null): void => {
		if (state.star) {
			state.star = false;
			if (!READ_STAR.has(name)) {
				state.skip = true;
				return;
			}
		}
		const live = !state.skip && state.cap === CAP_NONE;
		const symbol = SYMBOLS[name];
		if (symbol !== undefined) {
			route(symbol);
			return;
		}
		if (SKIP_DESTINATIONS.has(name)) {
			state.skip = true;
			return;
		}
		switch (name) {
			case "bin":
				if (param !== null && param > 0) i = Math.min(n, i + param);
				return;
			case "fonttbl":
				state.skip = true;
				state.dest = DEST_FONTTBL;
				return;
			case "stylesheet":
				state.skip = true;
				state.dest = DEST_STYLESHEET;
				return;
			case "info":
				state.skip = true;
				state.dest = DEST_INFO;
				return;
			case "upr":
				state.skip = true;
				state.upr = true;
				return;
			case "ud":
				// `\upr{ansi}{\*\ud{unicode}}`: the Unicode copy is the one to read.
				if (state.upr) {
					state.skip = false;
					state.upr = false;
				}
				return;
			case "title":
				if (state.dest === DEST_INFO && !state.upr) {
					state.skip = false;
					state.cap = CAP_TITLE;
					titleText = "";
				}
				return;
			case "pict":
				if (!state.skip) paragraph.images++;
				state.skip = true;
				return;
			case "fldinst":
				if (!state.skip) {
					state.cap = CAP_FLDINST;
					fieldInstruction = "";
				}
				return;
			case "fldrslt":
				if (!state.skip) state.href = state.fieldHref;
				return;
			case "listtext":
				if (!state.skip) {
					state.cap = CAP_LISTTEXT;
					listText = "";
				}
				return;
			case "ansicpg":
				if (param !== null && param > 0) codePage = param;
				return;
			case "mac":
				codePage = 10000;
				return;
			case "pc":
				codePage = 437;
				return;
			case "pca":
				codePage = 850;
				return;
			case "deff":
				if (param !== null) defaultFont = param;
				return;
			case "f":
				if (param === null) return;
				state.font = param;
				if (state.dest === DEST_FONTTBL && param >= 0 && !fonts.has(param)) {
					if (fonts.size < MAX_FONTS) fonts.set(param, { charset: -1, cpg: 0 });
				}
				return;
			case "fcharset": {
				const font = param === null ? undefined : fonts.get(state.font);
				if (state.dest === DEST_FONTTBL && font && param !== null) {
					font.charset = param;
				}
				return;
			}
			case "cpg": {
				const font = param === null ? undefined : fonts.get(state.font);
				if (state.dest === DEST_FONTTBL && font && param !== null) {
					font.cpg = param;
				}
				return;
			}
			case "uc":
				state.uc = param !== null && param > 0 ? param : 0;
				return;
			case "u":
				if (param !== null) {
					unicode((param < 0 ? param + 65536 : param) & 0xffff);
					skipFallback = state.uc;
				}
				return;
			case "par":
			case "sect":
				if (live) flushParagraph("paragraph");
				return;
			case "cell":
			case "nestcell":
				if (live) flushParagraph("table-text");
				return;
			case "row":
			case "nestrow":
				if (live) {
					flushParagraph("paragraph");
					props.intbl = false;
				}
				return;
			case "pard":
				if (live) {
					props.style = -1;
					props.intbl = false;
					props.ls = 0;
					props.ilvl = 0;
					props.outline = -1;
				}
				return;
			case "plain":
				state.b = false;
				state.i = false;
				state.ab = false;
				state.ai = false;
				return;
			case "s":
				if (param === null) return;
				if (state.style) state.style.id = param;
				else if (live) props.style = param;
				return;
			case "outlinelevel":
				if (param === null) return;
				if (state.style) state.style.outline = param;
				else if (live) props.outline = param;
				return;
			case "intbl":
				if (live) props.intbl = true;
				return;
			case "ls":
				if (live) props.ls = param !== null && param > 0 ? param : 0;
				return;
			case "ilvl":
				if (live) props.ilvl = param !== null && param > 0 ? param : 0;
				return;
			case "b":
				state.b = param !== 0;
				return;
			case "i":
				state.i = param !== 0;
				return;
			case "ab":
				state.ab = param !== 0;
				return;
			case "ai":
				state.ai = param !== 0;
				return;
			case "rtlch":
				state.cs = true;
				return;
			case "ltrch":
			case "loch":
			case "hich":
			case "dbch":
				state.cs = false;
				return;
		}
	};

	const hex = (code: number): number => {
		if (code >= 0x30 && code <= 0x39) return code - 0x30;
		if (code >= 0x41 && code <= 0x46) return code - 0x37;
		if (code >= 0x61 && code <= 0x66) return code - 0x57;
		return -1;
	};

	/** A control symbol that stands for one character counts against a pending fallback skip. */
	const symbolText = (text: string): void => {
		if (skipFallback > 0) {
			skipFallback--;
			return;
		}
		flushPending();
		route(text);
	};

	const isLetter = (code: number): boolean =>
		(code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);

	let closed = false;
	while (i < n && !closed) {
		const c = bytes[i] as number;

		if (c === 0x5c) {
			const d = bytes[i + 1];
			// \'hh: a byte in the current code page.
			if (d === 0x27) {
				const high = hex(bytes[i + 2] ?? 0);
				const low = hex(bytes[i + 3] ?? 0);
				if (high >= 0 && low >= 0) {
					i += 4;
					if (skipFallback > 0) skipFallback--;
					else addPending(high * 16 + low);
				} else {
					i += 2;
				}
				continue;
			}
			flushPending();
			if (d === undefined) {
				i++;
				continue;
			}
			if (isLetter(d)) {
				let j = i + 1;
				while (j < n && isLetter(bytes[j] as number)) j++;
				const letters = j - (i + 1);
				let name = "";
				if (letters <= MAX_WORD) {
					for (let k = i + 1; k < j; k++)
						name += String.fromCharCode(bytes[k] as number);
				}
				let param: number | null = null;
				let negative = false;
				if (
					bytes[j] === 0x2d &&
					j + 1 < n &&
					(bytes[j + 1] as number) >= 0x30 &&
					(bytes[j + 1] as number) <= 0x39
				) {
					negative = true;
					j++;
				}
				if (
					j < n &&
					(bytes[j] as number) >= 0x30 &&
					(bytes[j] as number) <= 0x39
				) {
					let value = 0;
					let digits = 0;
					while (
						j < n &&
						(bytes[j] as number) >= 0x30 &&
						(bytes[j] as number) <= 0x39
					) {
						if (digits < 9) value = value * 10 + ((bytes[j] as number) - 0x30);
						digits++;
						j++;
					}
					param = negative ? -value : value;
				}
				if (bytes[j] === 0x20) j++;
				i = j;
				if (name !== "") word(name, param);
				continue;
			}
			i += 2;
			switch (d) {
				case 0x5c:
					symbolText("\\");
					break;
				case 0x7b:
					symbolText("{");
					break;
				case 0x7d:
					symbolText("}");
					break;
				case 0x7e:
					symbolText(" ");
					break;
				case 0x5f:
					symbolText("-");
					break;
				case 0x2d:
					if (skipFallback > 0) skipFallback--;
					break;
				case 0x2a:
					state.star = true;
					break;
				case 0x0a:
				case 0x0d:
					if (!state.skip && state.cap === CAP_NONE)
						flushParagraph("paragraph");
					break;
			}
			continue;
		}

		if (c === 0x7b) {
			flushPending();
			i++;
			skipFallback = 0;
			if (stack.length >= MAX_DEPTH) {
				throw unsupported("This RTF file is nested too deeply to read.");
			}
			stack.push(state);
			const child: State = { ...state, star: false };
			if (state.dest === DEST_STYLESHEET) {
				child.dest = DEST_STYLEDEF;
				child.style = { id: -1, outline: -1 };
				child.cap = CAP_STYLE;
				child.skip = false;
				styleName = "";
			}
			state = child;
			continue;
		}

		if (c === 0x7d) {
			flushPending();
			i++;
			skipFallback = 0;
			const parent = stack.pop();
			if (!parent) {
				closed = true;
				break;
			}
			const closing = state;
			state = parent;
			if (closing.cap !== parent.cap) finishCapture(closing, parent);
			continue;
		}

		// A run of plain text up to the next brace or backslash.
		let end = i + 1;
		let plain = true;
		while (end < n) {
			const e = bytes[end] as number;
			if (e === 0x7b || e === 0x7d || e === 0x5c) break;
			if (e >= 0x80 || e === 0x0a || e === 0x0d) plain = false;
			end++;
		}
		if (c >= 0x80 || c === 0x0a || c === 0x0d) plain = false;
		if (state.skip && skipFallback === 0) {
			i = end;
			continue;
		}
		if (plain && skipFallback === 0) {
			emitAscii(i, end);
			i = end;
			continue;
		}
		let run = -1;
		for (let k = i; k < end; k++) {
			const b = bytes[k] as number;
			if (b === 0x0a || b === 0x0d) {
				if (run >= 0) {
					emitAscii(run, k);
					run = -1;
				}
				continue;
			}
			if (skipFallback > 0) {
				if (run >= 0) {
					emitAscii(run, k);
					run = -1;
				}
				skipFallback--;
				continue;
			}
			if (b >= 0x80) {
				if (run >= 0) {
					emitAscii(run, k);
					run = -1;
				}
				addPending(b);
				continue;
			}
			if (run < 0) run = k;
		}
		if (run >= 0) emitAscii(run, end);
		i = end;
	}

	flushPending();
	flushParagraph("paragraph");
	if (stats.suspect) throw brokenTextFailure("RTF");
	return { title };
}
