/*
 * Adversarial tests for ticket #52 (Sync merge rules). Every expected value comes from the
 * ticket's rules, the "Orchestrator decisions for #52" note (Q1 to Q5), or a hand
 * calculation shown in the test. A test that FAILS here exposes a defect in the code under
 * test; the report names each one.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	applyPush,
	canonicalJson,
	mergeDocument,
	mergeInsertOnce,
	mergeSession,
	mergeSessions,
	mergeSettings,
	mergeTombstone,
	mergeTombstones,
	type Push,
	pickLatest,
	type ServerState,
	type SettingEntry,
	type SyncSession,
	syncDevice,
} from "../src/index.ts";
import {
	counter,
	device,
	deviceDoc,
	docIn,
	NOW,
	server,
	serverDoc,
	session,
	synced,
} from "./fixtures.ts";

const RUNS = { numRuns: 500 };

const emptyPush = (overrides: Partial<Push> = {}): Push => ({
	documents: [],
	uploads: [],
	tombstones: [],
	sessions: [],
	settings: {},
	dailyGoalChanges: [],
	trainingResults: [],
	...overrides,
});

const sameJson = (a: unknown, b: unknown) =>
	expect(canonicalJson(a)).toBe(canonicalJson(b));

/* ------------------------------------------------------------------------------------ */
/* Times that are not ordinary                                                           */
/* ------------------------------------------------------------------------------------ */

describe("odd but finite times", () => {
	// Hand calculation: the later time wins, whatever its size or sign.
	const times = [
		-Number.MAX_VALUE,
		-1e21,
		-1,
		-0,
		0,
		Number.MIN_VALUE,
		1,
		Number.MAX_SAFE_INTEGER,
		1e21,
		Number.MAX_VALUE,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];

	it("pickLatest orders every pair by time, in either argument order", () => {
		for (const a of times) {
			for (const b of times) {
				if (a === b) continue; // -0 and 0 are equal times
				const winner = a > b ? "a" : "b";
				const x = pickLatest({ value: "a", at: a }, { value: "b", at: b });
				const y = pickLatest({ value: "b", at: b }, { value: "a", at: a });
				expect(x.value).toBe(winner);
				expect(y.value).toBe(winner);
			}
		}
	});

	it("-0 and 0 are one time: either order gives the same canonical result", () => {
		const a = { value: "x", at: 0 };
		const b = { value: "y", at: -0 };
		sameJson(pickLatest(a, b), pickLatest(b, a));
	});

	it("a Session never loses active time, however big or small the numbers", () => {
		fc.assert(
			fc.property(
				fc.double({ noNaN: true }),
				fc.double({ noNaN: true }),
				(x, y) => {
					const a = session("s", { activeMs: x });
					const b = session("s", { activeMs: y, wpm: 1 });
					const m = mergeSession(a, b);
					expect(m.activeMs).toBe(Math.max(x, y));
					sameJson(m, mergeSession(b, a));
				},
			),
			RUNS,
		);
	});

	it("a tombstone keeps the later delete for any finite delete times", () => {
		fc.assert(
			fc.property(
				fc.double({ noNaN: true }),
				fc.double({ noNaN: true }),
				(x, y) => {
					const a = { id: "d", contentHash: "h", deletedAt: x };
					const b = { id: "d", contentHash: "h", deletedAt: y };
					expect(mergeTombstone(a, b).deletedAt).toBe(Math.max(x, y));
					sameJson(mergeTombstone(a, b), mergeTombstone(b, a));
				},
			),
			RUNS,
		);
	});
});

describe("times that are not numbers (NaN)", () => {
	// A merge must give the same answer in either order. NaN breaks every `>` comparison.
	it("pickLatest is commutative when a time is NaN", () => {
		const a = { value: "a", at: Number.NaN };
		const b = { value: "b", at: 5 };
		sameJson(pickLatest(a, b), pickLatest(b, a));
	});

	it("mergeSession is commutative when an active time is NaN", () => {
		const a = session("s", { activeMs: Number.NaN });
		const b = session("s", { activeMs: 5 });
		sameJson(mergeSession(a, b), mergeSession(b, a));
	});

	it("mergeTombstone is commutative when a delete time is NaN", () => {
		const a = { id: "d", contentHash: "h", deletedAt: Number.NaN };
		const b = { id: "d", contentHash: "h", deletedAt: 5 };
		sameJson(mergeTombstone(a, b), mergeTombstone(b, a));
	});

	it("mergeDocument is commutative when a change time is NaN", () => {
		const a = serverDoc("d", { title: "A", titleChangedAt: Number.NaN });
		const b = serverDoc("d", { title: "B", titleChangedAt: 5 });
		sameJson(mergeDocument(a, b), mergeDocument(b, a));
	});
});

/* ------------------------------------------------------------------------------------ */
/* Prototype pollution                                                                   */
/* ------------------------------------------------------------------------------------ */

const HOSTILE_KEYS = [
	"__proto__",
	"constructor",
	"prototype",
	"toString",
	"hasOwnProperty",
	"valueOf",
];

/** JSON.parse makes "__proto__" an own data property, as a request body would. */
const parsed = <T>(text: string) => JSON.parse(text) as T;

