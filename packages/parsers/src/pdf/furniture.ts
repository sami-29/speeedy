/**
 * Page furniture: running heads, running feet and page numbers.
 *
 * A line is furniture when it sits in the top or bottom band of a page and the same line
 * (digits ignored) sits at the same distance from the same edge on enough other pages. A
 * bare page number is furniture on its own when it sits in a band, set apart from the text
 * or in smaller type. Text that merely looks like body text needs to repeat on most pages
 * before it goes, so a short line such as "Yes." at the top of two pages is kept.
 */
import type { Line, PageLines } from "./layout";

/** The part of a page height that counts as the top or bottom band. */
const BAND = 0.12;
const MAX_FURNITURE_CHARS = 120;
const MAX_DELTAS = 50_000;

export type BodyStats = { size: number; pitch: number };

const median = (values: number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** The usual type size (by amount of text) and the usual distance between baselines. */
export function bodyStats(pages: PageLines[]): BodyStats {
	const bySize = new Map<number, number>();
	const deltas: number[] = [];
	for (const page of pages) {
		let previous: Line | null = null;
		for (const line of page.lines) {
			const key = Math.round(line.size * 2) / 2;
			bySize.set(key, (bySize.get(key) ?? 0) + line.text.length);
			if (
				previous &&
				previous.group === line.group &&
				deltas.length < MAX_DELTAS &&
				Math.abs(previous.size - line.size) <= 0.1 * line.size
			) {
				const delta = previous.y - line.y;
				if (delta > 0.8 * line.size && delta < 3 * line.size)
					deltas.push(delta);
			}
			previous = line;
		}
	}
	let size = 11;
	let most = -1;
	for (const [key, amount] of bySize) {
		if (amount > most) {
			most = amount;
			size = key;
		}
	}
	return { size, pitch: median(deltas) || size * 1.2 };
}

const ROMAN_LOWER = /^[ivxlcdm]{1,7}$/;
const ROMAN_UPPER = /^[IVXLCDM]{2,7}$/;

/** "12", "- 12 -", "Page 12", "12 of 40", "12 / 40", "xii": a page number and nothing else. */
export function isPageNumber(text: string): boolean {
	const core = text
		.replace(
			/^[\s\-\u2010-\u2015\u2212\u00b7\u2022|]+|[\s\-\u2010-\u2015\u2212\u00b7\u2022|]+$/g,
			"",
		)
		.replace(/^page\s*/i, "");
	if (core === "") return false;
	if (/^\d{1,5}(?:\s*(?:of|\/)\s*\d{1,5})?$/i.test(core)) return true;
	return ROMAN_LOWER.test(core) || ROMAN_UPPER.test(core);
}

const normalise = (text: string): string =>
	text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

type Candidate = {
	page: number;
	line: Line;
	side: "top" | "bottom";
	distance: number;
	separated: boolean;
};

function candidatesOf(
	page: PageLines,
	index: number,
	stats: BodyStats,
): Candidate[] {
	const band = page.height * BAND;
	const eligible = (line: Line) => line.text.length <= MAX_FURNITURE_CHARS;
	const inTop = (line: Line) => page.height - line.y < band;
	const inBottom = (line: Line) => line.y < band;
	const sorted = [...page.lines].sort((a, b) => b.y - a.y);
	const found: Candidate[] = [];
	sorted.forEach((line, k) => {
		if (!eligible(line)) return;
		const top = inTop(line);
		if (!top && !inBottom(line)) return;
		// The line next to it, toward the body. A page of one line has nothing next to it.
		const neighbour = sorted[k + (top ? 1 : -1)];
		const gap = neighbour
			? Math.abs(line.y - neighbour.y)
			: Number.POSITIVE_INFINITY;
		found.push({
			page: index,
			line,
			side: top ? "top" : "bottom",
			distance: top ? page.height - line.y : line.y,
			separated: gap >= 1.5 * stats.pitch,
		});
	});
	return found;
}

/** Remove running heads, feet and page numbers. Returns pages with those lines gone. */
export function removeFurniture(
	pages: PageLines[],
	stats: BodyStats,
): PageLines[] {
	const groups = new Map<string, Candidate[]>();
	pages.forEach((page, index) => {
		for (const candidate of candidatesOf(page, index, stats)) {
			const key = `${candidate.side}|${normalise(candidate.line.text)}`;
			let list = groups.get(key);
			if (!list) {
				list = [];
				groups.set(key, list);
			}
			list.push(candidate);
		}
	});

	const remove = new Set<Line>();
	for (const list of groups.values()) {
		const reference = median(list.map((c) => c.distance));
		const members = list.filter(
			(c) => Math.abs(c.distance - reference) <= Math.max(3, 0.5 * c.line.size),
		);
		const repeats = new Set(members.map((c) => c.page)).size;
		for (const c of members) {
			const smaller = c.line.size <= 0.92 * stats.size;
			const margin = c.separated || smaller;
			const number = isPageNumber(c.line.text);
			const enough =
				repeats >= Math.max(2, Math.ceil(pages.length * 0.2)) || repeats >= 5;
			if (
				(number && (margin || repeats >= 2)) ||
				(repeats >= 2 && margin && enough) ||
				repeats >= Math.max(3, Math.ceil(pages.length * 0.5))
			) {
				remove.add(c.line);
			}
		}
	}
	if (remove.size === 0) return pages;
	return pages.map((page) => ({
		...page,
		lines: page.lines.filter((line) => !remove.has(line)),
	}));
}
