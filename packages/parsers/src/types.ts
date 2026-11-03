import type { Block, Document } from "@speeedy/contracts";

/** Why a file could not become a Document. Maps one to one onto the `parse-failed` event enum. */
export const PARSE_ERROR_REASONS = [
	"drm",
	"scanned-pdf",
	"unsupported",
	"empty",
	"encoding-suspect",
	"too-big",
] as const;

export type ParseErrorReason = (typeof PARSE_ERROR_REASONS)[number];

/** The failure half of the outcome. `message` is plain English for the reader. */
export type ParseError = {
	ok: false;
	reason: ParseErrorReason;
	message: string;
};

/**
 * Options the reader or the app passes in. Every field is optional and anything that is
 * not the expected type is ignored, so a hostile or stale value can never throw.
 */
export type ParseHints = {
	/** A TextDecoder label for a legacy-codepage TXT or CSV, for example `windows-1250`. */
	encoding?: string;
	/** The reader's language override, a BCP 47 tag such as `tr` or `pt-BR`. */
	language?: string;
	/** Lower the input size ceiling (bytes). It can never raise the built-in one. */
	maxBytes?: number;
	/** Lower the block-count ceiling. It can never raise the built-in one. */
	maxBlocks?: number;
	/** Lower the time a PDF may take, in milliseconds. It can never raise the built-in one. */
	maxMillis?: number;
};

/** The formats the shell parses itself. Later tickets add the rest. */
export type SourceFormat =
	| "txt"
	| "markdown"
	| "csv"
	| "html"
	| "docx"
	| "pasted"
	| "pdf";

export type LanguageSource =
	| "hint"
	| "metadata"
	| "script"
	| "stopwords"
	| "unknown";

/** A BCP 47 primary language subtag (`und` when nothing could be told) and how it was found. */
export type DetectedLanguage = {
	code: string;
	source: LanguageSource;
};

/**
 * The success half of the outcome. The spec's `parse(...) → Document | ParseError` carries
 * the title, language and encoding alongside the Document, because the Document model
 * itself has no room for them.
 */
export type ParseSuccess = {
	ok: true;
	document: Document;
	title: string | null;
	language: DetectedLanguage;
	format: SourceFormat;
	/** The TextDecoder encoding actually used, or null for pasted text. */
	encoding: string | null;
};

export type ParseOutcome = ParseSuccess | ParseError;

/** Input ceilings. 100 MB matches the per-document ceiling in the plans table. */
export const MAX_BYTES = 100_000_000;
export const MAX_BLOCKS = 1_000_000;
/** The longest a PDF may take to read: three minutes. */
export const MAX_MILLIS = 180_000;

/** Thrown inside the parsers and turned into a ParseError at the edge. Never escapes `parse`. */
export class ParseFailure extends Error {
	readonly reason: ParseErrorReason;

	constructor(reason: ParseErrorReason, message: string) {
		super(message);
		this.name = "ParseFailure";
		this.reason = reason;
	}
}

/** Collects blocks and enforces the block ceiling as they arrive, so a flood stops early. */
export class BlockSink {
	readonly blocks: Block[] = [];
	private readonly max: number;

	constructor(max: number) {
		this.max = max;
	}

	push(block: Block): void {
		if (this.blocks.length >= this.max) {
			throw new ParseFailure(
				"too-big",
				"This file has more paragraphs than Speeedy can open.",
			);
		}
		this.blocks.push(block);
	}
}