describe("prototype-pollution keys", () => {
	it("mergeSettings keeps them as plain data and pollutes nothing", () => {
		for (const key of HOSTILE_KEYS) {
			const a = parsed<Record<string, SettingEntry>>(
				`{"${key}":{"value":{"polluted":true},"changedAt":1}}`,
			);
			const b = parsed<Record<string, SettingEntry>>(
				`{"${key}":{"value":2,"changedAt":2}}`,
			);
			const merged = mergeSettings(a, b);
			expect(Object.hasOwn(merged, key)).toBe(true);
			expect(Object.getOwnPropertyDescriptor(merged, key)?.value).toEqual({
				value: 2,
				changedAt: 2,
			});
			expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
			expect(Object.keys(Object.prototype)).toEqual([]);
		}
	});

	it("mergeSettings with a key on one side only does not read an inherited value", () => {
		const merged = mergeSettings({}, {});
		for (const key of HOSTILE_KEYS)
			expect(Object.hasOwn(merged, key)).toBe(false);
		const one = mergeSettings(
			{ x: { value: 1, changedAt: 1 } },
			parsed<Record<string, SettingEntry>>(
				'{"__proto__":{"value":9,"changedAt":3}}',
			),
		);
		expect(Object.keys(one).sort()).toEqual(["__proto__", "x"]);
	});

	it("syncDevice and applyPush carry a synced setting named like a prototype key", () => {
		for (const key of HOSTILE_KEYS) {
			const entry = { value: { polluted: true }, changedAt: 7 };
			const mine = parsed<Record<string, SettingEntry>>(
				`{"${key}":${JSON.stringify(entry)}}`,
			);
			const result = synced({
				device: device({ settings: mine }),
				server: server(),
				syncedSettings: [key],
			});
			expect(Object.hasOwn(result.push.settings, key)).toBe(true);
			expect(Object.hasOwn(result.server.settings, key)).toBe(true);
			expect(Object.getPrototypeOf(result.push.settings)).toBe(
				Object.prototype,
			);
			expect(Object.keys(Object.prototype)).toEqual([]);

			// And down: a device with nothing receives it as an own key.
			const down = synced({
				device: device(),
				server: server({ settings: mine }),
				syncedSettings: [key],
			});
			expect(Object.hasOwn(down.device.settings, key)).toBe(true);
			expect(Object.getPrototypeOf(down.device.settings)).toBe(
				Object.prototype,
			);
		}
	});

	it("document, Session and tombstone IDs named like prototype keys are ordinary IDs", () => {
		for (const id of HOSTILE_KEYS) {
			const result = applyPush(
				server(),
				emptyPush({
					documents: [serverDoc(id)],
					sessions: [session(id, { documentId: id })],
					tombstones: [{ id: `t-${id}`, contentHash: "h", deletedAt: 1 }],
				}),
			);
			expect(result.server.documents.map((doc) => doc.id)).toEqual([id]);
			expect(result.server.sessions.map((each) => each.id)).toEqual([id]);
			expect(Object.keys(Object.prototype)).toEqual([]);
		}
	});

	// canonicalJson builds a plain object and assigns `sorted[key] = ...`; for "__proto__"
	// that sets the prototype instead of a key, so the key vanishes from the string.
	it("canonicalJson keeps a __proto__ key in its output", () => {
		const value = parsed<unknown>('{"__proto__":{"a":1},"b":2}');
		expect(canonicalJson(value)).toBe('{"__proto__":{"a":1},"b":2}');
	});

	it("canonicalJson tells two values apart that differ only under __proto__", () => {
		const one = parsed<unknown>('{"__proto__":{"a":1}}');
		const two = parsed<unknown>('{"__proto__":{"a":2}}');
		expect(canonicalJson(one)).not.toBe(canonicalJson(two));
	});

	it("equal-time settings that differ only under __proto__ settle the same in both orders", () => {
		const a: SettingEntry = {
			value: parsed<unknown>('{"__proto__":{"a":1}}'),
			changedAt: 5,
		};
		const b: SettingEntry = {
			value: parsed<unknown>('{"__proto__":{"a":2}}'),
			changedAt: 5,
		};
		const ab = mergeSettings({ k: a }, { k: b });
		const ba = mergeSettings({ k: b }, { k: a });
		expect(JSON.stringify(ab)).toBe(JSON.stringify(ba));
	});
});

/* ------------------------------------------------------------------------------------ */
/* Hostile input to applyPush                                                            */
/* ------------------------------------------------------------------------------------ */

