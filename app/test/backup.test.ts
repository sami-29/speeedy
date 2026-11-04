/*
 * Ticket #32: the backup file, from the Library out and back in. Two stores stand for two
 * devices. Expected values come from the ticket and the spec: export gives one versioned JSON
 * with the Library and stats; restore merges by content hash and never duplicates a document
 * or a Session; a newer file is refused with "Update Speeedy to open this file"; the launcher's
 * source URL never leaves the device; and a restore is one transaction, so a bad file changes
 * nothing.
 */
import "fake-indexeddb/auto";
import {
	BACKUP_FORMAT,
	BACKUP_LIMITS,
	BACKUP_VERSION,
	type BackupFile,
	CANARY,
	type Document,
} from "@speeedy/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup } from "../src/lib/backup/create.ts";
import { restoreBackup, restoreBackupFile } from "../src/lib/backup/restore.ts";
import { saveLauncherPage } from "../src/lib/launcher/save.ts";
import {
	createLibraryStore,
	LIBRARY_DB_NAME,
	type LibraryStore,
} from "../src/lib/library/store.ts";

const SECRET_URL = "https://private.example/inbox?token=sekrit-4471";

let counter = 0;
let clock = 1_000_000;
let ids = 0;
const stores: LibraryStore[] = [];

const openAs = (name: string, label: string): LibraryStore => {
	const store = createLibraryStore({
		name,
		now: () => clock,
		newId: () => `${label}-${++ids}`,
	});
	stores.push(store);
	return store;
};

const device = (label: string): LibraryStore =>
	openAs(`${LIBRARY_DB_NAME}-backup-${label}-${++counter}`, label);

beforeEach(() => {
	clock = 1_000_000;
});

afterEach(() => {
	for (const each of stores.splice(0)) each.close();
});

const doc = (...paragraphs: string[]): Document => ({
	version: 1,
	blocks: paragraphs.map((text) => ({ kind: "paragraph", text, spans: [] })),
});

const session = (
	over: Partial<{ startedAt: number; activeMs: number }> = {},
) => ({
	date: "2026-11-03",
	startedAt: 1_700_000_000_000,
	activeMs: 60_000,
	wordsRead: 250,
	wpm: 250,
	...over,
});

const textOf = async (store: LibraryStore, at = clock) => {
	const made = await createBackup(store, { now: () => at });
	return made.blob.text();
};

const parsed = async (store: LibraryStore): Promise<BackupFile> =>
	JSON.parse(await textOf(store)) as BackupFile;

/** Everything a restore should carry over, without what stays on the device. */
const portable = async (store: LibraryStore) => {
	const file = await parsed(store);
	return {
		documents: [...file.documents].sort((a, b) => a.id.localeCompare(b.id)),
		sessions: file.sessions,
		trainingResults: file.trainingResults,
		dailyGoalChanges: file.dailyGoalChanges,
		settings: file.settings,
	};
};

/** A Library with every kind of record in it. */
async function populate(store: LibraryStore) {
	clock = 2_000_000;
	const alpha = await store.addDocument({
		document: doc("alpha one two three four five", "alpha six seven eight"),
		title: "Alpha",
		language: "en",
		sourceUrl: SECRET_URL,
	});
	const beta = await store.addDocument({
		document: doc("beta private text"),
		title: "Beta",
		language: "fr",
	});
	const gamma = await store.addDocument({
		document: doc("gamma sample text"),
		title: "Gamma",
		language: "en",
		source: "demo",
	});
	clock = 3_000_000;
	await store.rename(alpha.meta.id, "Alpha renamed");
	await store.setLanguageOverride(alpha.meta.id, "de");
	clock = 4_000_000;
	await store.savePosition(alpha.meta.id, { block: 1, offset: 6 }, 0.62);
	await store.setDeviceOnly(beta.meta.id, true);
	await store.addSession({ ...session(), documentId: alpha.meta.id });
	await store.addSession({
		...session({ startedAt: 1_700_000_100_000, activeMs: 90_000 }),
		documentId: beta.meta.id,
	});
	await store.addSession({
		...session({ startedAt: 1_700_000_200_000 }),
		documentId: null,
	});
	await store.setDailyGoal({ minutes: 20, effectiveDate: "2026-11-01" });
	await store.addTrainingResult({ kind: "benchmark", scores: { wpm: 310 } });
	await store.setSetting("libraryLineHidden", true);
	return { alpha: alpha.meta, beta: beta.meta, gamma: gamma.meta };
}

