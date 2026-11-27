import { isPosition, type Position } from "@speeedy/contracts";
import { isRecord, readJson, writeJson } from "../device-storage.ts";
import type { LibraryStore } from "./store.ts";

/**
 * Where the last Position lives until IndexedDB has it. A write to IndexedDB cannot finish
 * once the page is gone (a refresh, a closed tab), and a pause is often followed by exactly
 * that. `localStorage` writes at once, so the Position is put there first and taken back
 * into the Library on the next visit. It holds a document ID and a place in it, no text.
 */
export const PENDING_POSITION_KEY = "speeedy.pending-position";

export type PendingPosition = {
	id: string;
	position: Position;
	progress: number;
	/** When the reader was there, in ms since the epoch. */
	at: number;
};

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function readPending(
	storage: KeyValueStore | undefined,
): PendingPosition | null {
	const value = readJson(storage, PENDING_POSITION_KEY);
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		!isPosition(value.position) ||
		typeof value.progress !== "number" ||
		!Number.isFinite(value.progress) ||
		typeof value.at !== "number"
	) {
		return null;
	}
	return {
		id: value.id,
		position: value.position,
		progress: value.progress,
		at: value.at,
	};
}

function clearPending(storage: KeyValueStore | undefined, at: number) {
	try {
		// A newer Position written meanwhile is not this one's to remove.
		if (readPending(storage)?.at === at) {
			storage?.removeItem(PENDING_POSITION_KEY);
		}
	} catch {
		// Storage blocked: nothing was kept.
	}
}

/** What the Position saver keeps a document's Position in until the Library has it. */
export type PositionKeeper = {
	/** Write the Position now, before the Library write that follows it. */
	keep(position: Position, progress: number): number;
	/** The Library has the Position that `keep` returned this for: it is no longer pending. */
	release(kept: number): void;
};

export function createPositionKeeper(
	storage: KeyValueStore | undefined,
	id: string,
	now: () => number = Date.now,
): PositionKeeper {
	let last = 0;
	return {
		keep(position, progress) {
			// Two Positions in one millisecond must still tell apart.
			last = Math.max(now(), last + 1);
			writeJson(storage, PENDING_POSITION_KEY, {
				id,
				position,
				progress,
				at: last,
			} satisfies PendingPosition);
			return last;
		},
		release(kept) {
			clearPending(storage, kept);
		},
	};
}

/**
 * Take back into the Library a Position the last page left pending, unless the Library
 * already holds a later read of that document. A missing document drops it.
 */
export async function recoverPendingPosition(
	storage: KeyValueStore | undefined,
	store: Pick<LibraryStore, "get" | "savePosition">,
): Promise<void> {
	const pending = readPending(storage);
	if (!pending) return;
	try {
		const meta = await store.get(pending.id);
		if (meta && meta.positionChangedAt < pending.at) {
			await store.savePosition(pending.id, pending.position, pending.progress);
		}
		clearPending(storage, pending.at);
	} catch {
		// The Library is out of reach: it stays pending for the next visit.
	}
}