describe("applyPush rejects what it cannot interpret", () => {
	const base = (): ServerState =>
		server({
			documents: [
				serverDoc("a", { contentHash: "ha", title: "orig", titleChangedAt: 5 }),
			],
			sessions: [session("s1", { activeMs: 1_000 })],
			tombstones: [{ id: "gone", contentHash: "hg", deletedAt: 10 }],
		});

	/** Either the push throws, or it changes nothing. It must never merge. */
	const rejected = (push: Push) => {
		const before = structuredClone(base());
		let after: ServerState;
		try {
			after = applyPush(base(), push).server;
		} catch {
			return; // rejecting by throwing is fine
		}
		sameJson(after, before);
	};

	it("does not merge a document with an existing ID but another content hash", () => {
		// Same ID, different text: two different documents. Merging would put one text's
		// title and Position on the other's.
		rejected(
			emptyPush({
				documents: [
					serverDoc("a", {
						contentHash: "OTHER",
						title: "evil",
						titleChangedAt: 99,
						positionChangedAt: 99,
						position: { block: 9, offset: 9 },
						progress: 0.9,
					}),
				],
			}),
		);
	});

	it("does not take a document whose change time is NaN", () => {
		rejected(
			emptyPush({
				documents: [
					serverDoc("a", {
						contentHash: "ha",
						title: "evil",
						titleChangedAt: Number.NaN,
					}),
				],
			}),
		);
	});

	it("does not take a new document whose change time is NaN", () => {
		rejected(
			emptyPush({
				documents: [serverDoc("n", { positionChangedAt: Number.NaN })],
			}),
		);
	});

	it("does not take a time written as a string", () => {
		// "999" > 5 is true in JavaScript, so a string time would beat every real one.
		rejected(
			emptyPush({
				documents: [
					serverDoc("a", {
						contentHash: "ha",
						title: "evil",
						titleChangedAt: "999" as unknown as number,
					}),
				],
			}),
		);
	});

	it("does not take a Session whose active time is a string or NaN", () => {
		for (const activeMs of ["999999", Number.NaN] as unknown[]) {
			rejected(
				emptyPush({
					sessions: [session("s1", { activeMs: activeMs as number, wpm: 1 })],
				}),
			);
		}
	});

	it("does not take a document whose Position is not a Position", () => {
		for (const position of [
			{ block: -1, offset: 0 },
			{ block: 1.5, offset: 0 },
			{ block: 0 },
			null,
			[],
			"0:0",
		] as unknown[]) {
			rejected(
				emptyPush({
					documents: [
						serverDoc("a", {
							contentHash: "ha",
							positionChangedAt: 99,
							position: position as { block: number; offset: number },
						}),
					],
				}),
			);
		}
	});

	it("does not take a progress outside 0 to 1", () => {
		for (const progress of [-0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			rejected(
				emptyPush({
					documents: [
						serverDoc("a", {
							contentHash: "ha",
							positionChangedAt: 99,
							progress,
						}),
					],
				}),
			);
		}
	});

	it("does not take a tombstone with a NaN delete time", () => {
		rejected(
			emptyPush({
				tombstones: [{ id: "a", contentHash: "ha", deletedAt: Number.NaN }],
			}),
		);
	});

	it("does not take records that are not objects or lack an ID", () => {
		for (const bad of [null, 5, "a", [], {}]) {
			rejected(emptyPush({ documents: [bad as never] }));
			rejected(emptyPush({ sessions: [bad as never] }));
			rejected(emptyPush({ tombstones: [bad as never] }));
		}
	});

	it("does not take a setting entry without a numeric change time", () => {
		for (const changedAt of [Number.NaN, "9", undefined, null] as unknown[]) {
			rejected(
				emptyPush({
					settings: {
						libraryLineHidden: { value: true, changedAt: changedAt as number },
					},
				}),
			);
		}
	});
});

/* ------------------------------------------------------------------------------------ */
/* Rules that must always hold on the server's side                                      */
/* ------------------------------------------------------------------------------------ */

describe("applyPush is a safe, repeatable merge", () => {
	const doc = (id: string, hash: string, at: number) =>
		serverDoc(id, { contentHash: hash, titleChangedAt: at, title: `t${at}` });

	it("changes nothing when the same push arrives twice, with tombstones in it", () => {
		const start = server({
			documents: [doc("a", "ha", 1), doc("b", "hb", 1)],
			sessions: [session("s1")],
		});
		const push = emptyPush({
			documents: [doc("a", "ha", 4), doc("c", "hc", 1)],
			tombstones: [{ id: "b", contentHash: "hb", deletedAt: 3 }],
			sessions: [session("s1", { activeMs: 9 }), session("s2")],
			settings: { libraryLineHidden: { value: true, changedAt: 3 } },
			dailyGoalChanges: [
				{ id: "g", minutes: 10, effectiveDate: "2026-11-01", changedAt: 1 },
			],
			trainingResults: [
				{ id: "r", kind: "k", completedAt: 1, scores: { a: 1 } },
			],
		});
		const once = applyPush(start, push).server;
		const twice = applyPush(once, push).server;
		sameJson(twice, once);
	});

	it("never brings a document back by a resend after its tombstone", () => {
		const start = server({ documents: [doc("a", "ha", 1)] });
		const afterDelete = applyPush(
			start,
			emptyPush({ tombstones: [{ id: "a", contentHash: "ha", deletedAt: 5 }] }),
		).server;
		expect(afterDelete.documents).toEqual([]);
		// A stale device resends the live copy, even one changed after the delete time.
		const resent = applyPush(
			afterDelete,
			emptyPush({ documents: [doc("a", "ha", 99)] }),
		);
		expect(resent.server.documents).toEqual([]);
		expect(resent.server.tombstones).toHaveLength(1);
	});

	it("never lowers a tombstone's time or drops it when an older one arrives", () => {
		const start = server({
			tombstones: [{ id: "a", contentHash: "ha", deletedAt: 50 }],
		});
		const result = applyPush(
			start,
			emptyPush({ tombstones: [{ id: "a", contentHash: "ha", deletedAt: 7 }] }),
		).server;
		expect(result.tombstones).toEqual([
			{ id: "a", contentHash: "ha", deletedAt: 50 },
		]);
	});

	it("applies a tombstone and a live copy in one push as a delete, in any order of the lists", () => {
		const start = server({ documents: [doc("a", "ha", 1)] });
		const t = { id: "a", contentHash: "ha", deletedAt: 5 };
		for (const documents of [[doc("a", "ha", 9)], [doc("a", "ha", 0)]]) {
			const result = applyPush(
				start,
				emptyPush({ documents, tombstones: [t] }),
			).server;
			expect(result.documents).toEqual([]);
		}
	});

	it("keeps one document per text when two new IDs arrive with one hash, whichever is listed first", () => {
		const x = doc("x", "hh", 1);
		const y = doc("y", "hh", 1);
		const one = applyPush(server(), emptyPush({ documents: [x, y] })).server;
		const two = applyPush(server(), emptyPush({ documents: [y, x] })).server;
		expect(one.documents).toHaveLength(1);
		sameJson(one, two);
	});

	it("is the same for any split of one push in two (associative over pushes)", () => {
		const docs = [doc("a", "ha", 3), doc("b", "hb", 2), doc("c", "hc", 1)];
		const sessions = [
			session("s1", { activeMs: 3 }),
			session("s1", { activeMs: 8 }),
			session("s2"),
		];
		const whole = applyPush(
			server(),
			emptyPush({ documents: docs, sessions }),
		).server;
		const split = applyPush(
			applyPush(
				server(),
				emptyPush({
					documents: docs.slice(0, 2),
					sessions: sessions.slice(0, 1),
				}),
			).server,
			emptyPush({ documents: docs.slice(2), sessions: sessions.slice(1) }),
		).server;
		sameJson(split, whole);
	});

	it("handles empty everything", () => {
		const result = applyPush(server(), emptyPush());
		sameJson(result.server, server());
		expect(result.refused).toEqual([]);
	});
});

/* ------------------------------------------------------------------------------------ */
/* Pure merges with awkward strings and duplicates                                       */
/* ------------------------------------------------------------------------------------ */

const awkward = fc.constantFrom(
	"",
	" ",
	"a",
	"A",
	"é",
	"é",
	"\ud800",
	"\udc00",
	"__proto__",
	"constructor",
	'{"a":1}',
	"\u0000",
	"z".repeat(300),
);

describe("merges with awkward strings", () => {
	const docArb = fc
		.record({
			language: awkward,
			title: awkward,
			titleChangedAt: fc.integer({ min: 0, max: 2 }),
			languageOverride: fc.option(awkward, { nil: null }),
			languageOverrideChangedAt: fc.integer({ min: 0, max: 2 }),
			positionChangedAt: fc.integer({ min: 0, max: 2 }),
			block: fc.nat(3),
			offset: fc.nat(3),
		})
		.map(({ block, offset, ...rest }) =>
			serverDoc("d", {
				...rest,
				contentHash: "h",
				position: { block, offset },
				progress: 0.25,
			}),
		);

	it("mergeDocument is a join (commutative, associative, idempotent)", () => {
		fc.assert(
			fc.property(docArb, docArb, docArb, (a, b, c) => {
				sameJson(mergeDocument(a, b), mergeDocument(b, a));
				sameJson(
					mergeDocument(mergeDocument(a, b), c),
					mergeDocument(a, mergeDocument(b, c)),
				);
				sameJson(mergeDocument(a, a), a);
				const m = mergeDocument(a, b);
				sameJson(mergeDocument(m, a), m);
				sameJson(mergeDocument(m, b), m);
			}),
			RUNS,
		);
	});

	it("mergeDocument's result is no older in any field than either input", () => {
		fc.assert(
			fc.property(docArb, docArb, (a, b) => {
				const m = mergeDocument(a, b);
				expect(m.titleChangedAt).toBe(
					Math.max(a.titleChangedAt, b.titleChangedAt),
				);
				expect(m.languageOverrideChangedAt).toBe(
					Math.max(a.languageOverrideChangedAt, b.languageOverrideChangedAt),
				);
				expect(m.positionChangedAt).toBe(
					Math.max(a.positionChangedAt, b.positionChangedAt),
				);
			}),
			RUNS,
		);
	});

	it("mergeDocument keeps a Position and its progress together", () => {
		fc.assert(
			fc.property(docArb, docArb, (a, b) => {
				const m = mergeDocument(a, b);
				const pair = canonicalJson({ p: m.position, g: m.progress });
				const options = [a, b].map((x) =>
					canonicalJson({ p: x.position, g: x.progress }),
				);
				expect(options).toContain(pair);
			}),
			RUNS,
		);
	});

	const settingArb = fc.dictionary(
		fc.constantFrom("a", "b", "__proto__", "constructor"),
		fc.record({
			value: fc.oneof(
				awkward,
				fc.integer(),
				fc.constant(null),
				fc.constant([1, { z: 1 }]),
			),
			changedAt: fc.integer({ min: 0, max: 2 }),
		}),
		{ noNullPrototype: true },
	);

	it("mergeSettings is a join and keeps every key", () => {
		fc.assert(
			fc.property(settingArb, settingArb, settingArb, (a, b, c) => {
				const ab = mergeSettings(a, b);
				expect(JSON.stringify(ab)).toBe(JSON.stringify(mergeSettings(b, a)));
				expect(JSON.stringify(mergeSettings(ab, c))).toBe(
					JSON.stringify(mergeSettings(a, mergeSettings(b, c))),
				);
				expect(JSON.stringify(mergeSettings(ab, a))).toBe(JSON.stringify(ab));
				for (const key of [...Object.keys(a), ...Object.keys(b)]) {
					expect(Object.hasOwn(ab, key)).toBe(true);
				}
			}),
			RUNS,
		);
	});

	it("mergeSessions with duplicate IDs inside one list still never shrinks a Session", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.constantFrom("a", "b", "__proto__"),
						activeMs: fc.integer({ min: 0, max: 5 }),
					}),
					{ maxLength: 8 },
				),
				fc.array(
					fc.record({
						id: fc.constantFrom("a", "b", "__proto__"),
						activeMs: fc.integer({ min: 0, max: 5 }),
					}),
					{ maxLength: 8 },
				),
				(xs, ys) => {
					const lift = (list: typeof xs): SyncSession[] =>
						list.map((each) => session(each.id, { activeMs: each.activeMs }));
					const merged = mergeSessions(lift(xs), lift(ys));
					for (const id of new Set([...xs, ...ys].map((each) => each.id))) {
						const most = Math.max(
							...[...xs, ...ys]
								.filter((e) => e.id === id)
								.map((e) => e.activeMs),
						);
						const held = merged.filter((each) => each.id === id);
						expect(held).toHaveLength(1);
						expect(held[0]?.activeMs).toBe(most);
					}
				},
			),
			RUNS,
		);
	});

	it("mergeInsertOnce and mergeTombstones accept empty lists and duplicates", () => {
		expect(mergeInsertOnce([], [])).toEqual([]);
		expect(mergeTombstones([], [])).toEqual([]);
		expect(mergeSessions([], [])).toEqual([]);
		const t = { id: "a", contentHash: "h", deletedAt: 1 };
		expect(mergeTombstones([t, t], [t, t])).toEqual([t]);
		const g = { id: "g", n: 1 };
		expect(
			mergeInsertOnce([g, { id: "g", n: 2 }], [{ id: "g", n: 3 }]),
		).toEqual([g]);
	});
});

