import type { Block, Span } from "@speeedy/contracts";
import { type Handler, Parser } from "htmlparser2";
import { clip, normalizeText, tidyLine } from "./clean";
import { type BlockSink, MAX_BLOCKS, ParseFailure } from "./types";

/**
 * HTML to Document blocks, with no DOM, so it runs in a Web Worker. It reads the page as a
 * stream of tags and keeps no tree: one explicit stack, one text run, and a flush at every
 * block boundary. Nothing recurses, so nesting depth costs nothing on our side.
 *
 * Limits are chosen so hostile input costs a bounded amount: `htmlparser2` keeps its own
 * open-element stack as an array, and every open and stray close tag walks it, so nesting is
 * capped at 512 levels (the limit Chrome uses) and the element count is capped too.
 *
 * Saved web pages get a small paragraph filter (see `filterPage`). Book HTML does not: a page
 * is only filtered when it carries clear web-page signals, because the filter would drop the
 * short paragraphs and link lists a book legitimately has.
 */

export type HtmlMeta = { title: string | null; language: string | null };

export type HtmlOptions = {
	/** Highest share of a paragraph that may be link text before the filter drops it. */
	linkDensity?: number;
};

/**
 * The link-density threshold of the saved-page filter. Tuned on the saved pages under
 * `test/fixtures/html/` (see `test/html-filter.test.ts` for the 0.5 against 0.8 comparison).
 */
export const LINK_DENSITY_MAX = 0.8;

const MAX_DEPTH = 512;
const MAX_ELEMENTS = 5_000_000;
const MAX_LIST_DEPTH = 10;
const MAX_OPEN_SPANS = 64;
const MAX_SPANS_PER_BLOCK = 50_000;
const MAX_ALT = 1000;
const MAX_HREF = 2048;
const MAX_TITLE = 200;
const MAX_TITLE_SOURCE = 4000;
const MAX_ATTRIBUTE_SCAN = 500;
const MAX_STYLE_SCAN = 1000;
/** A pass that keeps less text than this is retried with a more lenient reading. */
const MIN_PAGE_TEXT = 300;
/** Share of text that must sit inside <main> or <article> before the rest is dropped. */
const MAIN_SHARE = 0.5;
const MAIN_MIN_TEXT = 120;
const MIN_PARAGRAPH = 40;
const MIN_LIST_ITEM = 15;
const MIN_CAPTION = 30;
const MIN_ROW = 15;
const MIN_SENTENCE = 10;

/** Elements whose content is never text for a reader. */
const ALWAYS_SKIP = new Set([
	"head",
	"script",
	"style",
	"template",
	"noscript",
	"svg",
	"math",
	"iframe",
	"object",
	"embed",
	"applet",
	"canvas",
	"audio",
	"video",
	"map",
	"select",
	"option",
	"optgroup",
	"datalist",
	"textarea",
	"button",
	"input",
	"title",
	"frameset",
	"noframes",
]);

/** Skipped as boilerplate only when the page looks like a saved web page. */
const BOILER_TAGS = new Set(["nav", "aside", "form", "dialog", "menu"]);
/** Boilerplate unless the page marks a main content area around them. */
const BOILER_UNLESS_MAIN = new Set(["header", "footer"]);
const BOILER_ROLES = new Set([
	"navigation",
	"search",
	"complementary",
	"dialog",
	"alertdialog",
]);
const BOILER_ROLES_UNLESS_MAIN = new Set(["banner", "contentinfo"]);

const BOILER_CLASSES = new Set([
	"nav",
	"navbar",
	"navbox",
	"navigation",
	"menu",
	"sidebar",
	"cookie",
	"cookies",
	"newsletter",
	"share",
	"sharing",
	"social",
	"related",
	"promo",
	"advert",
	"advertisement",
	"ads",
	"ad",
	"breadcrumb",
	"breadcrumbs",
	"comments",
	"subscribe",
	"popup",
	"modal",
	"toc",
	"catlinks",
	"reflist",
	"references",
	"printfooter",
	"noprint",
	"mw-editsection",
	"headerlink",
	"footer",
	"vector-dropdown-content",
	"vector-menu-content",
	"mw-jump-link",
	"sitesub",
	"hatnote",
	"toctitle",
	"mw-cite-backlink",
	"skip-link",
	"visually-hidden",
	"sr-only",
	"screen-reader-text",
]);

