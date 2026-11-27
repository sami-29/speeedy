import type { ParseOutcome, SourceFormat } from "@speeedy/parsers";

export type TrackLoose = (event: string, props: Record<string, string>) => void;

/** The `format` value the `file_uploaded` event carries for a parsed format. */
export function fileFormatFor(_format: SourceFormat): string {
	throw new Error("not implemented");
}

/**
 * Reports a file's parse: `file_uploaded` with its format, or `parse_failed` with the reason.
 * Pasted text reports nothing. Nothing else leaves: not the name, the size or any text.
 */
export function reportParse(
	_source: { kind: "text" } | { kind: "file" },
	_outcome: ParseOutcome,
	_track: TrackLoose,
): void {
	throw new Error("not implemented");
}