/* ------------------------------------------------------------------------------------ */
/* syncDevice: hand-crafted edge cases                                                   */
/* ------------------------------------------------------------------------------------ */

describe("syncDevice edge cases", () => {
	it("syncs empty everything to nothing, with no question", () => {
		const first = synced({
			device: device({ generation: null }),
			server: server({ generation: "g9" }),
		});
		expect(first.writes).toEqual([]);
		expect(first.push).toEqual(emptyPush());
		expect(first.generation).toBe("g9");
		const again = synced({ device: first.device, server: first.server });
		expect(again.writes).toEqual([]);
		expect(again.push).toEqual(emptyPush());
	});

	it("ignores a First sync answer when there is nothing to ask", () => {
		// Empty server: everything uploads, even with "keep".
		const up = synced({
			device: device({ generation: null, documents: [deviceDoc("a")] }),
			server: server({ generation: "g2" }),
			firstSyncAnswer: "keep",
		});
		expect(up.push.documents.map((doc) => doc.id)).toEqual(["a"]);
		expect(up.device.documents[0]?.deviceOnly).toBe(false);
		// Within one generation, "keep" does not turn new documents device-only.
		const same = synced({
			device: device({ documents: [deviceDoc("a")] }),
			server: server({ documents: [serverDoc("b")] }),
			firstSyncAnswer: "keep",
		});
		expect(same.push.documents.map((doc) => doc.id)).toEqual(["a"]);
		expect(docIn(same.device, "a")).toMatchObject({ deviceOnly: false });
	});

	it("handles every document on the server being dead and every local one tombstoned", () => {
		const result = synced({
			device: device({
				generation: null,
				documents: [deviceDoc("a"), deviceDoc("b")],
			}),
			server: server({
				generation: "g2",
				tombstones: [
					{ id: "a", contentHash: "hash-a", deletedAt: 5 },
					{ id: "b", contentHash: "hash-b", deletedAt: 5 },
				],
			}),
		});
		expect(result.device.documents).toEqual([]);
		expect(result.push.documents).toEqual([]);
	});

	it("never drops a Session when its document is removed by a tombstone", () => {
		const s = session("s1", { documentId: "a" });
		const result = synced({
			device: device({ documents: [deviceDoc("a")], sessions: [s] }),
			server: server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 5 }],
			}),
		});
		expect(result.device.documents).toEqual([]);
		expect(result.device.sessions).toEqual([s]);
	});

	it("keeps a device-only document and its Sessions off the server, when the server holds another document", () => {
		const secret = deviceDoc("secret", {
			deviceOnly: true,
			sourceUrl: "https://x",
		} as never);
		const result = synced({
			device: device({
				documents: [secret, deviceDoc("pub")],
				sessions: [session("s1", { documentId: "secret" })],
			}),
			server: server({ documents: [serverDoc("other")] }),
			firstSyncAnswer: "add",
		});
		const wire = JSON.stringify(result.push);
		expect(wire).not.toContain("secret");
		expect(wire).not.toContain("https://x");
		expect(JSON.stringify(result.server)).not.toContain("secret");
	});

	it("keeps a device-only document's text hash off the server when the account never had it", () => {
		const result = synced({
			device: device({
				documents: [
					deviceDoc("secret", { deviceOnly: true, contentHash: "HASH-SECRET" }),
				],
			}),
			server: server(),
		});
		expect(JSON.stringify(result.push)).not.toContain("HASH-SECRET");
		expect(JSON.stringify(result.server)).not.toContain("HASH-SECRET");
	});

	it("sends no source URL from any document, however it is passed in", () => {
		const doc = {
			...deviceDoc("a"),
			sourceUrl: "https://private.example/post",
			source: "own",
			createdAt: 1,
			sync: { pending: true, remoteId: null },
		};
		const result = synced({
			device: device({ documents: [doc] }),
			server: server({ documents: [serverDoc("a", { title: "S" })] }),
		});
		expect(JSON.stringify(result.push)).not.toContain("private.example");
		expect(JSON.stringify(result.server)).not.toContain("private.example");
		expect(JSON.stringify(result.writes)).not.toContain("private.example");
		// applyPush strips too: a client that sent it anyway does not get it stored.
		const direct = applyPush(
			server(),
			emptyPush({ documents: [doc as never] }),
		);
		expect(JSON.stringify(direct.server)).not.toContain("private.example");
	});

	it("two local copies of one text: each document keeps its own ID after a sync", () => {
		// Hand calculation: the device holds a and s with one hash h; the account holds s.
		// "a" re-keys to s (same text) and "s" merges with s, so both would end with ID s.
		// Two Library records can never share an ID, so a sync must not write that.
		const result = synced({
			device: device({
				documents: [
					deviceDoc("a", { contentHash: "h" }),
					deviceDoc("s", { contentHash: "h" }),
				],
			}),
			server: server({ documents: [serverDoc("s", { contentHash: "h" })] }),
		});
		const ids = result.device.documents.map((doc) => doc.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("a rekey never targets an ID another local document already holds", () => {
		for (const [mine, theirs] of [
			["a", "z"],
			["z", "a"],
		] as const) {
			const result = synced({
				device: device({
					documents: [
						deviceDoc(mine, { contentHash: "h" }),
						deviceDoc(theirs, { contentHash: "h" }),
					],
				}),
				server: server({
					documents: [serverDoc(theirs, { contentHash: "h" })],
				}),
			});
			const ids = result.device.documents.map((doc) => doc.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	it("equal change times everywhere give the same account whichever device syncs first", () => {
		const mk = (title: string) =>
			device({
				documents: [
					deviceDoc("d", {
						contentHash: "h",
						title,
						languageOverride: title === "A" ? "de" : "fr",
						position: { block: title === "A" ? 1 : 2, offset: 0 },
						progress: 0.5,
						positionChangedAt: 10,
					}),
				],
			});
		const run = (order: ("A" | "B")[]) => {
			let acct = server({ documents: [serverDoc("d", { contentHash: "h" })] });
			const states = { A: mk("A"), B: mk("B") };
			for (const who of [...order, ...order]) {
				const r = synced({ device: states[who], server: acct });
				states[who] = r.device;
				acct = r.server;
			}
			return { acct, states };
		};
		const ab = run(["A", "B"]);
		const ba = run(["B", "A"]);
		sameJson(ab.acct, ba.acct);
		sameJson(
			ab.states.A.documents,
			ab.states.B.documents.map((d) => d),
		);
	});

	it("resending the same push after the device lost the answer changes nothing more", () => {
		const input = {
			device: device({
				documents: [deviceDoc("a", { positionChangedAt: 5 })],
				sessions: [session("s1")],
				tombstones: [{ id: "gone", contentHash: "hg", deletedAt: 9 }],
			}),
			server: server({
				documents: [serverDoc("gone", { contentHash: "hg" })],
			}),
		};
		const first = synced(input);
		// The device never saw the answer: it syncs again from its old state against the new server.
		const retry = synced({ device: input.device, server: first.server });
		sameJson(retry.server, first.server);
	});

	it("a delete wins over a Position read after it on the same document, from the device that deleted", () => {
		const result = synced({
			device: device({
				tombstones: [{ id: "a", contentHash: "ha", deletedAt: 10 }],
			}),
			server: server({
				documents: [
					serverDoc("a", { contentHash: "ha", positionChangedAt: 999 }),
				],
			}),
		});
		expect(result.server.documents).toEqual([]);
		expect(result.server.tombstones.map((t) => t.id)).toEqual(["a"]);
	});

	it("turning device-only off exactly at the delete time lets the delete win", () => {
		// Rule: "unless Keep on this device only was turned off later". Equal is not later.
		const result = synced({
			device: device({
				documents: [deviceDoc("a", { deviceOnlyChangedAt: 10 })],
			}),
			server: server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 10 }],
			}),
		});
		expect(result.device.documents).toEqual([]);
	});

	it("a text deleted and re-uploaded under a new ID is not removed by the old tombstone", () => {
		const result = synced({
			device: device({
				documents: [deviceDoc("new", { contentHash: "h" })],
			}),
			server: server({
				tombstones: [{ id: "old", contentHash: "h", deletedAt: 10 }],
			}),
		});
		expect(result.device.documents.map((doc) => doc.id)).toEqual(["new"]);
		expect(result.push.documents.map((doc) => doc.id)).toEqual(["new"]);
	});

	it("a downloaded document that is huge in position time sorts first without breaking order", () => {
		const result = synced({
			device: device(),
			server: server({
				documents: [
					serverDoc("a", { positionChangedAt: 1 }),
					serverDoc("b", { positionChangedAt: Number.MAX_SAFE_INTEGER }),
					serverDoc("c", { positionChangedAt: -5 }),
					serverDoc("d", { positionChangedAt: 1 }),
				],
			}),
		});
		expect(result.downloads).toEqual(["b", "a", "d", "c"]);
	});

	it("newId is called only for a document uploaded again, and each time once", () => {
		const ids = counter("fresh-");
		let calls = 0;
		const result = syncDevice({
			device: device({
				documents: [
					deviceDoc("a", { deviceOnlyChangedAt: 20 }),
					deviceDoc("b"),
				],
			}),
			server: server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 10 }],
				documents: [serverDoc("b")],
			}),
			now: NOW,
			newId: () => {
				calls++;
				return ids();
			},
		});
		expect(result.status).toBe("synced");
		expect(calls).toBe(1);
	});

	it("never produces a Session whose time shrank, even for a re-sent shorter copy that was moved", () => {
		const long = session("s1", { documentId: "a", activeMs: 9_000 });
		const short = session("s1", { documentId: "a", activeMs: 1_000 });
		const result = synced({
			device: device({
				documents: [deviceDoc("a", { contentHash: "h" })],
				sessions: [short],
			}),
			server: server({
				documents: [serverDoc("t", { contentHash: "h" })],
				sessions: [long],
			}),
		});
		const kept = result.device.sessions.find((each) => each.id === "s1");
		expect(kept?.activeMs).toBe(9_000);
		const onServer = result.server.sessions.find((each) => each.id === "s1");
		expect(onServer?.activeMs).toBe(9_000);
	});
});

