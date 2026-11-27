import { deviceStorage } from "../device-storage.ts";
import { recoverPendingPosition } from "./pending-position.ts";
import { createLibraryStore, type LibraryStore } from "./store.ts";

let instance: LibraryStore | undefined;

/** The one Library of this page. Created on first use, in the browser only. */
export function library(): LibraryStore {
	instance ??= createLibraryStore();
	return instance;
}

let recovered: Promise<void> | undefined;

/**
 * Settles once a Position the last page left pending (a refresh or a closed tab right after
 * a pause) is back in the Library. Once per page: this page writes its own Positions through
 * the saver. Await it before reading a Position.
 */
export function recoverPositions(): Promise<void> {
	recovered ??= recoverPendingPosition(deviceStorage(), library()).catch(
		() => undefined,
	);
	return recovered;
}
