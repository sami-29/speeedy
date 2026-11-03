import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	applyPush,
	canonicalJson,
	type DailyGoalChange,
	type DeviceDocument,
	type DeviceState,
	type FirstSyncAnswer,
	mergeDocument,
	mergeInsertOnce,
	mergeSession,
	mergeSessions,
	mergeSettings,
	mergeTombstone,
	mergeTombstones,
	pickLatest,
	type ServerState,
	type SettingEntry,
	type SyncDocument,
	type SyncSession,
	type SyncTombstone,
} from "../src/index.ts";
import {
	device,
	docIn,
	run,
	type Synced,
	server,
	serverDoc,
	syncFields,
	writesOf,
} from "./fixtures.ts";

/** Few distinct times, so ties are common. */
const time = fc.integer({ min: 0, max: 5 });

const stamped = fc.record({
	value: fc.oneof(
		fc.integer({ min: 0, max: 3 }),
		fc.constantFrom("x", "y"),
		fc.constant(null),
		fc.constant({ nested: [1, 2] }),
	),
	at: time,
});

/** Two copies of one document: same ID and text, any fields. */
const documentCopy = fc
	.record({
		language: fc.constantFrom("en", "fr"),
		title: fc.constantFrom("A", "B", "C"),
		titleChangedAt: time,
		languageOverride: fc.constantFrom(null, "de", "fr"),
		languageOverrideChangedAt: time,
		block: fc.integer({ min: 0, max: 3 }),
		offset: fc.integer({ min: 0, max: 2 }),
		positionChangedAt: time,
	})
	.map(({ block, offset, ...fields }) =>
		serverDoc("a", {
			...fields,
			position: { block, offset },
			progress: block / 4,
		}),
	);

const sessionCopy = (ids: readonly string[]) =>
	fc
		.record({
			id: fc.constantFrom(...ids),
			documentId: fc.constantFrom(null, "d1", "d2"),
			startedAt: time,
			activeMs: fc.integer({ min: 0, max: 3 }),
			wordsRead: fc.integer({ min: 0, max: 3 }),
			wpm: fc.constantFrom(200, 300),
		})
		.map((fields): SyncSession => ({ date: "2026-11-01", ...fields }));

const sessionList = fc.uniqueArray(sessionCopy(["a", "b", "c", "d"]), {
	selector: (each) => each.id,
});

const tombstoneCopy = (ids: readonly string[]) =>
	fc.record({
		id: fc.constantFrom(...ids),
		contentHash: fc.constantFrom("h1", "h2"),
		deletedAt: time,
	});

const tombstoneList = fc.uniqueArray(tombstoneCopy(["a", "b", "c"]), {
	selector: (each) => each.id,
});

const settings = fc.dictionary(
	fc.constantFrom("wpm", "chunkSize", "libraryLineHidden"),
	fc.record({
		value: fc.oneof(fc.integer({ min: 0, max: 2 }), fc.boolean()),
		changedAt: time,
	}),
	{ noNullPrototype: true },
);

/** Insert-once records whose content follows from their ID, as every real copy does. */
const insertOnceList = fc
	.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e"))
	.map((ids) => ids.map((id) => ({ id, minutes: id.charCodeAt(0) })));

const RUNS = { numRuns: 1000 };

function joinLaws<T>(
	name: string,
	arb: fc.Arbitrary<T>,
	join: (a: T, b: T) => T,
) {
	describe(`${name} is a join`, () => {
		it("gives the same result in either order", () => {
			fc.assert(
				fc.property(arb, arb, (a, b) => {
					expect(join(a, b)).toEqual(join(b, a));
				}),
				RUNS,
			);
		});

		it("gives the same result however merges are grouped", () => {
			fc.assert(
				fc.property(arb, arb, arb, (a, b, c) => {
					expect(join(join(a, b), c)).toEqual(join(a, join(b, c)));
				}),
				RUNS,
			);
		});

		it("changes nothing when a copy arrives twice", () => {
			fc.assert(
				fc.property(arb, arb, (a, b) => {
					const merged = join(a, b);
					expect(join(merged, merged)).toEqual(merged);
					expect(join(merged, b)).toEqual(merged);
					expect(join(merged, a)).toEqual(merged);
				}),
				RUNS,
			);
		});
	});
}