/* ------------------------------------------------------------------------------------ */
/* Device-only then delete: a Session of a device-only document stays on the device      */
/* ------------------------------------------------------------------------------------ */

describe("a device-only document's Sessions stay on the device", () => {
	it("even after the reader deletes that document", () => {
		// 1. The document is synced, then turned device-only (acts as a delete elsewhere).
		const shared = serverDoc("x", { contentHash: "hx" });
		let dev = device({ documents: [deviceDoc("x", { contentHash: "hx" })] });
		let acct = server({ documents: [shared] });
		dev = {
			...dev,
			documents: [
				{
					...deviceDoc("x", { contentHash: "hx" }),
					deviceOnly: true,
					deviceOnlyChangedAt: 100,
				},
			],
			// 2. The reader reads it, privately.
			sessions: [session("private-1", { documentId: "x" })],
		};
		let r = synced({ device: dev, server: acct });
		dev = r.device;
		acct = r.server;
		expect(acct.sessions.map((each) => each.id)).not.toContain("private-1");
		// 3. The reader deletes it.
		dev = {
			...dev,
			documents: [],
			tombstones: [{ id: "x", contentHash: "hx", deletedAt: 200 }],
		};
		r = synced({ device: dev, server: acct });
		// The Session was made while the document was kept on this device only.
		expect(r.push.sessions.map((each) => each.id)).not.toContain("private-1");
		expect(r.server.sessions.map((each) => each.id)).not.toContain("private-1");
	});
});