const BLOCK_TAGS = new Set([
	"html",
	"body",
	"p",
	"div",
	"section",
	"article",
	"main",
	"header",
	"footer",
	"aside",
	"nav",
	"form",
	"fieldset",
	"figure",
	"dl",
	"dt",
	"dd",
	"address",
	"details",
	"summary",
	"center",
	"hgroup",
	"legend",
	"menu",
	"dir",
	"ul",
	"ol",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"hr",
]);

const HEADINGS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
	h1: 1,
	h2: 2,
	h3: 3,
	h4: 4,
	h5: 5,
	h6: 6,
};

type CtxKind =
	| "paragraph"
	| "heading"
	| "list-item"
	| "quote"
	| "code"
	| "caption"
	| "table-text";

type Ctx = {
	kind: CtxKind;
	level: 1 | 2 | 3 | 4 | 5 | 6;
	depth: number;
	ordered: boolean;
};

const BASE_CTX: Ctx = {
	kind: "paragraph",
	level: 1,
	depth: 0,
	ordered: false,
};

type SpanKind = "emphasis" | "strong" | "link";

type Frame = {
	/** A context was pushed for this element. */
	ctx: boolean;
	list: boolean;
	pre: boolean;
	main: boolean;
	link: boolean;
	span: SpanKind | null;
	spanStart: number;
	href: string | null;
};

type Candidate = { block: Block; linkChars: number; inMain: boolean };

type PassResult = {
	candidates: Candidate[];
	title: string | null;
	language: string | null;
};

function attr(attribs: Record<string, string>, name: string): string {
	return attribs[name] ?? "";
}

/** The class and id tokens of an element, bounded, lower-cased. */
function labelTokens(attribs: Record<string, string>): string[] {
	const raw = `${attr(attribs, "class").slice(0, MAX_ATTRIBUTE_SCAN)} ${attr(attribs, "id").slice(0, MAX_ATTRIBUTE_SCAN)}`;
	return raw.toLowerCase().split(/\s+/);
}

function hasBoilerLabel(attribs: Record<string, string>): boolean {
	for (const token of labelTokens(attribs)) {
		if (token === "") continue;
		if (BOILER_CLASSES.has(token)) return true;
		const dash = token.search(/[-_]/);
		if (dash > 0 && BOILER_CLASSES.has(token.slice(0, dash))) return true;
	}
	return false;
}

/** Any whitespace other than a lone space. Text without it is already collapsed. */
const NEEDS_COLLAPSE = /[^\S ]| {2}/;

const HIDDEN_STYLE = /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;

function isHidden(attribs: Record<string, string>): boolean {
	if (attribs.hidden !== undefined) return true;
	if (attribs["aria-hidden"]?.toLowerCase() === "true") return true;
	const style = attribs.style;
	return (
		style !== undefined && HIDDEN_STYLE.test(style.slice(0, MAX_STYLE_SCAN))
	);
}

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * The link target to keep, or null to keep only the label. Only http, https, mailto, tel
 * and scheme-less (relative or fragment) targets survive, however the scheme is spelled:
 * browsers ignore tabs, newlines and other control characters inside a URL, so do we.
 */
export function safeHref(raw: string): string | null {
	const source = raw.length > MAX_HREF * 2 ? raw.slice(0, MAX_HREF * 2) : raw;
	let cleaned = "";
	for (const char of source) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 32 || (code >= 127 && code <= 159)) continue;
		if (code === 0x200b || code === 0xfeff || code === 0x2060) continue;
		cleaned += char;
	}
	if (cleaned === "") return null;
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned.slice(0, 40));
	if (scheme?.[1] && !ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) return null;
	return clip(cleaned, MAX_HREF);
}

function dimension(value: string | undefined): number | undefined {
	if (value === undefined || !/^\s*\d{1,5}\s*(?:px)?\s*$/i.test(value)) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return parsed > 0 ? parsed : undefined;
}

type PassOptions = {
	/** Drop navigation, headers, footers, sidebars and similar subtrees. */
	boilerplate: boolean;
};

/**
 * `htmlparser2` looks a closing tag up by walking its whole open-element list, so a file of
 * stray closing tags at the deepest allowed nesting costs depth times file size. A closing tag
 * for an element that is not open does nothing anyway (except `</p>` and `</br>`, which open
 * an empty element), so it is dropped here before the walk. The tag name is read straight
 * from the source: the parser is always given the whole page in one piece.
 */
