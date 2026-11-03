/**
 * Page geometry: the text pieces pdf.js reports for one page become lines in reading order.
 *
 * pdf.js gives each run of text with a transform matrix and a width, in the page's own
 * coordinates, in the order the file draws them. That order is whatever the producer chose:
 * a two-column page may list the columns one after the other, or row by row. So the lines are
 * rebuilt from position alone:
 *
 * 1. Text turned away from the page's main direction (a margin stamp, a watermark) is dropped,
 *    and a page whose text is all turned a quarter turn is read upright. A page set right to
 *    left is mirrored, so everything after this step can read left to right.
 * 2. Neighbouring pieces on one baseline become a piece; pieces far apart stay apart.
 * 3. A vertical strip that no narrow piece crosses, with text on both sides, is a gutter. Pieces
 *    that cross a gutter span the columns. Text is read zone by zone (a zone is the stretch
 *    between spanning pieces), left column before right.
 * 4. Pieces on one baseline within a column become a line.
 *
 * Everything here is pure and bounded by the number of pieces, so a hostile page costs at most
 * a sort.
 */

/** One run of text as pdf.js reports it. */
export type RawItem = {
	str: string;
	transform: number[];
	width: number;
	fontName: string;
	/** Text direction as pdf.js reports it: "ltr", "rtl" or "ttb". */
	dir?: string;
};

export type Line = {
	text: string;
	x0: number;
	x1: number;
	/** Baseline, measured up from the bottom of the page. */
	y: number;
	size: number;
	font: string;
	/** Lines of one column in one zone share a group; reading order runs group by group. */
	group: number;
	/** True for a line that spans the columns (a title, a caption, a page number). */
	spanning: boolean;
};

export type PageLines = {
	width: number;
	height: number;
	lines: Line[];
	/** Characters that were not spaces, for telling a scan from a text page. */
	chars: number;
};

const MIN_SIZE = 1;
const MAX_SIZE = 400;
/** Text this close to a quarter turn counts as turned; anything else is a diagonal. */
const AXIS_TOLERANCE = 0.2;
const SPACE_GAP = 0.15;
/** Wider than a loose word space, narrower than the 1 em that columns are usually apart. */
const PIECE_GAP = 0.9;
const MAX_PIECES = 400_000;
/** The top and bottom of the page, as a share of its height, where running heads live. */
const MARGIN_BAND = 0.08;
/** Candidate gutters checked per page; noise on a hostile page cannot cost more than this. */
const MAX_GUTTER_CANDIDATES = 32;

type Fragment = {
	text: string;
	x0: number;
	x1: number;
	y: number;
	size: number;
	font: string;
	chars: number;
};

const isFinite2 = (...values: number[]) => values.every(Number.isFinite);

/** Which quarter turn the text runs at: 0 is upright, 1 reads bottom to top, and so on. */
function quarterOf(transform: number[]): number {
	const [a = 0, b = 0] = transform;
	const angle = Math.atan2(b, a);
	const turns = Math.round(angle / (Math.PI / 2));
	if (Math.abs(angle - turns * (Math.PI / 2)) > AXIS_TOLERANCE) return -1;
	return ((turns % 4) + 4) % 4;
}

function upright(quarter: number, x: number, y: number): [number, number] {
	switch (quarter) {
		case 1:
			return [y, -x];
		case 2:
			return [-x, -y];
		case 3:
			return [-y, x];
		default:
			return [x, y];
	}
}

const charsOf = (text: string): number => text.replace(/\s/g, "").length;