/* ------------------------------------------------------------------------------------ */
/* A random world: several devices flipping device-only, deleting, reading               */
/* ------------------------------------------------------------------------------------ */

type World = {
	devices: ReturnType<typeof device>[];
	account: ServerState;
	clock: number;
	next: number;
	/** Sessions made on a device while their document was kept on that device only. */
	secret: Set<string>;
};

const worldOp = fc.oneof(
	{
		weight: 2,
		arbitrary: fc.record({
			kind: fc.constant("import" as const),
			device: fc.nat(1),
			text: fc.nat(1),
		}),
	},
	{
		weight: 2,
		arbitrary: fc.record({
			kind: fc.constant("flip" as const),
			device: fc.nat(1),
			doc: fc.nat(3),
		}),
	},
	{
		weight: 2,
		arbitrary: fc.record({
			kind: fc.constant("delete" as const),
			device: fc.nat(1),
			doc: fc.nat(3),
		}),
	},
	{
		weight: 1,
		arbitrary: fc.record({
			kind: fc.constant("read" as const),
			device: fc.nat(1),
			doc: fc.nat(3),
		}),
	},
	{
		weight: 3,
		arbitrary: fc.record({
			kind: fc.constant("session" as const),
			device: fc.nat(1),
			doc: fc.nat(3),
		}),
	},
	{
		weight: 5,
		arbitrary: fc.record({
			kind: fc.constant("sync" as const),
			device: fc.nat(1),
		}),
	},
);

