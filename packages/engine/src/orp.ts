import type { Orp } from "./types";

export type OrpFocus = "early" | "balanced" | "late";

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Split a word around its Optimal Recognition Point: a little left of centre, counted over
 * letters and digits only. Surrounding punctuation stays outside the pivot.
 */
export function computeOrp(text: string, focus: OrpFocus = "balanced"): Orp {
	const leading = text.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? "";
	const trailing = text.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";

	if (leading === text) return { before: "", pivot: text, after: "" };

	const core = text.slice(leading.length, text.length - trailing.length);
	const length = core.replace(/[^\p{L}\p{N}]/gu, "").length;

	let pivotIndex: number;
	if (length <= 1) pivotIndex = 0;
	else if (length <= 5) pivotIndex = 1;
	else if (length <= 9) pivotIndex = 2;
	else pivotIndex = 3;

	if (focus === "early" && pivotIndex > 0) pivotIndex--;
	else if (focus === "late" && pivotIndex < Math.min(length - 1, 4))
		pivotIndex++;

	const start = findLetter(core, pivotIndex);
	let end = start + String.fromCodePoint(core.codePointAt(start) ?? 0).length;
	while (end < core.length) {
		const next = String.fromCodePoint(core.codePointAt(end) ?? 0);
		if (!/^\p{M}$/u.test(next)) break;
		end += next.length;
	}

	return {
		before: leading + core.slice(0, start),
		pivot: core.slice(start, end),
		after: core.slice(end) + trailing,
	};
}

/** UTF-16 index of the nth letter or digit in `text`. */
function findLetter(text: string, nth: number): number {
	let count = 0;
	for (let i = 0; i < text.length; ) {
		const char = String.fromCodePoint(text.codePointAt(i) ?? 0);
		if (WORD_CHAR.test(char)) {
			if (count === nth) return i;
			count++;
		}
		i += char.length;
	}
	return 0;
}