function toFragments(
	items: RawItem[],
	view: number[],
): { fragments: Fragment[]; width: number; height: number } {
	const votes = [0, 0, 0, 0];
	for (const item of items) {
		const { transform } = item;
		if (!Array.isArray(transform) || transform.length < 6) continue;
		if (typeof item.str !== "string") continue;
		const quarter = quarterOf(transform);
		if (quarter >= 0)
			votes[quarter] = (votes[quarter] ?? 0) + charsOf(item.str);
	}
	let main = 0;
	for (let q = 1; q < 4; q++)
		if ((votes[q] ?? 0) > (votes[main] ?? 0)) main = q;

	const [vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0] = view;
	const corners = [upright(main, vx0, vy0), upright(main, vx1, vy1)] as const;
	let bx0 = Math.min(corners[0][0], corners[1][0]);
	let bx1 = Math.max(corners[0][0], corners[1][0]);
	let by0 = Math.min(corners[0][1], corners[1][1]);
	let by1 = Math.max(corners[0][1], corners[1][1]);
	const knownPage = isFinite2(bx0, bx1, by0, by1) && bx1 > bx0 && by1 > by0;

	const raw: Fragment[] = [];
	let rtlChars = 0;
	let otherChars = 0;
	for (const item of items) {
		const { transform } = item;
		if (!Array.isArray(transform) || transform.length < 6) continue;
		if (typeof item.str !== "string" || item.str.trim() === "") continue;
		if (quarterOf(transform) !== main) continue;
		const [a = 0, b = 0, , , e = 0, f = 0] = transform;
		const size = Math.hypot(a, b);
		const width = Number.isFinite(item.width) ? Math.max(0, item.width) : 0;
		if (!isFinite2(size, e, f) || size < MIN_SIZE || size > MAX_SIZE) continue;
		const [x, y] = upright(main, e, f);
		if (!isFinite2(x, y)) continue;
		if (item.dir === "rtl") rtlChars += charsOf(item.str);
		else otherChars += charsOf(item.str);
		raw.push({
			text: item.str,
			x0: x,
			x1: x + width,
			y,
			size,
			font: typeof item.fontName === "string" ? item.fontName : "",
			chars: charsOf(item.str),
		});
	}
	if (!knownPage) {
		bx0 = 0;
		bx1 = 0;
		by0 = 0;
		by1 = 0;
		for (const r of raw) {
			bx0 = Math.min(bx0, r.x0);
			bx1 = Math.max(bx1, r.x1);
			by0 = Math.min(by0, r.y);
			by1 = Math.max(by1, r.y);
		}
	}
	const width = bx1 - bx0;
	const height = by1 - by0;
	const slackX = width * 0.02 + 12;
	const slackY = height * 0.02 + 12;
	const mirror = rtlChars > otherChars;
	const fragments: Fragment[] = [];
	for (const r of raw) {
		if (
			r.x0 < bx0 - slackX ||
			r.x0 > bx1 + slackX ||
			r.y < by0 - slackY ||
			r.y > by1 + slackY
		) {
			continue;
		}
		const left = r.x0 - bx0;
		const right = r.x1 - bx0;
		fragments.push({
			...r,
			x0: mirror ? width - right : left,
			x1: mirror ? width - left : right,
			y: r.y - by0,
		});
	}
	return { fragments, width, height };
}

type Piece = Fragment & { bestChars: number };

/** Can a space go between these two characters? Not between two Han or kana characters. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function joinText(
	left: string,
	right: string,
	gap: number,
	size: number,
): string {
	if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
	if (CJK.test(left.slice(-1)) && CJK.test(right.charAt(0)))
		return left + right;
	return gap > size * SPACE_GAP ? `${left} ${right}` : left + right;
}

/** Merge fragments that follow each other on one baseline into pieces. */
function toPieces(fragments: Fragment[]): Piece[] {
	const pieces: Piece[] = [];
	let current: Piece | null = null;
	let last: Fragment | null = null;
	for (const f of fragments) {
		if (
			last &&
			f.text === last.text &&
			Math.abs(f.x0 - last.x0) < f.size * 0.15 &&
			Math.abs(f.y - last.y) < f.size * 0.15
		) {
			// The same text drawn twice in the same place (fake bold, a shadow).
			continue;
		}
		const gap = current ? f.x0 - current.x1 : 0;
		const continues =
			current !== null &&
			Math.abs(f.y - current.y) <= 0.35 * Math.max(f.size, current.size) &&
			gap >= -0.5 * f.size &&
			gap <= PIECE_GAP * f.size;
		if (current && continues) {
			current.text = joinText(current.text, f.text, gap, f.size);
			current.x1 = Math.max(current.x1, f.x1);
			current.chars += f.chars;
			if (f.chars > current.bestChars) {
				current.bestChars = f.chars;
				current.size = f.size;
				current.font = f.font;
				current.y = f.y;
			}
		} else {
			current = { ...f, bestChars: f.chars };
			pieces.push(current);
		}
		last = f;
	}
	return pieces;
}

const median = (values: number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Vertical strips between columns, as [start, end] intervals, left to right.
 *
 * Count how many narrow pieces cover each x. A gutter is a stretch at least a little wider
 * than a word space where almost nothing does (a running head or a page number may still
 * cross it), with a real body of text on both sides at overlapping heights.
 */
function findGutters(pieces: Piece[], height: number): [number, number][] {
	if (pieces.length < 6) return [];
	let xmin = Number.POSITIVE_INFINITY;
	let xmax = Number.NEGATIVE_INFINITY;
	for (const p of pieces) {
		xmin = Math.min(xmin, p.x0);
		xmax = Math.max(xmax, p.x1);
	}
	const span = xmax - xmin;
	if (!(span > 0)) return [];
	// Running heads and feet often cross the gutter, so they take no part in finding it.
	const band = height * MARGIN_BAND;
	const narrow = pieces.filter(
		(p) => p.x1 - p.x0 <= span * 0.55 && p.y > band && p.y < height - band,
	);
	if (narrow.length < 6) return [];
	const minGap = Math.max(6, 0.6 * median(pieces.map((p) => p.size)));
	const support = Math.max(3, Math.ceil(narrow.length * 0.15));
	const tolerance = Math.floor(narrow.length / 30);

	const events: [number, number][] = [];
	for (const p of narrow) events.push([p.x0, 1], [p.x1, -1]);
	events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);

	const gutters: [number, number][] = [];
	let count = 0;
	let lowStart: number | null = null;
	let tried = 0;
	const close = (end: number) => {
		if (lowStart === null) return;
		const start = lowStart;
		lowStart = null;
		if (end - start < minGap || tried++ >= MAX_GUTTER_CANDIDATES) return;
		const left = narrow.filter((q) => (q.x0 + q.x1) / 2 < start);
		const right = narrow.filter((q) => (q.x0 + q.x1) / 2 > end);
		if (
			left.length >= support &&
			right.length >= support &&
			overlapsVertically(left, right)
		) {
			gutters.push([start, end]);
		}
	};
	for (const [x, delta] of events) {
		if (lowStart !== null && count + delta > tolerance) close(x);
		count += delta;
		if (lowStart === null && count <= tolerance) lowStart = x;
	}
	return gutters;
}

