import { collapseSpaces } from "./clean";
import type { BlockSink } from "./types";

const COMMA = 44;
const QUOTE = 34;
const NEWLINE = 10;
const SEMICOLON = 59;
const TAB = 9;
const SNIFF_LIMIT = 10_000;

/**
 * Pick the cell separator from the first record: a comma wins, then a semicolon (European
 * spreadsheets), then a tab. Quoted text is ignored. A file with none is comma separated.
 */
function detectSeparator(text: string): number {
	let commas = 0;
	let semicolons = 0;
	let tabs = 0;
	let inQuotes = false;
	const limit = Math.min(text.length, SNIFF_LIMIT);
	for (let i = 0; i < limit; i++) {
		const code = text.charCodeAt(i);
		if (code === QUOTE) {
			inQuotes = !inQuotes;
			continue;
		}
		if (inQuotes) continue;
		if (code === NEWLINE) {
			if (commas + semicolons + tabs > 0) break;
		} else if (code === COMMA) {
			commas++;
		} else if (code === SEMICOLON) {
			semicolons++;
		} else if (code === TAB) {
			tabs++;
		}
	}
	if (commas > 0) return COMMA;
	if (semicolons > 0 && semicolons >= tabs) return SEMICOLON;
	if (tabs > 0) return TAB;
	return COMMA;
}

/**
 * CSV to one `table-text` block per row, cells joined by a space, empty cells and empty rows
 * dropped (the 1.x behaviour). Unlike 1.x it parses the whole buffer with quote state, so a
 * quoted cell can hold a line break. A quote only opens a cell at its start; anywhere else
 * it is a plain character. An unterminated quote runs to the end of the file. `text` must
 * be normalised (line breaks are `\n`).
 */
export function csvToBlocks(text: string, sink: BlockSink): void {
	const separator = detectSeparator(text);
	const length = text.length;
	let cells: string[] = [];
	let pos = 0;

	const endRow = () => {
		if (cells.length > 0) {
			const row = cells.join(" ");
			cells = [];
			if (row !== "") sink.push({ kind: "table-text", text: row, spans: [] });
		}
	};
	const addCell = (raw: string) => {
		if (raw === "") return;
		const cell = collapseSpaces(raw.replace(/\n/g, " ")).trim();
		if (cell !== "") cells.push(cell);
	};
	const scanPlain = (from: number): number => {
		let i = from;
		while (i < length) {
			const code = text.charCodeAt(i);
			if (code === separator || code === NEWLINE) break;
			i++;
		}
		return i;
	};

	while (pos < length) {
		let cell: string;
		if (text.charCodeAt(pos) === QUOTE) {
			cell = "";
			pos++;
			for (;;) {
				const close = text.indexOf('"', pos);
				if (close === -1) {
					cell += text.slice(pos);
					pos = length;
					break;
				}
				cell += text.slice(pos, close);
				if (text.charCodeAt(close + 1) === QUOTE) {
					cell += '"';
					pos = close + 2;
				} else {
					pos = close + 1;
					break;
				}
			}
			const tail = scanPlain(pos);
			cell += text.slice(pos, tail);
			pos = tail;
		} else {
			const end = scanPlain(pos);
			cell = text.slice(pos, end);
			pos = end;
		}
		addCell(cell);
		if (pos >= length) break;
		if (text.charCodeAt(pos) === NEWLINE) endRow();
		pos++;
	}
	endRow();
}