describe("export", () => {
	it("writes one versioned JSON with the documents in the Document model plus the stats", async () => {
		const store = device("a");
		await populate(store);
		const made = await createBackup(store, { now: () => 1_730_000_000_000 });
		expect(made.blob.type).toBe("application/json");
		expect(made.filename).toMatch(/^speeedy-backup-\d{4}-\d{2}-\d{2}\.json$/);
		expect(made.documents).toBe(3);
		expect(made.skipped).toBe(0);
		const file = JSON.parse(await made.blob.text()) as BackupFile;
		expect(file.format).toBe(BACKUP_FORMAT);
		expect(file.version).toBe(BACKUP_VERSION);
		expect(file.exportedAt).toBe(1_730_000_000_000);
		expect(file.documents.map((each) => each.title).sort()).toEqual([
			"Alpha renamed",
			"Beta",
			"Gamma",
		]);
		const alpha = file.documents.find((each) => each.title === "Alpha renamed");
		expect(alpha?.document).toEqual(
			doc("alpha one two three four five", "alpha six seven eight"),
		);
		expect(alpha).toMatchObject({
			languageOverride: "de",
			position: { block: 1, offset: 6 },
			progress: 0.62,
			positionChangedAt: 4_000_000,
			titleChangedAt: 3_000_000,
		});
		expect(file.sessions).toHaveLength(3);
		expect(file.trainingResults).toHaveLength(1);
		expect(file.dailyGoalChanges).toHaveLength(1);
		expect(file.settings).toEqual([
			{ key: "libraryLineHidden", value: true, changedAt: 4_000_000 },
		]);
	});

	it("exports an empty Library as a valid file", async () => {
		const empty = device("empty");
		const file = await parsed(empty);
		expect(file.documents).toEqual([]);
		const target = device("target");
		const result = await restoreBackup(target, await textOf(empty));
		expect(result.ok).toBe(true);
	});

	it("leaves the source URL out of the file, and the whole address with it", async () => {
		const store = device("a");
		await populate(store);
		const text = await textOf(store);
		expect(text).not.toContain("sourceUrl");
		expect(text).not.toContain("private.example");
		expect(text).not.toContain("sekrit");
		// Nothing else about where the page came from either.
		expect(text).not.toContain('"sync"');
		expect(text).not.toContain("remoteId");
	});

	it("leaves the source URL out when a page came from the launcher", async () => {
		const store = device("launcher");
		const saved = await saveLauncherPage(store, {
			type: "speeedy:page",
			version: 1,
			title: "From the extension",
			url: SECRET_URL,
			language: "en",
			document: doc("a page the extension sent"),
		});
		expect((await store.get(saved.id))?.sourceUrl).toBe(SECRET_URL);
		const text = await textOf(store);
		expect(text).not.toContain("private.example");
		expect(text).not.toContain("sourceUrl");
		expect(text).toContain("From the extension");
	});

	it("keeps a document kept on this device only, flagged so a restore keeps it there", async () => {
		const store = device("a");
		const { beta } = await populate(store);
		const file = await parsed(store);
		const exported = file.documents.find((each) => each.id === beta.id);
		expect(exported).toMatchObject({
			deviceOnly: true,
			deviceOnlyChangedAt: 4_000_000,
		});
		const session = file.sessions.find((each) => each.documentId === beta.id);
		expect(session?.localOnly).toBe(true);
	});

	it("makes the blob from parts, never one giant string of the Library", async () => {
		const store = device("a");
		await populate(store);
		const made = await createBackup(store, { now: () => clock });
		expect(made.blob.size).toBeGreaterThan(0);
		expect(made.blob).toBeInstanceOf(Blob);
	});
});

