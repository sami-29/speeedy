/**
 * The Document model: what a parser produces and the Reading Engine consumes.
 *
 * A Document is an ordered list of Blocks. Text-bearing blocks carry their text and the
 * inline spans over it. Images are never stored: an image placeholder keeps only its alt
 * text and optional size, so no bytes can be represented anywhere in the model.
 *
 * All offsets (span offsets here, Position offsets elsewhere) count UTF-16 code units
 * into the block's text, the same unit as `String.prototype.length`.
 */

/** Bump when the shape changes. The validator rejects every other version. */
export const DOCUMENT_FORMAT_VERSION = 1;

/**
 * An inline span over `[start, end)` of a block's text. Spans may overlap or nest.
 * A link's `href` is only checked to be a non-empty string; whoever renders it must
 * restrict the URL schemes.
 */
export type Span =
	| { kind: "emphasis"; start: number; end: number }
	| { kind: "strong"; start: number; end: number }
	| { kind: "link"; start: number; end: number; href: string };

export type SpanKind = Span["kind"];

type TextBlock<K extends string, Extra = unknown> = {
	kind: K;
	text: string;
	spans: Span[];
} & Extra;

export type HeadingBlock = TextBlock<
	"heading",
	{ level: 1 | 2 | 3 | 4 | 5 | 6 }
>;
export type ParagraphBlock = TextBlock<"paragraph">;
export type ListItemBlock = TextBlock<
	"list-item",
	{ depth: number; ordered: boolean }
>;
export type QuoteBlock = TextBlock<"quote">;
export type CodeBlock = TextBlock<"code">;
export type TableTextBlock = TextBlock<"table-text">;
export type CaptionBlock = TextBlock<"caption">;

/** Stands in for an image. It has no bytes, source or data URI by design. */
export type ImagePlaceholderBlock = {
	kind: "image-placeholder";
	alt: string;
	width?: number;
	height?: number;
};

export type Block =
	| HeadingBlock
	| ParagraphBlock
	| ListItemBlock
	| QuoteBlock
	| CodeBlock
	| TableTextBlock
	| CaptionBlock
	| ImagePlaceholderBlock;

export type BlockKind = Block["kind"];

export type Document = {
	version: typeof DOCUMENT_FORMAT_VERSION;
	blocks: Block[];
};

export type ValidationResult =
	| { ok: true; document: Document }
	| { ok: false; error: string };

/** The text a Position's offset points into: the alt text for an image placeholder. */
export function blockText(block: Block): string {
	return block.kind === "image-placeholder" ? block.alt : block.text;
}

type Failure = string;

const isRecord = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const isInt = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value);

const hasOnlyKeys = (
	record: Record<string, unknown>,
	allowed: readonly string[],
): boolean => Object.keys(record).every((key) => allowed.includes(key));

function checkSpan(span: unknown, textLength: number): Failure | null {
	if (!isRecord(span)) return "is not an object";
	const { kind, start, end } = span;
	if (kind !== "emphasis" && kind !== "strong" && kind !== "link") {
		return "has an unknown kind";
	}
	const allowed =
		kind === "link"
			? ["kind", "start", "end", "href"]
			: ["kind", "start", "end"];
	if (!hasOnlyKeys(span, allowed)) return "has an unknown field";
	if (!isInt(start) || !isInt(end)) return "offsets must be integers";
	if (start < 0 || end > textLength || start >= end) {
		return `range ${start}..${end} is outside the text of length ${textLength}`;
	}
	if (kind === "link" && (typeof span.href !== "string" || span.href === "")) {
		return "link needs a non-empty href";
	}
	return null;
}

function checkTextBlock(
	block: Record<string, unknown>,
	extraKeys: readonly string[],
): Failure | null {
	if (!hasOnlyKeys(block, ["kind", "text", "spans", ...extraKeys])) {
		return "has an unknown field";
	}
	const { text, spans } = block;
	if (typeof text !== "string") return "text must be a string";
	if (!Array.isArray(spans)) return "spans must be an array";
	for (let i = 0; i < spans.length; i++) {
		const failure = checkSpan(spans[i], text.length);
		if (failure) return `spans[${i}] ${failure}`;
	}
	return null;
}

function checkBlock(block: unknown): Failure | null {
	if (!isRecord(block)) return "is not an object";
	switch (block.kind) {
		case "heading": {
			const level = block.level;
			if (!isInt(level) || level < 1 || level > 6) {
				return "heading level must be an integer from 1 to 6";
			}
			return checkTextBlock(block, ["level"]);
		}
		case "list-item": {
			if (!isInt(block.depth) || block.depth < 0) {
				return "list item depth must be a non-negative integer";
			}
			if (typeof block.ordered !== "boolean") {
				return "list item ordered must be a boolean";
			}
			return checkTextBlock(block, ["depth", "ordered"]);
		}
		case "paragraph":
		case "quote":
		case "code":
		case "table-text":
		case "caption":
			return checkTextBlock(block, []);
		case "image-placeholder": {
			if (!hasOnlyKeys(block, ["kind", "alt", "width", "height"])) {
				return "image placeholder has an unknown field";
			}
			if (typeof block.alt !== "string") return "alt must be a string";
			for (const dimension of ["width", "height"] as const) {
				const value = block[dimension];
				if (value !== undefined && (!isInt(value) || value <= 0)) {
					return `${dimension} must be a positive integer`;
				}
			}
			return null;
		}
		default:
			return "has an unknown kind";
	}
}

/**
 * Check an unknown value against the Document model. Every valid Document passes and
 * anything else, including unknown versions and unknown fields, fails with the first
 * problem found. Never throws.
 */
export function validateDocument(value: unknown): ValidationResult {
	try {
		if (!isRecord(value))
			return { ok: false, error: "document is not an object" };
		if (!hasOnlyKeys(value, ["version", "blocks"])) {
			return { ok: false, error: "document has an unknown field" };
		}
		if (value.version !== DOCUMENT_FORMAT_VERSION) {
			return {
				ok: false,
				error: `unsupported document version ${String(value.version)}`,
			};
		}
		const blocks = value.blocks;
		if (!Array.isArray(blocks)) {
			return { ok: false, error: "blocks must be an array" };
		}
		for (let i = 0; i < blocks.length; i++) {
			const failure = checkBlock(blocks[i]);
			if (failure) return { ok: false, error: `blocks[${i}] ${failure}` };
		}
		return { ok: true, document: value as Document };
	} catch {
		return { ok: false, error: "document could not be read" };
	}
}

export function isDocument(value: unknown): value is Document {
	return validateDocument(value).ok;
}
