import {
	type Block,
	type Document,
	validateDocument,
} from "@speeedy/contracts";
import { clip, normalizeText, scanControls, tidyLine } from "./clean";
import { csvToBlocks } from "./csv";
import { decodeBytes } from "./decode";
import { epubToBlocks } from "./epub";
import { htmlToBlocks } from "./html";
import { detectLanguage, normalizeLanguageTag } from "./language";
import { type MarkdownMeta, markdownToBlocks } from "./markdown";
import { odtToBlocks } from "./odt";
import { plainTextToBlocks } from "./plain";
import {
	BlockSink,
	type DetectedLanguage,
	MAX_BLOCKS,
	MAX_BYTES,
	ParseFailure,
	type ParseHints,
	type ParseOutcome,
	type SourceFormat,
} from "./types";

const TITLE_MAX = 200;
/** Above this share of control characters the file is binary, not text. */
const BINARY_RATIO = 0.1;
const BINARY_MIN_CONTROLS = 4;
const LANGUAGE_SAMPLE = 20_000;

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);
const CSV_EXTENSIONS = new Set(["csv"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

/** Extensions that are never text, whatever the bytes look like. */
const BINARY_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"heic",
	"tif",
	"tiff",
	"svg",
	"ico",
	"exe",
	"dll",
	"bin",
	"so",
	"mp3",
	"mp4",
	"wav",
	"mov",
	"avi",
]);

/**
 * Formats the product promises but whose parsers are separate tickets. They are refused by
 * name, so a saved web page is never read as if its tags were the text.
 */
const NOT_YET_EXTENSIONS = new Set([
	"pdf",
	"docx",
	"doc",
	"rtf",
	"xhtml",
	"mhtml",
	"mobi",
	"azw",
	"azw3",
	"fb2",
	"pages",
]);