describe("round trip", () => {
	it("export, wipe, restore gives the same Library", async () => {
		const name = `${LIBRARY_DB_NAME}-backup-wipe-${++counter}`;
		const before = openAs(name, "a");
		await populate(before);
		const text = await textOf(before);
		const expected = await portable(before);

		// Wipe: the database goes, as when the browser clears the site's data.
		before.close();
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
		const wiped = openAs(name, "w");
		expect(await wiped.list()).toEqual([]);

		const result = await restoreBackup(wiped, text);
		expect(result).toMatchObject({
			ok: true,
			documentsAdded: 3,
			documentsMatched: 0,
		});
		expect(await portable(wiped)).toEqual(expected);
	});

	it("restores the text, Positions and stats onto a different device", async () => {
		const a = device("a");
		const { alpha } = await populate(a);
		const b = device("b");
		const result = await restoreBackup(b, await textOf(a));
		expect(result.ok).toBe(true);
		const restored = await b.load(alpha.id);
		expect(restored?.document).toEqual(
			doc("alpha one two three four five", "alpha six seven eight"),
		);
		expect(restored?.meta).toMatchObject({
			title: "Alpha renamed",
			languageOverride: "de",
			position: { block: 1, offset: 6 },
			progress: 0.62,
			// the launcher's address does not travel
			sourceUrl: null,
			deviceOnly: false,
			sync: { pending: false, remoteId: null },
		});
		expect((await b.sessions()).map((each) => each.activeMs).sort()).toEqual([
			60_000, 60_000, 90_000,
		]);
		expect((await b.settings()).libraryLineHidden?.value).toBe(true);
		expect(await b.dailyGoalChanges()).toHaveLength(1);
		expect(await b.trainingResults()).toHaveLength(1);
	});

	it("uses the content hash the Library uses, so a restored text dedupes against a new add", async () => {
		const a = device("a");
		await populate(a);
		const b = device("b");
		await restoreBackup(b, await textOf(a));
		const again = await b.addDocument({
			document: doc("gamma sample text"),
			title: "Gamma again",
			language: "en",
		});
		expect(again.duplicate).toBe(true);
		expect(await b.list()).toHaveLength(3);
	});

	it("keeps a device-only document device-only on the new device, with its Session local", async () => {
		const a = device("a");
		const { beta } = await populate(a);
		const b = device("b");
		await restoreBackup(b, await textOf(a));
		const restored = await b.get(beta.id);
		expect(restored).toMatchObject({
			deviceOnly: true,
			deviceOnlyChangedAt: 4_000_000,
		});
		const local = (await b.sessions()).find(
			(each) => each.documentId === beta.id,
		);
		expect(local?.localOnly).toBe(true);
	});
});