joinLaws("latest wins with the total tie-break", stamped, pickLatest);
joinLaws("a document merge", documentCopy, mergeDocument);
joinLaws("a Session merge", sessionCopy(["s"]), mergeSession);
joinLaws("a Session union", sessionList, mergeSessions);
joinLaws("a tombstone merge", tombstoneCopy(["a"]), mergeTombstone);
joinLaws("a tombstone union", tombstoneList, mergeTombstones);
joinLaws("a settings merge", settings, mergeSettings);

describe("Session union loses nothing", () => {
	it("keeps every Session ID, each with the most active time any copy had", () => {
		fc.assert(
			fc.property(sessionList, sessionList, (a, b) => {
				const merged = new Map(
					mergeSessions(a, b).map((each) => [each.id, each.activeMs]),
				);
				for (const each of [...a, ...b]) {
					expect(merged.get(each.id)).toBeGreaterThanOrEqual(each.activeMs);
				}
				expect(merged.size).toBe(new Set([...a, ...b].map((s) => s.id)).size);
			}),
			RUNS,
		);
	});
});

describe("insert-once records", () => {
	it("keep every record already kept and add the rest", () => {
		fc.assert(
			fc.property(insertOnceList, insertOnceList, (kept, incoming) => {
				const merged = mergeInsertOnce(kept, incoming);
				for (const record of kept) expect(merged).toContainEqual(record);
				expect(merged.map((each) => each.id)).toEqual(
					[...new Set([...kept, ...incoming].map((each) => each.id))].sort(),
				);
			}),
			RUNS,
		);
	});

	it("merge in any order and grouping, and ignore a record sent twice", () => {
		fc.assert(
			fc.property(insertOnceList, insertOnceList, insertOnceList, (a, b, c) => {
				expect(mergeInsertOnce(a, b)).toEqual(mergeInsertOnce(b, a));
				expect(mergeInsertOnce(mergeInsertOnce(a, b), c)).toEqual(
					mergeInsertOnce(a, mergeInsertOnce(b, c)),
				);
				expect(mergeInsertOnce(mergeInsertOnce(a, b), b)).toEqual(
					mergeInsertOnce(a, b),
				);
			}),
			RUNS,
		);
	});

	it("never let a later copy replace the kept one", () => {
		fc.assert(
			fc.property(fc.integer(), fc.integer(), (kept, later) => {
				expect(
					mergeInsertOnce(
						[{ id: "a", minutes: kept }],
						[{ id: "a", minutes: later }],
					),
				).toEqual([{ id: "a", minutes: kept }]);
			}),
			RUNS,
		);
	});
});

/*
 * A simulation of several devices on one Account. Each device makes changes offline, the
 * way the Library store does, and syncs with the one server at random moments. Every sync
 * is checked against the rules that must always hold; at the end every device syncs until
 * nothing moves, and they must agree.
 */

const DEVICES = 3;
const SYNCED = ["libraryLineHidden", "wpm"];
const at = fc.integer({ min: 1, max: 20 });
const deviceIndex = fc.integer({ min: 0, max: DEVICES - 1 });
const pick = fc.nat({ max: 30 });

const importOp = fc.record({
	kind: fc.constant("import" as const),
	device: deviceIndex,
	text: fc.integer({ min: 0, max: 3 }),
});

