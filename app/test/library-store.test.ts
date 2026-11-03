import "fake-indexeddb/auto";
import type { Document } from "@speeedy/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLibraryStore,
	effectiveLanguage,
	LIBRARY_DB_NAME,
	LibraryError,
	type LibraryStore,
	SCHEMA_VERSION,
} from "../src/lib/library/store.ts";

let counter = 0;
let clock = 1_000;
const dbName = () => `${LIBRARY_DB_NAME}-test-${++counter}`;

const doc = (...paragraphs: string[]): Document => ({
	version: 1,
	blocks: paragraphs.map((text) => ({ kind: "paragraph", text, spans: [] })),
});

const open = (name: string): LibraryStore =>
	createLibraryStore({ name, now: () => clock });

let name: string;
let store: LibraryStore;
const opened: LibraryStore[] = [];
const track = (created: LibraryStore) => {
	opened.push(created);
	return created;
};

beforeEach(() => {
	clock = 1_000;
	name = dbName();
	store = track(open(name));
});

afterEach(() => {
	for (const each of opened.splice(0)) each.close();
});

const add = (text: string, title = "A title") =>
	store.addDocument({ document: doc(text), title, language: "en" });

describe("documents", () => {
	it("keeps a document with its title, language, source and an unread Position", async () => {
		const { meta, duplicate } = await store.addDocument({
			document: doc("one two three"),
			title: "Notes",
			language: "en",
			sourceUrl: "https://example.com/post",
		});
		expect(duplicate).toBe(false);
		expect(meta).toMatchObject({
			title: "Notes",
			language: "en",
			languageOverride: null,
			source: "own",
			sourceUrl: "https://example.com/post",
			position: { block: 0, offset: 0 },
			progress: 0,
			lastReadAt: null,
			createdAt: 1_000,
			deviceOnly: false,
			sync: { pending: false, remoteId: null },
		});
		expect(meta.contentHash).toMatch(/^[0-9a-f]{64}$/);
		expect(await store.list()).toEqual([meta]);
		const loaded = await store.load(meta.id);
		expect(loaded?.document).toEqual(doc("one two three"));
	});

	it("has no cap: 25 documents all stay, progress included", async () => {
		const ids: string[] = [];
		for (let i = 0; i < 25; i++) {
			const { meta } = await add(`document number ${i}`);
			ids.push(meta.id);
			await store.savePosition(meta.id, { block: 0, offset: 3 }, 0.25);
		}
		const all = await store.list();
		expect(all).toHaveLength(25);
		expect(all.every((meta) => meta.progress === 0.25)).toBe(true);
		expect(new Set(all.map((meta) => meta.id))).toEqual(new Set(ids));
	});

	it("dedupes by content hash, whatever the title", async () => {
		const first = await add("same words here", "First title");
		const second = await add("same words here", "Second title");
		expect(second.duplicate).toBe(true);
		expect(second.meta.id).toBe(first.meta.id);
		expect(second.meta.title).toBe("First title");
		expect(await store.list()).toHaveLength(1);
		const other = await add("different words here");
		expect(other.duplicate).toBe(false);
		expect(await store.list()).toHaveLength(2);
	});

	it("refuses a value that is not a Document and stores nothing", async () => {
		const bad = {
			version: 1,
			blocks: [{ kind: "paragraph", text: "x" }],
		} as unknown as Document;
		await expect(
			store.addDocument({ document: bad, title: "Bad", language: "en" }),
		).rejects.toMatchObject({ code: "invalid-document" });
		await expect(
			store.addDocument({
				document: { version: 2, blocks: [] } as unknown as Document,
				title: "Future",
				language: "en",
			}),
		).rejects.toBeInstanceOf(LibraryError);
		expect(await store.list()).toEqual([]);
	});

	it("lists the most recently read first, unread ones by when they were added", async () => {
		const a = (await add("alpha")).meta;
		clock = 2_000;
		const b = (await add("beta")).meta;
		clock = 3_000;
		const c = (await add("gamma")).meta;
		expect((await store.list()).map((meta) => meta.id)).toEqual([
			c.id,
			b.id,
			a.id,
		]);
		clock = 4_000;
		await store.savePosition(a.id, { block: 0, offset: 2 }, 0.4);
		expect((await store.list()).map((meta) => meta.id)).toEqual([
			a.id,
			c.id,
			b.id,
		]);
	});

	it("survives a reload: a new store on the same database sees everything", async () => {
		const { meta } = await add("persistent words");
		await store.rename(meta.id, "Renamed");
		await store.savePosition(meta.id, { block: 0, offset: 4 }, 0.5);
		store.close();
		const again = track(open(name));
		expect(await again.get(meta.id)).toMatchObject({
			title: "Renamed",
			position: { block: 0, offset: 4 },
			progress: 0.5,
		});
	});
});

