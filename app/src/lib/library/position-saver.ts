import type { Position } from "@speeedy/contracts";
import type { PositionKeeper } from "./pending-position.ts";

export type PositionSaverOptions = {
	/** Writes a Position and its progress. A failure is dropped: reading goes on. */
	save: (position: Position, progress: number) => Promise<unknown>;
	progress: (position: Position) => number;
	/**
	 * Holds each Position at once, before `save` starts: `save` is async and cannot finish if
	 * the page goes first. It is released when `save` has finished.
	 */
	keeper?: PositionKeeper;
	/** How often a playing reader's Position is written. */
	intervalMs?: number;
};

export type PositionSaver = {
	/** Note where the reader is. `final` writes at once (a pause or the end). */
	record(position: Position, final: boolean): void;
	flush(): void;
	/** Write what is pending and stop. */
	dispose(): void;
};

/**
 * Keeps a document's Position current without a write per word: the latest Position is
 * written on a pause, every couple of seconds while playing, and when the tab hides.
 */
export function createPositionSaver(
	options: PositionSaverOptions,
): PositionSaver {
	let latest: Position | undefined;
	let dirty = false;

	const flush = () => {
		if (!latest || !dirty) return;
		dirty = false;
		const progress = options.progress(latest);
		const kept = options.keeper?.keep(latest, progress);
		options
			.save(latest, progress)
			.then(() => {
				if (kept !== undefined) options.keeper?.release(kept);
			})
			.catch(() => undefined);
	};
	const onHide = () => {
		if (document.visibilityState === "hidden") flush();
	};

	const timer = setInterval(flush, options.intervalMs ?? 2000);
	window.addEventListener("pagehide", flush);
	document.addEventListener("visibilitychange", onHide);

	return {
		record(position, final) {
			latest = position;
			dirty = true;
			if (final) flush();
		},
		flush,
		dispose() {
			flush();
			clearInterval(timer);
			window.removeEventListener("pagehide", flush);
			document.removeEventListener("visibilitychange", onHide);
		},
	};
}