class GuardedParser extends Parser {
	private readonly source: string;
	private readonly open: ReadonlyMap<string, number>;

	constructor(
		handlers: Partial<Handler>,
		source: string,
		open: ReadonlyMap<string, number>,
	) {
		super(handlers, { decodeEntities: true });
		this.source = source;
		this.open = open;
	}

	override onclosetag(start: number, endIndex: number): void {
		const name = this.source.slice(start, endIndex).toLowerCase();
		if (name !== "p" && name !== "br" && !this.open.has(name)) {
			this.endIndex = endIndex;
			this.startIndex = endIndex + 1;
			return;
		}
		super.onclosetag(start, endIndex);
	}
}

/** One streaming pass over the page. Returns every block with what the filter needs. */
function readPass(html: string, options: PassOptions): PassResult {
	const candidates: Candidate[] = [];
	const ctxStack: Ctx[] = [BASE_CTX];
	const frames: Frame[] = [];
	const lists: boolean[] = [];
	const openInline: Frame[] = [];

	let parts: string[] = [];
	let length = 0;
	let lastSpace = false;
	let linkChars = 0;
	let runSpans: Span[] = [];
	let pending: Block[] = [];

	let depth = 0;
	let elements = 0;
	let skipNest = 0;
	let skipRoot = "";
	let preDepth = 0;
	let preFresh = false;
	let mainDepth = 0;
	let linkDepth = 0;
	let titleParts: string[] | null = null;
	let titleLength = 0;
	let title: string | null = null;
	let language: string | null = null;

	const open = new Map<string, number>();
	const top = (): Ctx => ctxStack[ctxStack.length - 1] ?? BASE_CTX;

	const push = (block: Block, chars: number): void => {
		if (candidates.length >= MAX_BLOCKS) {
			throw new ParseFailure(
				"too-big",
				"This file has more paragraphs than Speeedy can open.",
			);
		}
		candidates.push({ block, linkChars: chars, inMain: mainDepth > 0 });
	};

	const closeSpan = (frame: Frame, end: number): void => {
		if (frame.span === null || end <= frame.spanStart) return;
		if (runSpans.length >= MAX_SPANS_PER_BLOCK) return;
		runSpans.push(
			frame.span === "link"
				? {
						kind: "link",
						start: frame.spanStart,
						end,
						href: frame.href ?? "",
					}
				: { kind: frame.span, start: frame.spanStart, end },
		);
	};

	const resetRun = (): void => {
		parts = [];
		length = 0;
		lastSpace = false;
		linkChars = 0;
		runSpans = [];
		for (const frame of openInline) frame.spanStart = 0;
	};

	const flush = (): void => {
		const queued = pending;
		pending = [];
		let text = parts.length === 1 ? (parts[0] ?? "") : parts.join("");
		const ctx = top();
		if (ctx.kind === "code") {
			text = text.trimEnd();
			if (text.trim() === "") text = "";
		} else if (lastSpace) {
			text = text.slice(0, -1);
		}
		if (text !== "") {
			for (const frame of openInline) closeSpan(frame, text.length);
			const spans = ctx.kind === "code" ? [] : tidySpans(runSpans, text);
			const block = textBlock(ctx, text, spans);
			push(block, linkChars);
		}
		resetRun();
		for (const image of queued) push(image, 0);
	};

	const append = (data: string): void => {
		if (data === "") return;
		const clean = normalizeText(data);
		if (clean === "") return;
		let chunk: string;
		if (preDepth > 0) {
			chunk = clean;
			if (preFresh) {
				preFresh = false;
				if (chunk.startsWith("\n")) chunk = chunk.slice(1);
				if (chunk === "") return;
			}
		} else {
			chunk = NEEDS_COLLAPSE.test(clean) ? clean.replace(/\s+/g, " ") : clean;
			if (chunk.charCodeAt(0) === 32 && (length === 0 || lastSpace)) {
				chunk = chunk.slice(1);
			}
			if (chunk === "") return;
			lastSpace = chunk.charCodeAt(chunk.length - 1) === 32;
		}
		parts.push(chunk);
		length += chunk.length;
		if (linkDepth > 0) linkChars += chunk.length;
	};

	const separate = (): void => {
		if (preDepth > 0) append("\n");
		else if (length > 0 && !lastSpace) append(" ");
	};

	const pushCtx = (ctx: Ctx, frame: Frame): void => {
		ctxStack.push(ctx);
		frame.ctx = true;
	};

	const skipReason = (
		name: string,
		attribs: Record<string, string>,
	): boolean => {
		if (ALWAYS_SKIP.has(name)) return true;
		if (isHidden(attribs)) return true;
		if (!options.boilerplate) return false;
		if (BOILER_TAGS.has(name)) return true;
		if (name === "body" || name === "html") return false;
		const inMain = mainDepth > 0;
		if (BOILER_UNLESS_MAIN.has(name) && !inMain) return true;
		const role = attr(attribs, "role").toLowerCase();
		if (BOILER_ROLES.has(role)) return true;
		if (BOILER_ROLES_UNLESS_MAIN.has(role) && !inMain) return true;
		if (name === "main" || name === "article") return false;
		// Citation markers such as the "[4]" after a Wikipedia sentence.
		if (name === "sup" && labelTokens(attribs).includes("reference"))
			return true;
		return hasBoilerLabel(attribs);
	};

	const onopentag = (name: string, attribs: Record<string, string>): void => {
		open.set(name, (open.get(name) ?? 0) + 1);
		elements++;
		if (elements > MAX_ELEMENTS) {
			throw new ParseFailure(
				"too-big",
				"This page has more markup than Speeedy can open.",
			);
		}
		depth++;
		if (depth > MAX_DEPTH) {
			throw new ParseFailure(
				"too-big",
				"This page is nested too deeply for Speeedy to open.",
			);
		}
		if (
			name === "title" &&
			title === null &&
			titleParts === null &&
			(skipNest === 0 || skipRoot === "head")
		) {
			titleParts = [];
			titleLength = 0;
		}
		if (name === "html" && language === null) {
			language = attribs.lang ?? attribs["xml:lang"] ?? null;
		}
		if (skipNest > 0) {
			skipNest++;
			return;
		}
		if (skipReason(name, attribs)) {
			skipNest = 1;
			skipRoot = name;
			return;
		}

		const frame: Frame = {
			ctx: false,
			list: false,
			pre: false,
			main: false,
			link: false,
			span: null,
			spanStart: 0,
			href: null,
		};
		frames.push(frame);

		if (name === "br") {
			separate();
			return;
		}
		if (name === "img") {
			const alt = clip(tidyLine(normalizeText(attr(attribs, "alt"))), MAX_ALT);
			const width = dimension(attribs.width);
			const height = dimension(attribs.height);
			if (
				(width !== undefined && width <= 2) ||
				(height !== undefined && height <= 2)
			) {
				return;
			}
			const image: Block = { kind: "image-placeholder", alt };
			if (width !== undefined) image.width = width;
			if (height !== undefined) image.height = height;
			if (length === 0) push(image, 0);
			else pending.push(image);
			return;
		}

		const heading = HEADINGS[name];
		if (heading !== undefined) {
			flush();
			pushCtx({ ...BASE_CTX, kind: "heading", level: heading }, frame);
		} else if (name === "li") {
			flush();
			pushCtx(
				{
					...BASE_CTX,
					kind: "list-item",
					depth: Math.min(Math.max(lists.length - 1, 0), MAX_LIST_DEPTH),
					ordered: lists[lists.length - 1] ?? false,
				},
				frame,
			);
		} else if (name === "ul" || name === "ol") {
			flush();
			lists.push(name === "ol");
			frame.list = true;
		} else if (name === "blockquote") {
			flush();
			pushCtx({ ...BASE_CTX, kind: "quote" }, frame);
		} else if (name === "pre") {
			flush();
			pushCtx({ ...BASE_CTX, kind: "code" }, frame);
			preDepth++;
			preFresh = true;
			frame.pre = true;
		} else if (name === "caption" || name === "figcaption") {
			flush();
			pushCtx({ ...BASE_CTX, kind: "caption" }, frame);
		} else if (name === "tr") {
			flush();
			pushCtx({ ...BASE_CTX, kind: "table-text" }, frame);
		} else if (name === "td" || name === "th") {
			separate();
		} else if (BLOCK_TAGS.has(name)) {
			flush();
			if (name === "main" || name === "article") {
				frame.main = true;
				mainDepth++;
			}
			const inside = top().kind;
			// A paragraph in an unclosed heading is still a paragraph, and a cell holding
			// paragraphs or divs is flow content, not a one-line row.
			if (
				(name === "p" && inside === "heading") ||
				((name === "p" || name === "div") && inside === "table-text")
			) {
				pushCtx(BASE_CTX, frame);
			}
		} else if (
			name === "em" ||
			name === "i" ||
			name === "cite" ||
			name === "dfn" ||
			name === "var"
		) {
			frame.span = "emphasis";
		} else if (name === "strong" || name === "b") {
			frame.span = "strong";
		} else if (name === "a") {
			const href = attribs.href;
			if (href !== undefined) {
				frame.link = true;
				linkDepth++;
				const safe = safeHref(href);
				if (safe !== null) {
					frame.span = "link";
					frame.href = safe;
				}
			}
		}
		if (frame.span !== null) {
			frame.spanStart = length;
			if (openInline.length < MAX_OPEN_SPANS) openInline.push(frame);
			else frame.span = null;
		}
	};

	const onclosetag = (name: string): void => {
		const count = open.get(name) ?? 0;
		if (count <= 1) open.delete(name);
		else open.set(name, count - 1);
		depth--;
		if (titleParts !== null && name === "title") {
			title = tidyLine(titleParts.join(""));
			titleParts = null;
		}
		if (skipNest > 0) {
			skipNest--;
			return;
		}
		const frame = frames.pop();
		if (frame === undefined) return;
		if (frame.span !== null) {
			closeSpan(frame, length);
			if (openInline[openInline.length - 1] === frame) openInline.pop();
		}
		if (frame.link) linkDepth--;
		if (name === "td" || name === "th") {
			separate();
		} else if (frame.ctx || frame.list || BLOCK_TAGS.has(name)) {
			flush();
		}
		if (frame.ctx) ctxStack.pop();
		if (frame.list) lists.pop();
		if (frame.pre) preDepth--;
		if (frame.main) mainDepth--;
	};

	const ontext = (data: string): void => {
		if (titleParts !== null) {
			if (titleLength < MAX_TITLE_SOURCE) {
				titleParts.push(data);
				titleLength += data.length;
			}
			return;
		}
		if (skipNest > 0) return;
		append(data);
	};

	const parser = new GuardedParser(
		{ onopentag, onclosetag, ontext },
		html,
		open,
	);
	parser.end(html);
	flush();
	return { candidates, title, language };
}

