import { type BlockSink, ParseFailure } from "./types";

/** Does the file open with the OLE compound file header that a Word 97 document uses? */
export function isCompoundFile(_bytes: Uint8Array): boolean {
	return false;
}

export function docToBlocks(_bytes: Uint8Array, _sink: BlockSink): void {
	throw new ParseFailure("unsupported", "Speeedy could not read this file.");
}
