import type { Engine, Frame } from "@speeedy/engine";

/** The text of the current Frame: characters `[from, to)` of one block. */
export type PacerRange = { block: number; from: number; to: number };

export const frameRange = (frame: Frame): PacerRange => ({
	block: frame.position.block,
	from: frame.position.offset,
	to: frame.end.offset,
});

/**
 * Tells `show` which text the Engine's Cursor is on: at once, then on every new Frame and
 * after every seek or rewind (which a paused Engine makes without showing a Frame). The
 * Engine's Clock paces it; this has no timer of its own. Returns a function that stops.
 */
export function followCursor(
	engine: Pick<Engine, "on" | "frame">,
	show: (range: PacerRange) => void,
): () => void {
	let last: PacerRange | undefined;
	const follow = (frame: Frame | undefined) => {
		if (!frame) return;
		const range = frameRange(frame);
		if (
			last &&
			last.block === range.block &&
			last.from === range.from &&
			last.to === range.to
		) {
			return;
		}
		last = range;
		show(range);
	};
	const stops = [
		engine.on("frameShown", ({ frame }) => follow(frame)),
		engine.on("seek", () => follow(engine.frame)),
	];
	follow(engine.frame);
	return () => {
		for (const stop of stops) stop();
	};
}