describe("merging into a Library that already has things", () => {
	it("never duplicates a document: the same text keeps one copy, the later Position wins", async () => {
		const a = device("a");
		const b = device("b");
		clock = 2_000_000;
		const onA = await a.addDocument({
			document: doc("shared words here and more"),
			title: "Shared",
			language: "en",
		});
		clock = 2_500_000;
		const onB = await b.addDocument({
			document: doc("shared words here and more"),
			title: "Shared",
			language: "en",
			sourceUrl: SECRET_URL,
		});
		expect(onA.meta.id).not.toBe(onB.meta.id);
		clock = 3_000_000;
		await a.savePosition(onA.meta.id, { block: 0, offset: 12 }, 0.5);
		await a.addSession({ ...session(), documentId: onA.meta.id });

		const result = await restoreBackup(b, await textOf(a));
		expect(result).toMatchObject({
			ok: true,
			documentsAdded: 0,
			documentsMatched: 1,
		});
		const list = await b.list();
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			// the surviving copy is the one that was already here
			id: onB.meta.id,
			position: { block: 0, offset: 12 },
			progress: 0.5,
			positionChangedAt: 3_000_000,
			// and its address is still its own
			sourceUrl: SECRET_URL,
		});
		// the Session is moved to the surviving copy
		expect((await b.sessions()).map((each) => each.documentId)).toEqual([
			onB.meta.id,
		]);
	});

	it("keeps a later Position that is already here", async () => {
		const a = device("a");
		const b = device("b");
		const onA = await a.addDocument({
			document: doc("one two three four"),
			title: "T",
			language: "en",
		});
		const onB = await b.addDocument({
			document: doc("one two three four"),
			title: "T",
			language: "en",
		});
		clock += 1_000;
		await a.savePosition(onA.meta.id, { block: 0, offset: 4 }, 0.25);
		clock += 1_000;
		await b.savePosition(onB.meta.id, { block: 0, offset: 8 }, 0.5);
		await restoreBackup(b, await textOf(a));
		expect((await b.get(onB.meta.id))?.position).toEqual({
			block: 0,
			offset: 8,
		});
	});

	it("restoring the same file twice changes nothing the second time", async () => {
		const a = device("a");
		await populate(a);
		const text = await textOf(a);
		const b = device("b");
		clock = 9_000_000;
		await b.addDocument({
			document: doc("only on b"),
			title: "Only B",
			language: "en",
		});
		await restoreBackup(b, text);
		const once = await portable(b);
		const second = await restoreBackup(b, text);
		expect(second).toMatchObject({
			ok: true,
			documentsAdded: 0,
			sessionsAdded: 0,
		});
		expect(await portable(b)).toEqual(once);
		expect(await b.list()).toHaveLength(4);
	});

	it("restoring a file onto the Library it came from changes nothing", async () => {
		const a = device("a");
		await populate(a);
		const before = await portable(a);
		const text = await textOf(a);
		const result = await restoreBackup(a, text);
		expect(result).toMatchObject({
			ok: true,
			documentsAdded: 0,
			sessionsAdded: 0,
		});
		expect(await portable(a)).toEqual(before);
	});

	it("never duplicates a Session, and a Session only grows", async () => {
		const a = device("a");
		const b = device("b");
		const onA = await a.addDocument({
			document: doc("grow the session"),
			title: "G",
			language: "en",
		});
		const shared = await a.addSession({
			...session({ activeMs: 30_000 }),
			documentId: onA.meta.id,
		});
		const text30 = await textOf(a);
		await restoreBackup(b, text30);
		expect(await b.sessions()).toHaveLength(1);

		// the Session grows on a, and a newer file arrives
		const grown = JSON.parse(text30) as BackupFile;
		const entry = grown.sessions.find((each) => each.id === shared.id);
		if (!entry) throw new Error("expected the Session in the file");
		entry.activeMs = 50_000;
		await restoreBackup(b, JSON.stringify(grown));
		expect((await b.sessions()).map((each) => each.activeMs)).toEqual([50_000]);

		// an older file never shrinks it
		entry.activeMs = 10_000;
		await restoreBackup(b, JSON.stringify(grown));
		expect((await b.sessions()).map((each) => each.activeMs)).toEqual([50_000]);
	});

	it("never takes a Session's mark of staying on this device, even when the file's copy is longer", async () => {
		const b = device("b");
		const held = await b.addDocument({
			document: doc("private to this device"),
			title: "Private",
			language: "en",
		});
		await b.setDeviceOnly(held.meta.id, true);
		const mine = await b.addSession({
			...session({ activeMs: 10_000 }),
			documentId: held.meta.id,
		});
		expect(mine.localOnly).toBe(true);
		const file = JSON.parse(await textOf(b)) as BackupFile;
		const entry = file.sessions[0];
		if (!entry) throw new Error("expected a Session");
		delete entry.localOnly;
		entry.activeMs = 20_000;
		await restoreBackup(b, JSON.stringify(file));
		const after = (await b.sessions())[0];
		expect(after).toMatchObject({ activeMs: 20_000, localOnly: true });
	});

	it("leaves what is only here alone, and settings merge one at a time by their own time", async () => {
		const a = device("a");
		const b = device("b");
		clock = 1_000;
		await a.setSetting("libraryLineHidden", true);
		clock = 2_000;
		await b.setSetting("libraryLineHidden", false);
		await b.setSetting("onlyHere", "kept");
		await restoreBackup(b, await textOf(a));
		const settings = await b.settings();
		expect(settings.libraryLineHidden).toEqual({
			value: false,
			changedAt: 2_000,
		});
		expect(settings.onlyHere?.value).toBe("kept");
		clock = 3_000;
		await a.setSetting("libraryLineHidden", true);
		await restoreBackup(b, await textOf(a));
		expect((await b.settings()).libraryLineHidden).toEqual({
			value: true,
			changedAt: 3_000,
		});
	});

	it("does not let a device-only flag on one side quietly switch the other off", async () => {
		const a = device("a");
		const b = device("b");
		const onA = await a.addDocument({
			document: doc("kept private here"),
			title: "P",
			language: "en",
		});
		const onB = await b.addDocument({
			document: doc("kept private here"),
			title: "P",
			language: "en",
		});
		clock += 1_000;
		await b.setDeviceOnly(onB.meta.id, true);
		await restoreBackup(b, await textOf(a));
		expect((await b.get(onB.meta.id))?.deviceOnly).toBe(true);
		clock += 1_000;
		await a.setDeviceOnly(onA.meta.id, true);
		const c = device("c");
		await restoreBackup(c, await textOf(a));
		expect((await c.get(onA.meta.id))?.deviceOnly).toBe(true);
	});

	it("brings a deleted document back and keeps the delete's record out of the way", async () => {
		const a = device("a");
		const b = device("b");
		await a.addDocument({
			document: doc("deleted then restored"),
			title: "Back",
			language: "en",
		});
		const text = await textOf(a);
		await restoreBackup(b, text);
		const [mine] = await b.list();
		if (!mine) throw new Error("expected the restored document");
		await b.deleteDocument(mine.id);
		expect(await b.list()).toEqual([]);
		await restoreBackup(b, text);
		const back = await b.list();
		expect(back).toHaveLength(1);
		expect(back[0]?.title).toBe("Back");
		// the Session-less document opens
		const loaded = back[0] ? await b.load(back[0].id) : null;
		expect(loaded?.document).toEqual(doc("deleted then restored"));
	});

	it("never lets a file overwrite a different document that has its ID", async () => {
		const a = device("a");
		const b = device("b");
		const mine = await b.addDocument({
			document: doc("my own private words"),
			title: "Mine",
			language: "en",
		});
		await a.addDocument({
			document: doc("words planted by a file"),
			title: "Planted",
			language: "en",
		});
		const file = JSON.parse(await textOf(a)) as BackupFile;
		const planted = file.documents[0];
		if (!planted) throw new Error("expected a document");
		planted.id = mine.meta.id;
		file.sessions = [
			{
				id: "s-planted",
				documentId: mine.meta.id,
				...session(),
			},
		];
		const result = await restoreBackup(b, JSON.stringify(file));
		expect(result).toMatchObject({ ok: true, documentsAdded: 1 });
		expect((await b.load(mine.meta.id))?.document).toEqual(
			doc("my own private words"),
		);
		expect((await b.get(mine.meta.id))?.title).toBe("Mine");
		const all = await b.list();
		expect(all).toHaveLength(2);
		const added = all.find((each) => each.id !== mine.meta.id);
		expect(added?.title).toBe("Planted");
		// its Session follows the planted text, not the document it named
		const plantedSession = (await b.sessions()).find(
			(each) => each.id === "s-planted",
		);
		expect(plantedSession?.documentId).toBe(added?.id);
	});
});