function textBlock(ctx: Ctx, text: string, spans: Span[]): Block {
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

/** Trim spaces off the edges of each span, clamp to the text, drop empties, sort. */
export function tidySpans(spans: Span[], text: string): Span[] {
	const out: Span[] = [];
	for (const span of spans) {
		let { start, end } = span;
		if (end > text.length) end = text.length;
		while (start < end && text.charCodeAt(start) === 32) start++;
		while (end > start && text.charCodeAt(end - 1) === 32) end--;
		if (start >= end) continue;
		out.push({ ...span, start, end });
	}
	out.sort((a, b) => a.start - b.start || b.end - a.end);
	return out;
}

const SIGNAL_WINDOW = 150_000;

const SIGNALS: RegExp[] = [
	/<nav[\s>/]/i,
	/<aside[\s>/]/i,
	/<form[\s>/]/i,
	/<(?:header|footer)[\s>/]/i,
	/\brole\s*=\s*["']?(?:navigation|banner|contentinfo|complementary)\b/i,
	/<meta\s[^>]{0,300}?\bproperty\s*=\s*["']?og:/i,
	/<link\s[^>]{0,300}?\brel\s*=\s*["']?canonical/i,
	/<script\s[^>]{0,300}?\bsrc\s*=/i,
];

/**
 * A saved web page carries at least two kinds of page furniture (navigation, header or
 * footer, forms, social meta tags, script files). A book or a hand-written page rarely has
 * two, and gets no filtering.
 */
function looksLikeWebPage(html: string): boolean {
	// Page furniture sits in the head, the navigation and the footer, so two bounded windows
	// are enough, and a hostile file cannot make the patterns scan megabytes.
	const sample =
		html.length <= SIGNAL_WINDOW * 2
			? html
			: `${html.slice(0, SIGNAL_WINDOW)}\n${html.slice(-SIGNAL_WINDOW)}`;
	let found = 0;
	for (const signal of SIGNALS) {
		if (signal.test(sample) && ++found >= 2) return true;
	}
	return false;
}

function textLengthOf(block: Block): number {
	return block.kind === "image-placeholder"
		? block.alt.length
		: block.text.length;
}

const SENTENCE_END = /[.!?…:;"'”’»)]$/;

/**
 * The paragraph filter for saved web pages. Navigation and similar subtrees are already
 * gone; what is left is judged one block at a time: a paragraph that is mostly link text, or
 * a short fragment that is not a sentence, is page furniture. Headings always stay.
 */
export function filterPage(
	candidates: Candidate[],
	linkDensity: number,
): Candidate[] {
	let inMainChars = 0;
	let totalChars = 0;
	for (const candidate of candidates) {
		const size = textLengthOf(candidate.block);
		totalChars += size;
		if (candidate.inMain) inMainChars += size;
	}
	const scoped =
		inMainChars >= MAIN_MIN_TEXT && inMainChars >= totalChars * MAIN_SHARE;
	return candidates.filter((candidate) => {
		if (scoped && !candidate.inMain) return false;
		const { block } = candidate;
		if (block.kind === "heading" || block.kind === "code") return true;
		if (block.kind === "image-placeholder") return block.alt !== "";
		const size = block.text.length;
		// Navigation lists are removed by structure before this point, so a list or table row
		// made of links (see-also, API lists, bibliographies) is content, not furniture. The
		// link-density rule is for prose: "Read more: ..." lines and similar.
		const listLike = block.kind === "list-item" || block.kind === "table-text";
		const density = size === 0 ? 1 : candidate.linkChars / size;
		if (density > linkDensity && !listLike) return false;
		const minimum =
			block.kind === "list-item"
				? MIN_LIST_ITEM
				: block.kind === "caption"
					? MIN_CAPTION
					: block.kind === "table-text"
						? MIN_ROW
						: MIN_PARAGRAPH;
		if (size >= minimum) return true;
		if (candidate.linkChars !== 0 || block.kind === "table-text") {
			return listLike && size >= 3;
		}
		return size >= MIN_SENTENCE && SENTENCE_END.test(block.text);
	});
}

function keptText(candidates: Candidate[]): number {
	let total = 0;
	for (const candidate of candidates) total += textLengthOf(candidate.block);
	return total;
}

function pageTitle(
	documentTitle: string | null,
	blocks: Block[],
): string | null {
	let heading: string | null = null;
	for (const block of blocks) {
		if (block.kind === "heading" && block.level === 1) {
			heading = block.text;
			break;
		}
	}
	const title = documentTitle === null ? "" : documentTitle;
	if (title === "") return heading === null ? null : clip(heading, MAX_TITLE);
	if (
		heading !== null &&
		heading.length < title.length &&
		title.includes(heading)
	) {
		return clip(heading, MAX_TITLE);
	}
	return clip(title, MAX_TITLE);
}

/**
 * Read an HTML page into blocks. A saved web page is read twice at most: first dropping
 * navigation and other furniture, then (if almost nothing is left, as when a whole site sits
 * inside one form) keeping the furniture. Anything that still comes out nearly empty is
 * returned unfiltered rather than lost.
 */
export function htmlToBlocks(
	html: string,
	sink: BlockSink,
	options: HtmlOptions = {},
): HtmlMeta {
	const density = options.linkDensity ?? LINK_DENSITY_MAX;
	let result: PassResult;
	let kept: Candidate[];
	if (looksLikeWebPage(html)) {
		result = readPass(html, { boilerplate: true });
		kept = filterPage(result.candidates, density);
		const strict = keptText(kept);
		if (strict < MIN_PAGE_TEXT) {
			const lenient = readPass(html, { boilerplate: false });
			const lenientKept = filterPage(lenient.candidates, density);
			const lenientText = keptText(lenientKept);
			if (lenientText >= strict * 3 + MIN_PAGE_TEXT) {
				result = lenient;
				kept = lenientKept;
			} else if (strict === 0) {
				result = lenient;
				kept = lenient.candidates;
			}
		}
	} else {
		result = readPass(html, { boilerplate: false });
		kept = result.candidates;
	}
	const blocks: Block[] = [];
	for (const candidate of kept) {
		sink.push(candidate.block);
		blocks.push(candidate.block);
	}
	return {
		title: pageTitle(result.title, blocks),
		language: result.language,
	};
}