function stepWorld(
	world: World,
	op: typeof worldOp extends fc.Arbitrary<infer T> ? T : never,
) {
	const t = ++world.clock;
	const dev = world.devices[op.device] as ReturnType<typeof device>;
	const docs = dev.documents;
	const target =
		docs.length > 0
			? docs[
					op.kind === "import" || op.kind === "sync" ? 0 : op.doc % docs.length
				]
			: undefined;
	switch (op.kind) {
		case "import": {
			const hash = `h${op.text}`;
			if (docs.some((doc) => doc.contentHash === hash)) return;
			const id = `d${++world.next}`;
			dev.documents = [...docs, deviceDoc(id, { contentHash: hash })];
			return;
		}
		case "flip": {
			if (target === undefined || target.deviceOnly) return; // only ever turn it on
			dev.documents = docs.map((doc) =>
				doc === target
					? { ...doc, deviceOnly: true, deviceOnlyChangedAt: t }
					: doc,
			);
			return;
		}
		case "delete": {
			if (target === undefined) return;
			dev.documents = docs.filter((doc) => doc !== target);
			dev.tombstones = [
				...dev.tombstones,
				{ id: target.id, contentHash: target.contentHash, deletedAt: t },
			];
			return;
		}
		case "read": {
			if (target === undefined) return;
			dev.documents = docs.map((doc) =>
				doc === target
					? {
							...doc,
							position: { block: t, offset: 0 },
							progress: 0.5,
							positionChangedAt: t,
						}
					: doc,
			);
			return;
		}
		case "session": {
			if (target === undefined) return;
			const id = `s${++world.next}`;
			dev.sessions = [
				...dev.sessions,
				session(id, { documentId: target.id, startedAt: t }),
			];
			if (target.deviceOnly) world.secret.add(id);
			return;
		}
		case "sync": {
			const r = syncDevice({
				device: dev,
				server: world.account,
				now: t,
				newId: () => `n${++world.next}`,
				firstSyncAnswer: "add",
			});
			if (r.status !== "synced") return;
			world.devices[op.device] = r.device;
			world.account = r.server;
			return;
		}
	}
}

