import { type BlockSink, ParseFailure } from "./types";

export type RtfMeta = { title: string | null };

/** Does the file open with an RTF header? */
export function isRtf(_bytes: Uint8Array): boolean {
	return false;
}

export function rtfToBlocks(_bytes: Uint8Array, _sink: BlockSink): RtfMeta {
	throw new ParseFailure("unsupported", "Speeedy could not read this file.");
}