const MAGIC: [string, number[]][] = [
	["a PDF", [0x25, 0x50, 0x44, 0x46, 0x2d]],
	["a ZIP archive", [0x50, 0x4b, 0x03, 0x04]],
	["a ZIP archive", [0x50, 0x4b, 0x05, 0x06]],
	["a PNG image", [0x89, 0x50, 0x4e, 0x47]],
	["a JPEG image", [0xff, 0xd8, 0xff]],
	["a GIF image", [0x47, 0x49, 0x46, 0x38]],
	["an Office 97 document", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
	["a gzip archive", [0x1f, 0x8b]],
	["a RAR archive", [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]],
];

type Hints = {
	encoding: string | undefined;
	language: string | null;
	maxBytes: number;
	maxBlocks: number;
};

/** Read hints defensively: anything of the wrong type is ignored, never an error. */
function readHints(raw: unknown): Hints {
	const hints: Hints = {
		encoding: undefined,
		language: null,
		maxBytes: MAX_BYTES,
		maxBlocks: MAX_BLOCKS,
	};
	if (typeof raw !== "object" || raw === null) return hints;
	const source = raw as Partial<Record<keyof ParseHints, unknown>>;
	if (typeof source.encoding === "string") hints.encoding = source.encoding;
	hints.language = normalizeLanguageTag(source.language);
	hints.maxBytes = lowerLimit(source.maxBytes, MAX_BYTES);
	hints.maxBlocks = lowerLimit(source.maxBlocks, MAX_BLOCKS);
	return hints;
}

function lowerLimit(value: unknown, ceiling: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? Math.min(value, ceiling)
		: ceiling;
}

/** A `Uint8Array` over exactly the bytes given, or null when the input is not bytes. */
export function toBytes(input: unknown): Uint8Array | null {
	if (input instanceof Uint8Array) return input;
	try {
		if (ArrayBuffer.isView(input)) {
			return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
		}
		const tag = Object.prototype.toString.call(input);
		if (
			tag === "[object ArrayBuffer]" ||
			tag === "[object SharedArrayBuffer]"
		) {
			return new Uint8Array(input as ArrayBuffer);
		}
		return null;
	} catch {
		// A detached buffer cannot be viewed: it holds no bytes.
		return new Uint8Array(0);
	}
}

function extensionOf(segment: string): string {
	const dot = segment.lastIndexOf(".");
	if (dot < 0) return "";
	const extension = segment.slice(dot + 1).toLowerCase();
	return /^[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function lastSegment(fileName: unknown): string {
	if (typeof fileName !== "string") return "";
	const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
	return fileName.slice(slash + 1);
}

function titleFromFileName(segment: string): string | null {
	const extension = extensionOf(segment);
	const stem = extension ? segment.slice(0, segment.lastIndexOf(".")) : segment;
	const title = clip(tidyLine(stem.slice(0, 1000)), TITLE_MAX);
	return title === "" ? null : title;
}

function hasMagic(bytes: Uint8Array): string | null {
	for (const [name, prefix] of MAGIC) {
		if (
			bytes.length >= prefix.length &&
			prefix.every((v, i) => bytes[i] === v)
		) {
			return name;
		}
	}
	return null;
}

function failure(
	reason: ParseFailure["reason"],
	message: string,
): ParseOutcome {
	return { ok: false, reason, message };
}

function languageFor(
	blocks: Block[],
	hinted: string | null,
	metadata: string | null,
): DetectedLanguage {
	if (hinted) return { code: hinted, source: "hint" };
	let sample = "";
	for (const block of blocks) {
		sample += `${block.kind === "image-placeholder" ? block.alt : block.text}\n`;
		if (sample.length >= LANGUAGE_SAMPLE) break;
	}
	return detectLanguage(sample, metadata);
}

function finish(
	sink: BlockSink,
	options: {
		title: string | null;
		format: SourceFormat;
		encoding: string | null;
		hinted: string | null;
		metadataLanguage: string | null;
	},
): ParseOutcome {
	if (sink.blocks.length === 0) {
		return failure("empty", "There is no text in this file.");
	}
	const document: Document = { version: 1, blocks: sink.blocks };
	const checked = validateDocument(document);
	if (!checked.ok) {
		return failure("unsupported", "Speeedy could not read this file.");
	}
	return {
		ok: true,
		document,
		title: options.title,
		language: languageFor(
			sink.blocks,
			options.hinted,
			options.metadataLanguage,
		),
		format: options.format,
		encoding: options.encoding,
	};
}

type TextFormat = "txt" | "markdown" | "csv" | "html" | "pasted";

function buildBlocks(
	format: TextFormat,
	text: string,
	sink: BlockSink,
): MarkdownMeta | null {
	if (format === "markdown") return markdownToBlocks(text, sink);
	if (format === "html") return htmlToBlocks(text, sink);
	if (format === "csv") csvToBlocks(text, sink);
	else plainTextToBlocks(text, sink);
	return null;
}

function parseTextFormat(
	format: TextFormat,
	rawText: string,
	hints: Hints,
	encoding: string | null,
	fileTitle: string | null,
): ParseOutcome {
	const { controls, nul } = scanControls(rawText);
	if (
		controls >= BINARY_MIN_CONTROLS &&
		controls / Math.max(rawText.length, 1) > BINARY_RATIO
	) {
		return nul
			? failure("unsupported", "This looks like a binary file, not text.")
			: failure(
					"encoding-suspect",
					"The text looks scrambled. Pick the file's encoding and open it again.",
				);
	}
	const sink = new BlockSink(hints.maxBlocks);
	const meta = buildBlocks(format, normalizeText(rawText), sink);
	return finish(sink, {
		title: meta?.title ?? fileTitle,
		format,
		encoding,
		hinted: hints.language,
		metadataLanguage: meta?.language ?? null,
	});
}

async function parseBook(
	bytes: Uint8Array,
	extension: string,
	hints: Hints,
	fileTitle: string | null,
): Promise<ParseOutcome> {
	const sink = new BlockSink(hints.maxBlocks);
	if (extension === "odt") {
		const meta = await odtToBlocks(bytes, sink);
		return finish(sink, {
			title: meta.title ?? fileTitle,
			format: "odt",
			encoding: null,
			hinted: hints.language,
			metadataLanguage: null,
		});
	}
	const meta = await epubToBlocks(bytes, sink, {
		fromZip: extension === "zip",
	});
	return finish(sink, {
		title: meta.title ?? fileTitle,
		format: "epub",
		encoding: null,
		hinted: hints.language,
		metadataLanguage: meta.language,
	});
}

function toOutcome(error: unknown): ParseOutcome {
	if (error instanceof ParseFailure)
		return failure(error.reason, error.message);
	if (error instanceof RangeError) {
		return failure("too-big", "This file is too large for Speeedy to open.");
	}
	return failure("unsupported", "Speeedy could not read this file.");
}

/**
 * Parse a file's bytes into a Document, or say why it could not be. Never throws: every
 * failure, including hostile input, comes back as a typed `ParseError`.
 *
 * `hints` carries the reader's choices (a codepage for legacy TXT, a language override)
 * and optional lower input ceilings. `fileName` picks the format by its extension; a file
 * with an unknown extension is read as text only if it looks like text.
 */
export async function parse(
	bytes: Uint8Array | ArrayBuffer,
	fileName: string,
	hints?: ParseHints,
): Promise<ParseOutcome> {
	try {
		const view = toBytes(bytes);
		if (!view) {
			return failure("unsupported", "That is not a file Speeedy can read.");
		}
		const options = readHints(hints);
		if (view.byteLength > options.maxBytes) {
			return failure("too-big", "This file is too large for Speeedy to open.");
		}
		if (view.byteLength === 0) {
			return failure("empty", "This file is empty.");
		}
		const segment = lastSegment(fileName);
		const extension = extensionOf(segment);
		if (extension === "epub" || extension === "zip" || extension === "odt") {
			return await parseBook(
				view,
				extension,
				options,
				titleFromFileName(segment),
			);
		}
		if (NOT_YET_EXTENSIONS.has(extension)) {
			return failure(
				"unsupported",
				`Speeedy cannot open .${extension} files yet. Paste the text instead.`,
			);
		}
		const magic = hasMagic(view);
		if (magic) {
			return failure("unsupported", `This file is ${magic}, not text.`);
		}
		if (BINARY_EXTENSIONS.has(extension)) {
			return failure("unsupported", `Speeedy cannot open .${extension} files.`);
		}
		const format: TextFormat = MARKDOWN_EXTENSIONS.has(extension)
			? "markdown"
			: CSV_EXTENSIONS.has(extension)
				? "csv"
				: HTML_EXTENSIONS.has(extension)
					? "html"
					: "txt";
		const decoded = decodeBytes(view, {
			encoding: options.encoding,
			sniffMeta: format === "html",
		});
		return parseTextFormat(
			format,
			decoded.text,
			options,
			decoded.encoding,
			titleFromFileName(segment),
		);
	} catch (error) {
		return toOutcome(error);
	}
}

/** Parse pasted text. The text is taken as is; there is no file name and no encoding. */
export async function parseText(
	text: string,
	hints?: ParseHints,
): Promise<ParseOutcome> {
	try {
		if (typeof text !== "string") {
			return failure("unsupported", "That is not text Speeedy can read.");
		}
		const options = readHints(hints);
		if (text.length > options.maxBytes) {
			return failure("too-big", "This text is too large for Speeedy to open.");
		}
		return parseTextFormat("pasted", text, options, null, null);
	} catch (error) {
		return toOutcome(error);
	}
}