describe("rename, Position and language", () => {
	it("renames a document, trimmed, and refuses an empty title", async () => {
		const { meta } = await add("some words");
		clock = 5_000;
		const renamed = await store.rename(meta.id, "  New name  ");
		expect(renamed.title).toBe("New name");
		await expect(store.rename(meta.id, "   ")).rejects.toMatchObject({
			code: "invalid-title",
		});
		expect((await store.get(meta.id))?.title).toBe("New name");
		await expect(store.rename("missing", "x")).rejects.toMatchObject({
			code: "not-found",
		});
	});

	it("saves the Position with progress and the time it was read", async () => {
		const { meta } = await store.addDocument({
			document: doc("first block", "second block"),
			title: "Two",
			language: "en",
		});
		clock = 9_000;
		await store.savePosition(meta.id, { block: 1, offset: 7 }, 0.75);
		expect(await store.get(meta.id)).toMatchObject({
			position: { block: 1, offset: 7 },
			progress: 0.75,
			lastReadAt: 9_000,
			positionChangedAt: 9_000,
		});
	});

	it("hands back a Position clamped into the Document it loads", async () => {
		const { meta } = await store.addDocument({
			document: doc("short"),
			title: "Short",
			language: "en",
		});
		await store.savePosition(meta.id, { block: 40, offset: 900 }, 1);
		const loaded = await store.load(meta.id);
		expect(loaded?.meta.position).toEqual({ block: 0, offset: 5 });
	});

	it("overrides the language per document and clears the override", async () => {
		const { meta } = await store.addDocument({
			document: doc("bonjour tout le monde"),
			title: "Fr",
			language: "und",
		});
		expect(effectiveLanguage(meta)).toBe("und");
		const overridden = await store.setLanguageOverride(meta.id, "fr");
		expect(overridden.languageOverride).toBe("fr");
		expect(overridden.language).toBe("und");
		expect(effectiveLanguage(overridden)).toBe("fr");
		const cleared = await store.setLanguageOverride(meta.id, null);
		expect(effectiveLanguage(cleared)).toBe("und");
		await expect(
			store.setLanguageOverride(meta.id, "not a tag!"),
		).rejects.toMatchObject({ code: "invalid-argument" });
	});

	it("marks a document device-only", async () => {
		const { meta } = await add("private words");
		expect((await store.setDeviceOnly(meta.id, true)).deviceOnly).toBe(true);
		expect((await store.get(meta.id))?.deviceOnly).toBe(true);
	});
});

describe("delete and undo", () => {
	it("deletes the document and its content, and leaves a tombstone", async () => {
		const { meta } = await add("to be deleted");
		clock = 7_000;
		const removed = await store.deleteDocument(meta.id);
		expect(removed.meta.id).toBe(meta.id);
		expect(await store.list()).toEqual([]);
		expect(await store.load(meta.id)).toBeNull();
		expect(await store.tombstones()).toEqual([
			{
				id: meta.id,
				kind: "document",
				contentHash: meta.contentHash,
				deletedAt: 7_000,
			},
		]);
		await expect(store.deleteDocument(meta.id)).rejects.toMatchObject({
			code: "not-found",
		});
	});

	it("restores a deleted document as it was and drops the tombstone", async () => {
		const { meta } = await add("to be restored");
		await store.savePosition(meta.id, { block: 0, offset: 5 }, 0.3);
		const before = await store.get(meta.id);
		const removed = await store.deleteDocument(meta.id);
		await store.restoreDocument(removed);
		expect(await store.get(meta.id)).toEqual(before);
		expect((await store.load(meta.id))?.document).toEqual(
			doc("to be restored"),
		);
		expect(await store.tombstones()).toEqual([]);
	});

	it("clears the current document when it is deleted", async () => {
		const { meta } = await add("current words");
		await store.setCurrent(meta.id);
		expect(await store.currentId()).toBe(meta.id);
		const removed = await store.deleteDocument(meta.id);
		expect(await store.currentId()).toBeNull();
		await store.restoreDocument(removed);
		expect(await store.currentId()).toBeNull();
	});
});

describe("the current document", () => {
	it("is remembered across a reload and can be cleared", async () => {
		expect(await store.currentId()).toBeNull();
		const { meta } = await add("resume me");
		await store.setCurrent(meta.id);
		store.close();
		const again = track(open(name));
		expect(await again.currentId()).toBe(meta.id);
		await again.setCurrent(null);
		expect(await again.currentId()).toBeNull();
	});

	it("reports nothing when the remembered document is gone", async () => {
		await store.setCurrent("never-existed");
		expect(await store.currentId()).toBeNull();
	});
});

