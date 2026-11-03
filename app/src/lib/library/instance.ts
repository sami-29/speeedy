import { createLibraryStore, type LibraryStore } from "./store.ts";

let instance: LibraryStore | undefined;

/** The one Library of this page. Created on first use, in the browser only. */
export function library(): LibraryStore {
	instance ??= createLibraryStore();
	return instance;
}
