import { type Compound, isCompoundFile, openCompound } from "./cfb";
import { normalizeText } from "./clean";
import { decodeWindows1252 } from "./cp1252";
import { brokenTextFailure, SuspectCounter } from "./suspect";
import { type BlockSink, ParseFailure } from "./types";

export { isCompoundFile };

/**
 * Word 97 to 2003 (`.doc`) to Document blocks, with no DOM and no dependency.
 *
 * A `.doc` is a compound file (see `cfb.ts`) with a `WordDocument` stream and a table stream
 * (`0Table` or `1Table`). The text is not stored in order: the "piece table" in the table
 * stream lists runs of characters (pieces), each pointing at bytes in `WordDocument` and each
 * either 8-bit text or UTF-16. Reading goes: FIB (file information block, at the start of
 * `WordDocument`) to the piece table (CLX) to the text.
 *
 * Choices:
 * - Only the main document text is read: characters 0 up to `ccpText`. Footnotes, headers,
 *   comments and text boxes follow it in the character space and are left out.
 * - 8-bit ("compressed") pieces are Windows-1252, which is what the format defines. A Word
 *   file in another ANSI code page writes its text as UTF-16 pieces; a Turkish file made by
 *   Word with 8-bit pieces has not been seen, and its test is skipped.
 * - Structure beyond paragraphs is not read: headings and list numbering live in the style
 *   sheet and paragraph properties, which are not parsed. Table cells (ending in 0x07) become
 *   table-text blocks, every other paragraph a paragraph block, with no spans.
 * - Fields (0x13 begin, 0x14 separator, 0x15 end): the instruction (before the separator) is
 *   hidden, the result is kept. A paragraph or cell mark inside an instruction cannot be valid,
 *   so it ends the damaged field instead of hiding the rest of the document.
 * - Pieces are ranges of one character stream, so a UTF-16 surrogate pair split between two
 *   neighbouring pieces is joined.
 * - Password-protected files (the FIB's encrypted flag) are `drm`. Word 6 and 95 files are
 *   refused with a message to save them in a newer format.
 *
 * Hostile input: counts and offsets are checked against the stream they point into, the
 * piece table's character positions must not go backwards, and the bytes the pieces read in
 * total may not exceed the stream's own length, so overlapping pieces cannot multiply the text.
 */

const FIB_MIN = 0x1a6 + 4;
const FIB_FC_CLX = 418;
const FIB_LCB_CLX = 422;
const FIB_PAIRS_AT = 154;
const MAX_FIELD_DEPTH = 256;

const OLD_MESSAGE =
	"This is a Word file from before Word 97 (Word 6 or 95). Open it in Word, save it as .docx and open that instead.";

const fail = (why = "Speeedy could not read this file."): ParseFailure =>
	new ParseFailure("unsupported", why);

/** The piece table: where each run of main-document characters lives. */
type Piece = { chars: number; offset: number; compressed: boolean };

function readPieces(
	word: Uint8Array,
	table: Uint8Array,
	ccpText: number,
): Piece[] {
	const fcClx = new DataView(
		word.buffer,
		word.byteOffset,
		word.byteLength,
	).getUint32(FIB_FC_CLX, true);
	const lcbClx = new DataView(
		word.buffer,
		word.byteOffset,
		word.byteLength,
	).getUint32(FIB_LCB_CLX, true);
	if (lcbClx < 5 || fcClx + lcbClx > table.length) throw fail();
	const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);
	const end = fcClx + lcbClx;
	let at = fcClx;
	// Skip property-modifier groups (Prc) until the piece table (Pcdt).
	while (at < end) {
		const kind = table[at];
		if (kind === 0x01) {
			if (at + 3 > end) throw fail();
			at += 3 + tv.getUint16(at + 1, true);
			if (at > end) throw fail();
			continue;
		}
		if (kind === 0x02) break;
		throw fail();
	}
	if (at + 5 > end || table[at] !== 0x02) throw fail();
	const lcb = tv.getUint32(at + 1, true);
	const plc = at + 5;
	if (lcb < 4 || (lcb - 4) % 12 !== 0 || plc + lcb > end) throw fail();
	const count = (lcb - 4) / 12;
	const pieceAt = plc + (count + 1) * 4;

	const pieces: Piece[] = [];
	let consumed = 0;
	let previous = tv.getUint32(plc, true);
	if (previous !== 0) throw fail();
	for (let k = 0; k < count; k++) {
		const next = tv.getUint32(plc + (k + 1) * 4, true);
		if (next < previous) throw fail();
		const start = previous;
		previous = next;
		if (start >= ccpText) continue;
		const chars = Math.min(next, ccpText) - start;
		if (chars === 0) continue;
		const fc = tv.getUint32(pieceAt + k * 8 + 2, true);
		const compressed = (fc & 0x40000000) !== 0;
		const raw = fc & 0x3fffffff;
		const offset = compressed ? Math.floor(raw / 2) : raw;
		const bytes = chars * (compressed ? 1 : 2);
		if (offset + bytes > word.length) throw fail();
		consumed += bytes;
		if (consumed > word.length) throw fail();
		pieces.push({ chars, offset, compressed });
	}
	return pieces;
}

