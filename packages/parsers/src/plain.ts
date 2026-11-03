import { collapseSpaces, isBlank } from "./clean";
import type { BlockSink } from "./types";

/**
 * Plain text to paragraph blocks. A blank line ends a paragraph and the lines of one
 * paragraph are joined with a space (hard-wrapped e-books). A file with no blank line at
 * all is a list of lines, so each line is its own paragraph. `text` must be normalised.
 */
export function plainTextToBlocks(text: string, sink: BlockSink): void {
	const perLine = !hasBlankLine(text);
	let paragraph: string[] = [];

	const flush = () => {
		if (paragraph.length === 0) return;
		sink.push({
			kind: "paragraph",
			text: paragraph.join(" "),
			spans: [],
		});
		paragraph = [];
	};

	let pos = 0;
	const length = text.length;
	while (pos <= length) {
		let end = text.indexOf("\n", pos);
		if (end === -1) end = length;
		const line = text.slice(pos, end);
		pos = end + 1;
		if (isBlank(line)) {
			flush();
			continue;
		}
		paragraph.push(collapseSpaces(line.trim()));
		if (perLine) flush();
	}
	flush();
}

function hasBlankLine(text: string): boolean {
	let pos = 0;
	const length = text.length;
	while (pos <= length) {
		let end = text.indexOf("\n", pos);
		if (end === -1) end = length;
		if (end - pos === 0 || isBlank(text.slice(pos, end))) {
			// The empty line after a trailing newline is not a blank line in the file.
			if (!(end === length && pos === length && pos > 0)) return true;
		}
		pos = end + 1;
	}
	return false;
}
