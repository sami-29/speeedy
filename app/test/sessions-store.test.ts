import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLibraryStore,
	LIBRARY_DB_NAME,
	type LibraryStore,
} from "../src/lib/library/store.ts";

let counter = 0;
let store: LibraryStore;
let name: string;

beforeEach(() => {
	name = `${LIBRARY_DB_NAME}-sessions-${++counter}`;
	store = createLibraryStore({ name, now: () => 5_000 });
});

afterEach(() => store.close());

const base = {
	date: "2026-11-03",
	startedAt: 1_000,
	activeMs: 90_000,
	wordsRead: 300,
	wpm: 200,
	documentId: null,
};

describe("storing Sessions", () => {
	it("refuses a Session that could not have happened", async () => {
		const bad: Record<string, unknown>[] = [
			{ activeMs: -1 },
			{ activeMs: Number.NaN },
			{ wordsRead: -5 },
			{ wordsRead: 1.5 },
			{ wpm: -1 },
			{ startedAt: Number.POSITIVE_INFINITY },
			{ date: "2026-13-45" },
			{ date: "yesterday" },
			{ documentId: 7 },
		];
		for (const change of bad) {
			await expect(
				store.addSession({ ...base, ...change } as never),
			).rejects.toMatchObject({ code: "invalid-argument" });
		}
		expect(await store.sessions()).toEqual([]);
	});

	it("skips a damaged record when reading, and keeps the rest", async () => {
		await store.addSession(base);
		await store.addSession({ ...base, startedAt: 2_000 });
		// Another tab, an older build or a hand edit leaves a bad row behind.
		const raw = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const tx = raw.transaction("sessions", "readwrite");
			tx.objectStore("sessions").put({ id: "broken", startedAt: 1_500 });
			tx.objectStore("sessions").put({
				id: "worse",
				startedAt: 1_600,
				date: "nope",
				activeMs: "lots",
			});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		raw.close();
		const all = await store.sessions();
		expect(all.map((each) => each.startedAt)).toEqual([1_000, 2_000]);
	});

	it("reads back in start order as plain data a backup file can hold", async () => {
		await store.addSession({ ...base, startedAt: 3_000 });
		await store.addSession({ ...base, startedAt: 1_000 });
		await store.addSession({ ...base, startedAt: 2_000, documentId: "doc-1" });
		const all = await store.sessions();
		expect(all.map((each) => each.startedAt)).toEqual([1_000, 2_000, 3_000]);
		expect(JSON.parse(JSON.stringify(all))).toEqual(all);
		expect(Object.keys(all[0] ?? {}).sort()).toEqual([
			"activeMs",
			"date",
			"documentId",
			"id",
			"startedAt",
			"wordsRead",
			"wpm",
		]);
	});
});