/** The document text, one piece at a time, through Word's control characters. */
class WordText {
	private parts: string[] = [];
	private readonly fields = new Uint8Array(MAX_FIELD_DEPTH);
	private depth = 0;
	private overflow = 0;
	private hidden = 0;

	private readonly sink: BlockSink;
	private readonly stats: SuspectCounter;

	constructor(sink: BlockSink, stats: SuspectCounter) {
		this.sink = sink;
		this.stats = stats;
	}

	private flush(kind: "paragraph" | "table-text"): void {
		const raw =
			this.parts.length === 1 ? (this.parts[0] ?? "") : this.parts.join("");
		this.parts = [];
		if (raw === "") return;
		const text = normalizeText(raw).replace(/ {2,}/g, " ").trim();
		if (text === "") return;
		this.sink.push({ kind, text, spans: [] });
	}

	private popField(): void {
		if (this.overflow > 0) {
			this.overflow--;
			this.hidden--;
			return;
		}
		if (this.depth === 0) return;
		this.depth--;
		if (this.fields[this.depth] === 0) this.hidden--;
	}

	add(text: string): void {
		let run = this.hidden === 0 ? 0 : -1;
		const length = text.length;
		for (let i = 0; i < length; i++) {
			const code = text.charCodeAt(i);
			if (code >= 0x20) continue;
			if (run >= 0 && run < i) {
				const piece = text.slice(run, i);
				this.stats.add(piece);
				this.parts.push(piece);
			}
			switch (code) {
				case 0x13:
					if (this.depth < MAX_FIELD_DEPTH) {
						this.fields[this.depth++] = 0;
					} else {
						this.overflow++;
					}
					this.hidden++;
					break;
				case 0x14:
					if (
						this.overflow === 0 &&
						this.depth > 0 &&
						this.fields[this.depth - 1] === 0
					) {
						this.fields[this.depth - 1] = 1;
						this.hidden--;
					}
					break;
				case 0x15:
					this.popField();
					break;
				case 0x0d:
				case 0x0c:
					while (this.hidden > 0) this.popField();
					if (this.hidden === 0) this.flush("paragraph");
					break;
				case 0x07:
					while (this.hidden > 0) this.popField();
					if (this.hidden === 0) this.flush("table-text");
					break;
				default:
					if (this.hidden === 0) {
						if (code === 0x0b || code === 0x09) this.parts.push(" ");
						else if (code === 0x1e) this.parts.push("-");
					}
			}
			run = this.hidden === 0 ? i + 1 : -1;
		}
		if (run >= 0 && run < length) {
			const piece = text.slice(run);
			this.stats.add(piece);
			this.parts.push(piece);
		}
	}

	finish(): void {
		this.flush("paragraph");
	}
}

function wordStream(file: Compound): Uint8Array {
	const word = file.stream("WordDocument");
	if (!word) {
		if (file.has("EncryptedPackage")) {
			throw new ParseFailure(
				"drm",
				"This Word file is protected by a password or by rights management. Remove the protection in Word and open it again.",
			);
		}
		throw fail("This is a Microsoft Office file, but not a Word document.");
	}
	return word;
}

export function docToBlocks(bytes: Uint8Array, sink: BlockSink): void {
	const file = openCompound(bytes);
	const word = wordStream(file);
	if (word.length < 4) throw fail();
	const view = new DataView(word.buffer, word.byteOffset, word.byteLength);
	const ident = view.getUint16(0, true);
	const nFib = view.getUint16(2, true);
	if (ident === 0xa5dc || (ident === 0xa5ec && nFib < 0x00c1)) {
		throw fail(OLD_MESSAGE);
	}
	if (ident !== 0xa5ec || word.length < FIB_MIN) throw fail();
	const flags = view.getUint16(10, true);
	if ((flags & 0x0100) !== 0 || (flags & 0x8000) !== 0) {
		throw new ParseFailure(
			"drm",
			"This Word file is protected by a password. Remove the protection in Word and open it again.",
		);
	}
	const pairs = view.getUint16(152, true);
	if (
		view.getUint16(32, true) !== 14 ||
		view.getUint16(62, true) !== 22 ||
		pairs < 34 ||
		FIB_PAIRS_AT + pairs * 8 > word.length
	) {
		throw fail();
	}
	const table = file.stream((flags & 0x0200) !== 0 ? "1Table" : "0Table");
	if (!table) throw fail();
	const pieces = readPieces(word, table, view.getUint32(76, true));

	const stats = new SuspectCounter();
	const text = new WordText(sink, stats);
	// One streaming decoder across neighbouring UTF-16 pieces, so a pair split between them is
	// joined; an 8-bit piece or the end first flushes a dangling half as U+FFFD.
	const utf16 = new TextDecoder("utf-16le");
	const flushUtf16 = (): void => {
		const rest = utf16.decode();
		if (rest !== "") text.add(rest);
	};
	for (const piece of pieces) {
		const slice = word.subarray(
			piece.offset,
			piece.offset + piece.chars * (piece.compressed ? 1 : 2),
		);
		if (piece.compressed) {
			flushUtf16();
			text.add(decodeWindows1252(slice));
		} else {
			text.add(utf16.decode(slice, { stream: true }));
		}
	}
	flushUtf16();
	text.finish();
	if (stats.suspect) throw brokenTextFailure("Word");
}