const localOp = fc.oneof(
	{ arbitrary: importOp, weight: 3 },
	fc.record({
		kind: fc.constant("read" as const),
		device: deviceIndex,
		doc: pick,
		block: fc.integer({ min: 0, max: 9 }),
		at,
	}),
	fc.record({
		kind: fc.constant("rename" as const),
		device: deviceIndex,
		doc: pick,
		title: fc.constantFrom("A", "B", "C"),
		at,
	}),
	fc.record({
		kind: fc.constant("override" as const),
		device: deviceIndex,
		doc: pick,
		language: fc.constantFrom(null, "de", "fr"),
		at,
	}),
	fc.record({
		kind: fc.constant("delete" as const),
		device: deviceIndex,
		doc: pick,
		at,
	}),
	fc.record({
		kind: fc.constant("flip" as const),
		device: deviceIndex,
		doc: pick,
		at,
	}),
	fc.record({
		kind: fc.constant("session" as const),
		device: deviceIndex,
		doc: fc.option(pick),
		activeMs: fc.integer({ min: 1, max: 5 }),
	}),
	fc.record({
		kind: fc.constant("resend" as const),
		device: deviceIndex,
		session: pick,
		change: fc.integer({ min: -2, max: 3 }),
	}),
	fc.record({
		kind: fc.constant("setting" as const),
		device: deviceIndex,
		key: fc.constantFrom("libraryLineHidden", "wpm", "theme"),
		value: fc.integer({ min: 0, max: 3 }),
		at,
	}),
	fc.record({
		kind: fc.constant("goal" as const),
		device: deviceIndex,
		minutes: fc.integer({ min: 5, max: 30 }),
		effectiveDate: fc.constantFrom("2026-10-01", "2026-11-01"),
		at,
	}),
	fc.record({
		kind: fc.constant("training" as const),
		device: deviceIndex,
		score: fc.integer({ min: 100, max: 500 }),
	}),
);

const syncOp = fc.record({
	kind: fc.constant("sync" as const),
	device: deviceIndex,
	answer: fc.constantFrom<FirstSyncAnswer>("add", "keep"),
	at,
});

type LocalOp = typeof localOp extends fc.Arbitrary<infer T> ? T : never;

const EMPTY_PUSH = {
	documents: [],
	uploads: [],
	tombstones: [],
	sessions: [],
	settings: {},
	dailyGoalChanges: [],
	trainingResults: [],
};

