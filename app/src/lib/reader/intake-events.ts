import type {
	EventProps,
	FileFormat,
	ParseFailureReason,
} from "@speeedy/contracts";
import type {
	ParseErrorReason,
	ParseOutcome,
	SourceFormat,
} from "@speeedy/parsers";

/** Sends one registered event. The app's `trackEvent` fits it. */
export type TrackIntake = <N extends "file_uploaded" | "parse_failed">(
	event: N,
	props: EventProps<N>,
) => void;

// Typed over every format the parsers know, so a new format cannot be added there without
// deciding here what an event says about it.
const FORMATS: Record<SourceFormat, FileFormat> = {
	txt: "txt",
	markdown: "markdown",
	csv: "csv",
	html: "html",
	docx: "docx",
	epub: "epub",
	odt: "odt",
	rtf: "rtf",
	doc: "doc",
	pdf: "pdf",
	pasted: "other",
};

// The parsers' reasons are the event's reasons, one to one. A reason added there fails here.
const REASONS: Record<ParseErrorReason, ParseFailureReason> = {
	drm: "drm",
	"scanned-pdf": "scanned-pdf",
	unsupported: "unsupported",
	empty: "empty",
	"encoding-suspect": "encoding-suspect",
	"too-big": "too-big",
};

/** The `format` value the `file_uploaded` event carries for a parsed format. */
export function fileFormatFor(format: SourceFormat): FileFormat {
	return FORMATS[format] ?? "other";
}

/**
 * Reports a file's parse: `file_uploaded` with its format, or `parse_failed` with the reason.
 * Pasted text reports nothing. Nothing else leaves: not the name, the size or any text.
 */
export function reportParse(
	source: { kind: "text" } | { kind: "file" },
	outcome: ParseOutcome,
	track: TrackIntake,
): void {
	if (source.kind !== "file") return;
	if (outcome.ok) {
		track("file_uploaded", { format: fileFormatFor(outcome.format) });
	} else {
		track("parse_failed", { reason: REASONS[outcome.reason] ?? "unsupported" });
	}
}