function overlapsVertically(a: Piece[], b: Piece[]): boolean {
	const range = (set: Piece[]) => {
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		for (const p of set) {
			low = Math.min(low, p.y);
			high = Math.max(high, p.y);
		}
		return [low, high];
	};
	const [a0 = 0, a1 = 0] = range(a);
	const [b0 = 0, b1 = 0] = range(b);
	const overlap = Math.min(a1, b1) - Math.max(a0, b0);
	const smaller = Math.min(a1 - a0, b1 - b0);
	return overlap >= 0.3 * smaller && overlap > 0;
}

/** Group pieces on one baseline into lines; returns lines top to bottom. */
function toLines(pieces: Piece[], group: number, spanning: boolean): Line[] {
	const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x0 - b.x0);
	const clusters: Piece[][] = [];
	let anchor: Piece | null = null;
	for (const p of sorted) {
		if (
			anchor &&
			Math.abs(p.y - anchor.y) <= 0.5 * Math.max(p.size, anchor.size)
		) {
			clusters[clusters.length - 1]?.push(p);
		} else {
			clusters.push([p]);
			anchor = p;
		}
	}
	return clusters.map((cluster) => {
		cluster.sort((a, b) => a.x0 - b.x0);
		let text = "";
		let x1 = Number.NEGATIVE_INFINITY;
		let main = cluster[0] as Piece;
		for (const p of cluster) {
			text =
				text === ""
					? p.text
					: joinText(text, p.text, p.x0 - x1, Math.max(p.size, main.size));
			x1 = Math.max(x1, p.x1);
			if (p.chars > main.chars) main = p;
		}
		return {
			text: text.replace(/\s+/g, " ").trim(),
			x0: cluster[0]?.x0 ?? 0,
			x1,
			y: main.y,
			size: main.size,
			font: main.font,
			group,
			spanning,
		};
	});
}

/** Rebuild the lines of one page, in reading order. */
export function buildPageLines(items: RawItem[], view: number[]): PageLines {
	const { fragments, width, height } = toFragments(items, view);
	const chars = fragments.reduce((n, f) => n + f.chars, 0);
	const pieces = toPieces(fragments.slice(0, MAX_PIECES));
	const gutters = findGutters(pieces, height);

	if (gutters.length === 0) {
		return { width, height, chars, lines: toLines(pieces, 0, false) };
	}

	// A piece spans the columns when it reaches into both edges of a gutter. One that only
	// pokes in from one side (a ragged line, a long web address) stays in its column.
	const crosses = (p: Piece) =>
		gutters.some(([start, end]) => {
			const reach = 0.25 * (end - start);
			return p.x0 < start + reach && p.x1 > end - reach;
		});
	const columnOf = (p: Piece) => {
		const centre = (p.x0 + p.x1) / 2;
		return gutters.filter(([start, end]) => centre > (start + end) / 2).length;
	};
	const spanningPieces = pieces
		.filter(crosses)
		.sort((a, b) => b.y - a.y || a.x0 - b.x0);
	const bodyPieces = pieces.filter((p) => !crosses(p));
	const columnCount = gutters.length + 1;

	// A body piece belongs to the zone after the last spanning piece above it.
	const zoneOf = (p: Piece) => {
		// Spanning pieces run top to bottom, so the zone is found by bisection.
		let low = 0;
		let high = spanningPieces.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if ((spanningPieces[mid]?.y ?? 0) > p.y + 0.5 * p.size) low = mid + 1;
			else high = mid;
		}
		return low;
	};
	const zones = new Map<number, Piece[][]>();
	for (const p of bodyPieces) {
		const zone = zoneOf(p);
		let columns = zones.get(zone);
		if (!columns) {
			columns = Array.from({ length: columnCount }, () => []);
			zones.set(zone, columns);
		}
		columns[columnOf(p)]?.push(p);
	}

	const lines: Line[] = [];
	let group = 1;
	const emitZone = (zone: number) => {
		for (const column of zones.get(zone) ?? []) {
			if (column.length === 0) continue;
			for (const line of toLines(column, group++, false)) lines.push(line);
		}
	};
	emitZone(0);
	// Consecutive spanning lines (a title of several lines) stay one group.
	let spanGroup = -1;
	spanningPieces.forEach((s, index) => {
		const between = zones.get(index)?.some((column) => column.length > 0);
		if (index === 0 || between) spanGroup = group++;
		for (const line of toLines([s], spanGroup, true)) lines.push(line);
		emitZone(index + 1);
	});
	return { width, height, chars, lines };
}