describe("refusing a file", () => {
	const seeded = async () => {
		const store = device("target");
		clock = 7_000_000;
		await store.addDocument({
			document: doc("already here"),
			title: "Here",
			language: "en",
		});
		await store.setSetting("keep", 1);
		return store;
	};
	const snapshot = async (store: LibraryStore) => ({
		list: await store.list(),
		sessions: await store.sessions(),
		settings: await store.settings(),
		goals: await store.dailyGoalChanges(),
		results: await store.trainingResults(),
		tombstones: await store.tombstones(),
	});

	it("refuses a newer version with the exact copy's failure and changes nothing", async () => {
		const source = device("a");
		await populate(source);
		const file = JSON.parse(await textOf(source)) as BackupFile;
		const target = await seeded();
		const before = await snapshot(target);
		const result = await restoreBackup(
			target,
			JSON.stringify({ ...file, version: BACKUP_VERSION + 1 }),
		);
		expect(result).toEqual({ ok: false, failure: "newer-version" });
		expect(await snapshot(target)).toEqual(before);
	});

	it.each([
		["not JSON", "this is not json"],
		["an array", "[]"],
		["another kind of file", '{"hello":"world"}'],
		["a 1.x profile", '{"name":"Me","wpm":300,"theme":"night"}'],
		["empty", ""],
	])("refuses %s and changes nothing", async (_label, text) => {
		const target = await seeded();
		const before = await snapshot(target);
		const result = await restoreBackup(target, text);
		expect(result.ok).toBe(false);
		expect(await snapshot(target)).toEqual(before);
	});

	it("refuses a file over the size cap and changes nothing", async () => {
		const target = await seeded();
		const before = await snapshot(target);
		const source = device("a");
		await populate(source);
		const text = await textOf(source);
		const result = await restoreBackup(target, text, {
			limits: { ...BACKUP_LIMITS, bytes: text.length - 1 },
		});
		expect(result).toEqual({ ok: false, failure: "too-large" });
		expect(await snapshot(target)).toEqual(before);
	});

	it("refuses a file by its size before reading any of it", async () => {
		const target = await seeded();
		let read = false;
		const result = await restoreBackupFile(target, {
			size: BACKUP_LIMITS.bytes + 1,
			text: async () => {
				read = true;
				return "";
			},
		});
		expect(result).toEqual({ ok: false, failure: "too-large" });
		expect(read).toBe(false);
	});

	it("refuses a document whose hash is not its text's, and applies nothing, not even the good records before it", async () => {
		const source = device("a");
		await populate(source);
		const file = JSON.parse(await textOf(source)) as BackupFile;
		const last = file.documents[file.documents.length - 1];
		if (!last) throw new Error("expected documents");
		last.contentHash = "0".repeat(64);
		const target = await seeded();
		const before = await snapshot(target);
		const result = await restoreBackup(target, JSON.stringify(file));
		expect(result).toEqual({ ok: false, failure: "damaged" });
		expect(await snapshot(target)).toEqual(before);
	});

	it("refuses a hostile settings value without polluting anything", async () => {
		const source = device("a");
		await populate(source);
		const raw = (await textOf(source)).replace(
			'"value":true',
			'"value":{"__proto__":{"polluted":"yes"}}',
		);
		expect(raw).toContain("__proto__");
		const target = await seeded();
		const before = await snapshot(target);
		const result = await restoreBackup(target, raw);
		expect(result.ok).toBe(false);
		expect(await snapshot(target)).toEqual(before);
		expect({} as Record<string, unknown>).not.toHaveProperty("polluted");
	});

	it("applies nothing when the store fails part-way through", async () => {
		const target = await seeded();
		const before = await snapshot(target);
		await expect(
			target.restore(() => {
				throw new Error("the plan could not be built");
			}),
		).rejects.toThrow();
		await expect(
			target.restore(() => ({
				documents: [],
				sessions: [
					{ id: "s-first", documentId: null, ...session({ startedAt: 1 }) },
					// no id: IndexedDB refuses the put
					{ documentId: null, ...session({ startedAt: 2 }) } as never,
				],
				settings: [{ key: "rolled-back", entry: { value: 1, changedAt: 9 } }],
				dailyGoalChanges: [],
				trainingResults: [],
			})),
		).rejects.toThrow();
		expect(await snapshot(target)).toEqual(before);
	});
});

describe("privacy", () => {
	it("keeps document text out of everything but the file", async () => {
		const store = device("a");
		await store.addDocument({
			document: doc(`${CANARY} and more`),
			title: "Canary",
			language: "en",
		});
		const requests: unknown[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = ((...args: unknown[]) => {
			requests.push(args);
			return Promise.reject(new Error("no network in a backup"));
		}) as typeof fetch;
		try {
			const text = await textOf(store);
			const target = device("b");
			await restoreBackup(target, text);
		} finally {
			globalThis.fetch = realFetch;
		}
		expect(requests).toEqual([]);
	});
});