const byId = <T extends { id: string }>(records: readonly T[]): T[] =>
	[...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

const distinct = (values: readonly string[]) =>
	new Set(values).size === values.length;

class World {
	devices: DeviceState[] = Array.from({ length: DEVICES }, () =>
		device({ generation: null }),
	);
	server: ServerState = server();
	private count = 0;
	private next = (prefix: string) => `${prefix}${++this.count}`;
	newId = () => this.next("again-");

	change(op: LocalOp) {
		const local = this.devices[op.device] as DeviceState;
		const docs = byId(local.documents);
		const target =
			"doc" in op && op.doc !== null ? docs[op.doc % docs.length] : undefined;
		const edit = (change: (doc: DeviceDocument) => DeviceDocument) => {
			if (target === undefined) return;
			this.devices[op.device] = {
				...local,
				documents: local.documents.map((doc) =>
					doc.id === target.id ? change(doc) : doc,
				),
			};
		};
		switch (op.kind) {
			case "import": {
				const contentHash = `text-${op.text}`;
				if (local.documents.some((doc) => doc.contentHash === contentHash))
					return;
				this.devices[op.device] = {
					...local,
					documents: [
						...local.documents,
						{
							...serverDoc(this.next(`d${op.device}-`), {
								contentHash,
								language: op.text % 2 === 0 ? "en" : "fr",
							}),
							deviceOnly: false,
							deviceOnlyChangedAt: 0,
						},
					],
				};
				return;
			}
			case "read":
				return edit((doc) => ({
					...doc,
					position: { block: op.block, offset: 0 },
					progress: op.block / 10,
					positionChangedAt: op.at,
				}));
			case "rename":
				return edit((doc) => ({
					...doc,
					title: op.title,
					titleChangedAt: op.at,
				}));
			case "override":
				return edit((doc) => ({
					...doc,
					languageOverride: op.language,
					languageOverrideChangedAt: op.at,
				}));
			case "flip":
				return edit((doc) => ({
					...doc,
					deviceOnly: !doc.deviceOnly,
					deviceOnlyChangedAt: op.at,
				}));
			case "delete":
				if (target === undefined) return;
				this.devices[op.device] = {
					...local,
					documents: local.documents.filter((doc) => doc.id !== target.id),
					tombstones: [
						...local.tombstones.filter((each) => each.id !== target.id),
						{
							id: target.id,
							contentHash: target.contentHash,
							deletedAt: op.at,
						},
					],
				};
				return;
			case "session":
				if (op.doc !== null && target === undefined) return;
				this.devices[op.device] = {
					...local,
					sessions: [
						...local.sessions,
						{
							id: this.next("s"),
							documentId: target?.id ?? null,
							date: "2026-11-01",
							startedAt: 1,
							activeMs: op.activeMs,
							wordsRead: op.activeMs * 10,
							wpm: 200,
						},
					],
				};
				return;
			case "resend": {
				const sessions = byId(local.sessions);
				const resent = sessions[op.session % sessions.length];
				if (resent === undefined) return;
				this.devices[op.device] = {
					...local,
					sessions: local.sessions.map((each) =>
						each.id === resent.id
							? { ...each, activeMs: Math.max(0, each.activeMs + op.change) }
							: each,
					),
				};
				return;
			}
			case "setting":
				this.devices[op.device] = {
					...local,
					settings: {
						...local.settings,
						[op.key]: { value: op.value, changedAt: op.at },
					},
				};
				return;
			case "goal":
				this.devices[op.device] = {
					...local,
					dailyGoalChanges: [
						...local.dailyGoalChanges,
						{
							id: this.next("g"),
							minutes: op.minutes,
							effectiveDate: op.effectiveDate,
							changedAt: op.at,
						},
					],
				};
				return;
			case "training":
				this.devices[op.device] = {
					...local,
					trainingResults: [
						...local.trainingResults,
						{
							id: this.next("t"),
							kind: "benchmark",
							completedAt: 1,
							scores: { wpm: op.score },
						},
					],
				};
				return;
		}
	}

	sync(index: number, answer: FirstSyncAnswer, now: number): Synced {
		const before = this.devices[index] as DeviceState;
		const account = this.server;
		const result = run({
			device: before,
			server: account,
			now,
			newId: this.newId,
			firstSyncAnswer: answer,
			syncedSettings: SYNCED,
		});
		if (result.status !== "synced") throw new Error("asked after answering");
		expect(applyPushRefusals(account, result)).toEqual([]);
		holdsAfterSync(before, account, result);
		this.devices[index] = result.device;
		this.server = result.server;

		const again = run({
			device: result.device,
			server: result.server,
			now,
			newId: this.newId,
			syncedSettings: SYNCED,
		});
		expect(again.status).toBe("synced");
		if (again.status === "synced") {
			expect(again.writes).toEqual([]);
			expect(again.push).toEqual(EMPTY_PUSH);
		}
		return result;
	}
}

const applyPushRefusals = (account: ServerState, result: Synced) =>
	applyPush(account, result.push).refused;

/** The rules every single sync must keep, whatever came before it. */
function holdsAfterSync(
	before: DeviceState,
	account: ServerState,
	result: Synced,
) {
	const after = result.device;
	const next = result.server;

	// No Session is lost, and none ever shrinks.
	const local = new Map(after.sessions.map((each) => [each.id, each.activeMs]));
	const remote = new Map(next.sessions.map((each) => [each.id, each.activeMs]));
	for (const each of [...before.sessions, ...account.sessions]) {
		expect(local.get(each.id)).toBeGreaterThanOrEqual(each.activeMs);
	}
	for (const each of account.sessions) {
		expect(remote.get(each.id)).toBeGreaterThanOrEqual(each.activeMs);
	}

	// Goal changes and training results are never lost on either side.
	for (const list of ["dailyGoalChanges", "trainingResults"] as const) {
		const ids = [...before[list], ...account[list]].map((each) => each.id);
		for (const state of [after, next]) {
			const held = new Set(state[list].map((each) => each.id));
			for (const id of ids) expect(held.has(id)).toBe(true);
		}
	}

	// A document leaves only to its twin's ID, or because a tombstone says so.
	const deleted = new Set(next.tombstones.map((each) => each.id));
	const rekeyed = new Map(
		writesOf(result, "rekey-document").map((write) => [write.from, write.to]),
	);
	for (const doc of before.documents) {
		if (after.documents.some((each) => each.id === doc.id)) continue;
		const to = rekeyed.get(doc.id);
		if (to !== undefined) {
			expect(docIn(after, to)?.contentHash).toBe(doc.contentHash);
		} else {
			expect(deleted.has(doc.id)).toBe(true);
		}
	}
	for (const doc of account.documents) {
		if (!next.documents.some((each) => each.id === doc.id)) {
			expect(deleted.has(doc.id)).toBe(true);
		}
	}

	// One copy of each text, on the server and on the device.
	expect(distinct(next.documents.map((doc) => doc.contentHash))).toBe(true);
	expect(distinct(after.documents.map((doc) => doc.contentHash))).toBe(true);
	expect(after.tombstones).toEqual([]);

	// Nothing about a device-only document the account never had leaves the device.
	const known = new Set([
		...account.documents.map((doc) => doc.id),
		...account.tombstones.map((each) => each.id),
	]);
	const kept = new Set(
		writesOf(result, "set-device-only").map((write) => write.id),
	);
	const secret = before.documents.filter(
		(doc) => (doc.deviceOnly && !known.has(doc.id)) || kept.has(doc.id),
	);
	const secretIds = new Set(secret.map((doc) => doc.id));
	const secretHashes = new Set(secret.map((doc) => doc.contentHash));
	const deviceOnlyNow = new Set(
		after.documents.filter((doc) => doc.deviceOnly).map((doc) => doc.id),
	);
	const { push } = result;
	for (const doc of push.documents) {
		expect(secretIds.has(doc.id) || deviceOnlyNow.has(doc.id)).toBe(false);
		expect(secretHashes.has(doc.contentHash)).toBe(false);
	}
	for (const id of [
		...push.uploads,
		...push.tombstones.map((each) => each.id),
	]) {
		expect(secretIds.has(id)).toBe(false);
	}
	for (const each of push.sessions) {
		if (each.documentId === null) continue;
		expect(secretIds.has(each.documentId)).toBe(false);
		expect(deviceOnlyNow.has(each.documentId)).toBe(false);
	}
	expect(Object.keys(push.settings)).not.toContain("theme");
}

/**
 * Sync every device in turn until a whole round moves nothing, then check they all hold the
 * same Library. A change can take more than one round to reach everyone: a device removes a
 * document deleted elsewhere, and only in a later round learns that another device uploaded
 * it again, so the rounds are bounded rather than fixed.
 */
function settle(world: World) {
	let quiet = false;
	for (let round = 1; round <= 6 && !quiet; round++) {
		quiet = true;
		for (let index = 0; index < DEVICES; index++) {
			const result = world.sync(index, "add", 100);
			if (result.writes.length > 0 || !same(result.push, EMPTY_PUSH))
				quiet = false;
		}
	}
	expect(quiet).toBe(true);
	const account = world.server;
	for (const local of world.devices) {
		const shadowed = new Set(
			local.documents
				.filter((doc) => doc.deviceOnly)
				.map((doc) => doc.contentHash),
		);
		expect(
			byId(local.documents.filter((doc) => !doc.deviceOnly).map(syncFields)),
		).toEqual(
			byId(account.documents.filter((doc) => !shadowed.has(doc.contentHash))),
		);

		const known = new Set([
			...account.documents.map((doc) => doc.id),
			...account.tombstones.map((each) => each.id),
		]);
		const deviceOnly = new Set(
			local.documents.filter((doc) => doc.deviceOnly).map((doc) => doc.id),
		);
		// Every Session reaches every device. Only one about a document held device-only here,
		// or one the account never had, stays behind, and so does any time it gained since.
		const withheld = (each: SyncSession) =>
			each.documentId !== null &&
			(deviceOnly.has(each.documentId) || !known.has(each.documentId));
		for (const each of account.sessions) {
			const mine = local.sessions.find((other) => other.id === each.id);
			expect(mine?.activeMs).toBeGreaterThanOrEqual(each.activeMs);
			if (!same(mine, each)) expect(withheld(mine as SyncSession)).toBe(true);
		}
		for (const each of local.sessions) {
			if (account.sessions.some((other) => other.id === each.id)) continue;
			expect(withheld(each)).toBe(true);
		}

		for (const key of SYNCED) {
			expect(local.settings[key]).toEqual(account.settings[key]);
		}
		expect(byId(local.dailyGoalChanges)).toEqual(
			byId(account.dailyGoalChanges),
		);
		expect(byId(local.trainingResults)).toEqual(byId(account.trainingResults));
	}
}

describe("devices syncing one Account", () => {
	it("keep every rule on every sync and agree once they have all synced", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.oneof(
						{ arbitrary: localOp, weight: 4 },
						{ arbitrary: syncOp, weight: 1 },
					),
					{
						minLength: 10,
						maxLength: 60,
						size: "medium",
					},
				),
				(ops) => {
					const world = new World();
					for (const op of ops) {
						if (op.kind === "sync") world.sync(op.device, op.answer, op.at);
						else world.change(op);
					}
					settle(world);
				},
			),
			{ numRuns: 300 },
		);
	}, 120_000);

	const orders = [
		[0, 1, 2],
		[0, 2, 1],
		[1, 0, 2],
		[1, 2, 0],
		[2, 0, 1],
		[2, 1, 0],
	];

	it("give the account the same records whichever device syncs first", () => {
		fc.assert(
			fc.property(
				fc.array(localOp, { minLength: 5, maxLength: 40, size: "medium" }),
				fc.constantFrom(...orders),
				fc.constantFrom(...orders),
				(ops, first, second) => {
					const accounts = [first, second].map((order) => {
						const world = new World();
						for (const op of ops) world.change(op);
						const textOf = new Map(
							world.devices.flatMap((local) =>
								local.documents.map((doc) => [doc.id, doc.contentHash]),
							),
						);
						for (const index of order) world.sync(index, "add", 100);
						return byText(world.server, textOf);
					});
					expect(accounts[0]).toEqual(accounts[1]);
				},
			),
			{ numRuns: 300 },
		);
	}, 120_000);
});

/** The server's records with each document ID replaced by its text's hash. */
function byText(account: ServerState, textOf: Map<string, string>) {
	const text = (id: string | null) =>
		id === null ? null : (textOf.get(id) ?? id);
	return {
		documents: [...account.documents]
			.map((doc): SyncDocument => ({ ...doc, id: doc.contentHash }))
			.sort((a, b) => (a.id < b.id ? -1 : 1)),
		tombstones: byId(account.tombstones) satisfies SyncTombstone[],
		sessions: byId(
			account.sessions.map((each) => ({
				...each,
				documentId: text(each.documentId),
			})),
		),
		settings: account.settings satisfies Record<string, SettingEntry>,
		dailyGoalChanges: byId(
			account.dailyGoalChanges,
		) satisfies DailyGoalChange[],
		trainingResults: byId(account.trainingResults),
	};
}