describe("random devices flipping device-only, deleting and reading", () => {
	it("never let a Session made on a device-only document reach the account", () => {
		fc.assert(
			fc.property(fc.array(worldOp, { minLength: 4, maxLength: 40 }), (ops) => {
				const world: World = {
					devices: [device(), device()],
					account: server(),
					clock: 100,
					next: 0,
					secret: new Set(),
				};
				for (const op of ops) {
					stepWorld(world, op);
					for (const each of world.account.sessions) {
						expect(world.secret.has(each.id)).toBe(false);
					}
				}
			}),
			// A fixed seed keeps the run reproducible; this one found the leak.
			{ numRuns: 1000, seed: 826754384 },
		);
	}, 120_000);

	it("keep every device's IDs and the account's texts unique, and sync twice moves nothing", () => {
		fc.assert(
			fc.property(fc.array(worldOp, { minLength: 4, maxLength: 40 }), (ops) => {
				const world: World = {
					devices: [device(), device()],
					account: server(),
					clock: 100,
					next: 0,
					secret: new Set(),
				};
				for (const op of ops) {
					stepWorld(world, op);
					for (const local of world.devices) {
						const ids = local.documents.map((doc) => doc.id);
						expect(new Set(ids).size).toBe(ids.length);
					}
					const hashes = world.account.documents.map((doc) => doc.contentHash);
					expect(new Set(hashes).size).toBe(hashes.length);
					const live = new Set(world.account.documents.map((doc) => doc.id));
					for (const tomb of world.account.tombstones) {
						expect(live.has(tomb.id)).toBe(false);
					}
				}
				// A second sync of the same device, straight after one, moves nothing.
				for (let index = 0; index < 2; index++) {
					stepWorld(world, { kind: "sync", device: index });
					const again = syncDevice({
						device: world.devices[index] as ReturnType<typeof device>,
						server: world.account,
						now: world.clock + 1,
						newId: () => `n${++world.next}`,
					});
					if (again.status === "synced") {
						expect(again.writes).toEqual([]);
						sameJson(again.push, emptyPush());
					}
				}
			}),
			{ numRuns: 1000 },
		);
	}, 120_000);

	it("never lose a Session or shorten one, on the account or on any device", () => {
		fc.assert(
			fc.property(fc.array(worldOp, { minLength: 4, maxLength: 40 }), (ops) => {
				const world: World = {
					devices: [device(), device()],
					account: server(),
					clock: 100,
					next: 0,
					secret: new Set(),
				};
				const seen = new Map<string, number>();
				const note = (list: readonly SyncSession[]) => {
					for (const each of list) {
						const was = seen.get(each.id) ?? -1;
						expect(each.activeMs).toBeGreaterThanOrEqual(was);
						seen.set(each.id, Math.max(was, each.activeMs));
					}
				};
				const known = new Set<string>();
				for (const op of ops) {
					stepWorld(world, op);
					note(world.account.sessions);
					for (const local of world.devices) {
						note(local.sessions);
						for (const each of local.sessions) known.add(each.id);
					}
					// Every Session ever made is still somewhere.
					for (const id of known) {
						const held =
							world.account.sessions.some((each) => each.id === id) ||
							world.devices.some((local) =>
								local.sessions.some((each) => each.id === id),
							);
						expect(held).toBe(true);
					}
				}
			}),
			{ numRuns: 1000 },
		);
	}, 120_000);
});