describe("settings, Daily Goal, Sessions and Training results", () => {
	it("stores settings as set, each with its own change time, never merged with defaults", async () => {
		expect(await store.settings()).toEqual({});
		clock = 100;
		await store.setSetting("wpm", 320);
		clock = 200;
		await store.setSetting("theme", "night");
		clock = 300;
		await store.setSetting("wpm", 340);
		expect(await store.settings()).toEqual({
			wpm: { value: 340, changedAt: 300 },
			theme: { value: "night", changedAt: 200 },
		});
	});

	it("keeps every Daily Goal change with its effective date", async () => {
		expect(await store.dailyGoalChanges()).toEqual([]);
		clock = 10;
		await store.setDailyGoal({ minutes: 15, effectiveDate: "2026-11-03" });
		clock = 20;
		await store.setDailyGoal({ minutes: 5, effectiveDate: "2026-11-10" });
		const changes = await store.dailyGoalChanges();
		expect(
			changes.map(({ minutes, effectiveDate, changedAt }) => [
				minutes,
				effectiveDate,
				changedAt,
			]),
		).toEqual([
			[15, "2026-11-03", 10],
			[5, "2026-11-10", 20],
		]);
		await expect(
			store.setDailyGoal({ minutes: 5, effectiveDate: "next week" }),
		).rejects.toMatchObject({ code: "invalid-argument" });
		await expect(
			store.setDailyGoal({ minutes: 0, effectiveDate: "2026-11-11" }),
		).rejects.toMatchObject({ code: "invalid-argument" });
	});

	it("keeps Sessions in their own table, with no cap", async () => {
		for (let i = 0; i < 520; i++) {
			await store.addSession({
				date: "2026-11-03",
				startedAt: i,
				activeMs: 60_000,
				wordsRead: 250,
				wpm: 250,
				documentId: null,
			});
		}
		const all = await store.sessions();
		expect(all).toHaveLength(520);
		expect(all[0]).toMatchObject({ startedAt: 0, wordsRead: 250 });
		expect(typeof all[0]?.id).toBe("string");
	});

	it("keeps Training results", async () => {
		clock = 55;
		const saved = await store.addTrainingResult({
			kind: "benchmark",
			scores: { wpm: 310, comprehension: 80 },
		});
		expect(saved).toMatchObject({ kind: "benchmark", completedAt: 55 });
		expect(await store.trainingResults()).toEqual([saved]);
	});
});

describe("the schema", () => {
	it("is versioned and declares every table", async () => {
		await add("anything");
		store.close();
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			expect(db.version).toBe(SCHEMA_VERSION);
			expect([...db.objectStoreNames].sort()).toEqual(
				[
					"contents",
					"dailyGoalChanges",
					"documents",
					"meta",
					"sessions",
					"settings",
					"tombstones",
					"trainingResults",
				].sort(),
			);
		} finally {
			db.close();
		}
	});

	it("refuses a database from a newer build and leaves it alone", async () => {
		const future = dbName();
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(future, SCHEMA_VERSION + 5);
			request.onupgradeneeded = () =>
				request.result.createObjectStore("anything");
			request.onsuccess = () => {
				request.result.close();
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
		const old = track(open(future));
		await expect(old.list()).rejects.toMatchObject({ code: "newer-schema" });
		const databases = await indexedDB.databases();
		expect(databases.find((entry) => entry.name === future)?.version).toBe(
			SCHEMA_VERSION + 5,
		);
	});
});

describe("damaged records (1.x behaviour kept: a bad record never breaks the Library)", () => {
	const rawPut = (storeName: string, value: unknown) =>
		new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => {
				const db = request.result;
				const tx = db.transaction(storeName, "readwrite");
				tx.objectStore(storeName).put(value);
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
			request.onerror = () => reject(request.error);
		});

	it("lists the good documents and skips an incomplete record", async () => {
		const good = (await add("a good one")).meta;
		store.close();
		await rawPut("documents", { id: "broken" });
		const again = track(open(name));
		expect((await again.list()).map((meta) => meta.id)).toEqual([good.id]);
	});

	it("loads nothing for a document whose content is no longer a valid Document", async () => {
		const { meta } = await add("soon damaged");
		store.close();
		await rawPut("contents", { id: meta.id, document: { version: 1 } });
		const again = track(open(name));
		expect(await again.load(meta.id)).toBeNull();
		// The record is kept, not purged: a build that understands it can still read it.
		expect(await again.get(meta.id)).not.toBeNull();
	});

	it("saves a new document even when an incomplete record sits in the table", async () => {
		await add("opens the database first");
		store.close();
		await rawPut("documents", { id: "broken" });
		const again = track(open(name));
		const { meta } = await again.addDocument({
			document: doc("fresh words"),
			title: "Fresh",
			language: "en",
		});
		expect((await again.list()).map((each) => each.id)).toContain(meta.id);
	});
});
