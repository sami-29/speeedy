/*
 * The backup file's format and its strict reader (ticket #32). Expected values come from the
 * ticket and the spec: one versioned JSON with the documents in the Document model plus
 * Sessions, Training results, Daily Goal changes and settings; a newer version is refused
 * with "Update Speeedy to open this file"; the launcher's source URL is never in it; and
 * every reader of the file treats it as hostile input.
 */
import { describe, expect, it } from "vitest";
import {
	BACKUP_FORMAT,
	BACKUP_LIMITS,
	BACKUP_VERSION,
	type BackupFile,
	parseBackup,
	type SyncExport,
	validateBackup,
} from "../src/index";

const HASH = "a".repeat(64);
const HASH_2 = "b".repeat(64);

const document = (text = "one two three") => ({
	version: 1,
	blocks: [{ kind: "paragraph", text, spans: [] }],
});

const doc = (overrides: Record<string, unknown> = {}) => ({
	id: "doc-1",
	title: "Notes",
	titleChangedAt: 0,
	language: "en",
	languageOverride: null,
	languageOverrideChangedAt: 0,
	contentHash: HASH,
	source: "own",
	position: { block: 0, offset: 4 },
	positionChangedAt: 2_000,
	progress: 0.3,
	createdAt: 1_000,
	lastReadAt: 2_000,
	deviceOnly: false,
	deviceOnlyChangedAt: 0,
	document: document(),
	...overrides,
});

const session = (overrides: Record<string, unknown> = {}) => ({
	id: "s-1",
	documentId: "doc-1",
	date: "2026-11-03",
	startedAt: 1_700_000_000_000,
	activeMs: 60_000,
	wordsRead: 250,
	wpm: 250,
	...overrides,
});

const file = (overrides: Record<string, unknown> = {}) => ({
	format: BACKUP_FORMAT,
	version: BACKUP_VERSION,
	exportedAt: 1_700_000_000_000,
	documents: [doc()],
	sessions: [session()],
	trainingResults: [
		{ id: "t-1", kind: "benchmark", completedAt: 5_000, scores: { wpm: 300 } },
	],
	dailyGoalChanges: [
		{ id: "g-1", minutes: 15, effectiveDate: "2026-11-01", changedAt: 4_000 },
	],
	settings: [{ key: "libraryLineHidden", value: true, changedAt: 3_000 }],
	...overrides,
});

const text = (value: unknown) => JSON.stringify(value);
const failure = (value: unknown, limits = BACKUP_LIMITS) => {
	const result = validateBackup(value, limits);
	return result.ok ? "ok" : result.failure;
};

describe("a valid file", () => {
	it("reads back as the typed definition", () => {
		const result = parseBackup(text(file()));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const backup: BackupFile = result.backup;
		expect(backup.documents).toHaveLength(1);
		expect(backup.documents[0]?.document).toEqual(document());
		expect(backup.sessions[0]?.id).toBe("s-1");
		expect(backup.settings[0]).toEqual({
			key: "libraryLineHidden",
			value: true,
			changedAt: 3_000,
		});
	});

	it("accepts an empty Library", () => {
		const empty = file({
			documents: [],
			sessions: [],
			trainingResults: [],
			dailyGoalChanges: [],
			settings: [],
		});
		expect(validateBackup(empty).ok).toBe(true);
	});

	it("accepts the Sync export, which is this shape plus an account section, and drops the section", () => {
		const sync: SyncExport = {
			...(file() as unknown as BackupFile),
			account: { email: "reader@example.com" },
		};
		const result = validateBackup(sync);
		expect(result.ok).toBe(true);
		if (result.ok) expect("account" in result.backup).toBe(false);
	});

	it("accepts a document without the fields only a device keeps", () => {
		const bare = {
			id: "doc-9",
			title: "From the server",
			titleChangedAt: 0,
			language: "en",
			languageOverride: null,
			languageOverrideChangedAt: 0,
			contentHash: HASH,
			position: { block: 0, offset: 0 },
			positionChangedAt: 0,
			progress: 0,
			document: document(),
		};
		expect(validateBackup(file({ documents: [bare] })).ok).toBe(true);
	});

	it("accepts a Session kept only on this device", () => {
		const local = session({ localOnly: true });
		expect(validateBackup(file({ sessions: [local] })).ok).toBe(true);
	});
});

describe("the version", () => {
	it("refuses a newer version, whatever else the file holds", () => {
		for (const version of [BACKUP_VERSION + 1, 999, 2.5e9]) {
			const result = validateBackup({ format: BACKUP_FORMAT, version });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.failure).toBe("newer-version");
		}
		const result = parseBackup(text({ ...file(), version: 999, documents: 7 }));
		expect(result).toMatchObject({ ok: false, failure: "newer-version" });
	});

	it("refuses a version that is not a whole number from 1", () => {
		for (const version of [0, -1, 1.5, "1", null, true, [1], {}]) {
			expect(failure(file({ version }))).toBe("damaged");
		}
		expect(failure({ format: BACKUP_FORMAT })).toBe("damaged");
	});

	it("tells a file of another kind from a damaged backup", () => {
		for (const other of [
			null,
			7,
			"text",
			[],
			{},
			{ version: 1 },
			{ format: "something-else", version: 1 },
			{ format: ["speeedy-backup"], version: 1 },
		]) {
			expect(failure(other)).toBe("not-a-backup");
		}
	});
});

describe("the text of the file", () => {
	it("refuses what is not JSON", () => {
		for (const bad of ["", "{", "not json", "{'a':1}", "\u0000", "[1,2"]) {
			expect(parseBackup(bad)).toMatchObject({
				ok: false,
				failure: "not-json",
			});
		}
	});

	it("refuses a file over the size cap without parsing it", () => {
		const huge = " ".repeat(BACKUP_LIMITS.bytes + 1);
		expect(parseBackup(huge)).toMatchObject({
			ok: false,
			failure: "too-large",
		});
	});

	it("honours a smaller cap when the caller sets one", () => {
		const small = text(file());
		expect(
			parseBackup(small, { ...BACKUP_LIMITS, bytes: small.length - 1 }),
		).toMatchObject({ ok: false, failure: "too-large" });
		expect(
			parseBackup(small, { ...BACKUP_LIMITS, bytes: small.length }).ok,
		).toBe(true);
	});

	it("survives nesting deep enough to overflow a recursive reader", () => {
		const deep = `${"[".repeat(200_000)}${"]".repeat(200_000)}`;
		expect(parseBackup(deep).ok).toBe(false);
		const head = `{"format":"${BACKUP_FORMAT}","version":1,"exportedAt":1,"documents":[],"sessions":[],"trainingResults":[],"dailyGoalChanges":[],"settings":`;
		const inSetting = `${head}[{"key":"k","changedAt":1,"value":${"[".repeat(100_000)}${"]".repeat(100_000)}}]}`;
		expect(parseBackup(inSetting)).toMatchObject({ ok: false });
	});

	it("reads a number too large for a double as damage, not as a time", () => {
		const raw = text(file()).replace(
			'"exportedAt":1700000000000',
			'"exportedAt":1e999',
		);
		expect(raw).toContain("1e999");
		expect(parseBackup(raw)).toMatchObject({ ok: false, failure: "damaged" });
	});
});

describe("the counts", () => {
	const tight = { ...BACKUP_LIMITS, documents: 1, sessions: 1, settings: 1 };

	it("refuses more of a record than the cap", () => {
		expect(
			failure(
				file({ documents: [doc(), doc({ id: "d2", contentHash: HASH_2 })] }),
				tight,
			),
		).toBe("damaged");
		expect(
			failure(file({ sessions: [session(), session({ id: "s-2" })] }), tight),
		).toBe("damaged");
		expect(
			failure(
				file({
					settings: [
						{ key: "a", value: 1, changedAt: 1 },
						{ key: "b", value: 1, changedAt: 1 },
					],
				}),
				tight,
			),
		).toBe("damaged");
		expect(failure(file(), tight)).toBe("ok");
	});
});

describe("the sections", () => {
	it("refuses a missing or mistyped section", () => {
		for (const name of [
			"documents",
			"sessions",
			"trainingResults",
			"dailyGoalChanges",
			"settings",
			"exportedAt",
		]) {
			const without: Record<string, unknown> = { ...file() };
			delete without[name];
			expect(failure(without), name).toBe("damaged");
			expect(failure(file({ [name]: "x" })), name).toBe("damaged");
			expect(failure(file({ [name]: null })), name).toBe("damaged");
		}
		expect(failure(file({ documents: {} }))).toBe("damaged");
		expect(failure(file({ settings: {} }))).toBe("damaged");
	});

	it("refuses a field it does not know", () => {
		expect(failure(file({ extra: 1 }))).toBe("damaged");
		expect(failure(file({ documents: [doc({ extra: 1 })] }))).toBe("damaged");
		expect(failure(file({ sessions: [session({ extra: 1 })] }))).toBe(
			"damaged",
		);
	});

	it("refuses an account section that is not an object", () => {
		for (const account of [null, 7, "x", [1]]) {
			expect(failure(file({ account }))).toBe("damaged");
		}
	});
});

describe("the source URL stays on the device", () => {
	it("refuses a document that carries one, however it is spelled", () => {
		for (const key of ["sourceUrl", "source_url", "url", "sourceURL"]) {
			expect(
				failure(file({ documents: [doc({ [key]: "https://example.com/a" })] })),
			).toBe("damaged");
		}
	});

	it("does not name the field anywhere in what it returns", () => {
		const ok = validateBackup(file());
		expect(ok.ok).toBe(true);
		if (ok.ok) expect(JSON.stringify(ok.backup)).not.toContain("sourceUrl");
	});
});

describe("documents", () => {
	const bad = (overrides: Record<string, unknown>) =>
		failure(file({ documents: [doc(overrides)] }));

	it("checks the text with the Document model's own validator", () => {
		expect(bad({ document: { version: 2, blocks: [] } })).toBe("damaged");
		expect(bad({ document: { version: 1 } })).toBe("damaged");
		expect(
			bad({
				document: {
					version: 1,
					blocks: [
						{
							kind: "paragraph",
							text: "a",
							spans: [{ kind: "strong", start: 0, end: 9 }],
						},
					],
				},
			}),
		).toBe("damaged");
		expect(
			bad({
				document: { version: 1, blocks: [{ kind: "script", text: "x" }] },
			}),
		).toBe("damaged");
		expect(bad({ document: null })).toBe("damaged");
	});

	it("checks every scalar", () => {
		const cases: Record<string, unknown>[] = [
			{ id: "" },
			{ id: 4 },
			{ id: "x".repeat(300) },
			{ title: "" },
			{ title: "   " },
			{ title: "x".repeat(2_000) },
			{ title: 4 },
			{ titleChangedAt: -1 },
			{ titleChangedAt: "0" },
			{ language: "not a language" },
			{ language: "" },
			{ languageOverride: "bad tag!" },
			{ languageOverride: 4 },
			{ languageOverrideChangedAt: Number.MAX_VALUE },
			{ contentHash: "ABC" },
			{ contentHash: "a".repeat(63) },
			{ contentHash: "g".repeat(64) },
			{ contentHash: `${"a".repeat(64)}\n` },
			{ source: "somewhere" },
			{ position: { block: -1, offset: 0 } },
			{ position: { block: 0.5, offset: 0 } },
			{ position: { block: 0, offset: 0, extra: 1 } },
			{ position: [0, 0] },
			{ position: null },
			{ positionChangedAt: -5 },
			{ positionChangedAt: 8.65e15 },
			{ progress: 1.0001 },
			{ progress: -0.1 },
			{ progress: "0.5" },
			{ createdAt: -1 },
			{ lastReadAt: "now" },
			{ lastReadAt: -1 },
			{ deviceOnly: "yes" },
			{ deviceOnly: 1 },
			{ deviceOnlyChangedAt: -1 },
		];
		for (const overrides of cases) {
			expect(bad(overrides), JSON.stringify(overrides)).toBe("damaged");
		}
	});

	it("refuses two documents with one ID or one text", () => {
		expect(
			failure(file({ documents: [doc(), doc({ contentHash: HASH_2 })] })),
		).toBe("damaged");
		expect(failure(file({ documents: [doc(), doc({ id: "doc-2" })] }))).toBe(
			"damaged",
		);
	});
});

describe("Sessions, Training results, goals and settings", () => {
	it("checks every Session field", () => {
		const cases: Record<string, unknown>[] = [
			{ id: "" },
			{ id: 3 },
			{ documentId: 3 },
			{ documentId: "" },
			{ date: "2026-02-30" },
			{ date: "2026-13-01" },
			{ date: "11/03/2026" },
			{ date: "2026-11-03T00:00:00Z" },
			{ startedAt: -1 },
			{ startedAt: 8.65e15 },
			{ activeMs: -1 },
			{ activeMs: 8 * 86_400_000 },
			{ wordsRead: 1.5 },
			{ wordsRead: -1 },
			{ wordsRead: 1e12 },
			{ wpm: -1 },
			{ wpm: 1e9 },
			{ localOnly: false },
			{ localOnly: "true" },
		];
		for (const overrides of cases) {
			expect(
				failure(file({ sessions: [session(overrides)] })),
				JSON.stringify(overrides),
			).toBe("damaged");
		}
		expect(failure(file({ sessions: [session(), session()] }))).toBe("damaged");
	});

	it("checks Training results", () => {
		const base = {
			id: "t",
			kind: "benchmark",
			completedAt: 1,
			scores: { a: 1 },
		};
		const cases: Record<string, unknown>[] = [
			{ id: "" },
			{ kind: "" },
			{ kind: "k".repeat(500) },
			{ completedAt: -1 },
			{ scores: [1] },
			{ scores: null },
			{ scores: { a: "1" } },
			{ scores: { a: null } },
			{
				scores: Object.fromEntries(
					Array.from({ length: 500 }, (_, i) => [`k${i}`, 1]),
				),
			},
		];
		for (const overrides of cases) {
			expect(
				failure(file({ trainingResults: [{ ...base, ...overrides }] })),
				JSON.stringify(overrides).slice(0, 60),
			).toBe("damaged");
		}
		expect(failure(file({ trainingResults: [base, base] }))).toBe("damaged");
	});

	it("checks Daily Goal changes", () => {
		const base = {
			id: "g",
			minutes: 10,
			effectiveDate: "2026-11-01",
			changedAt: 1,
		};
		const cases: Record<string, unknown>[] = [
			{ minutes: 0 },
			{ minutes: 1441 },
			{ minutes: 1.5 },
			{ minutes: "10" },
			{ effectiveDate: "2026-02-29" },
			{ effectiveDate: "soon" },
			{ changedAt: -1 },
			{ id: "" },
		];
		for (const overrides of cases) {
			expect(
				failure(file({ dailyGoalChanges: [{ ...base, ...overrides }] })),
				JSON.stringify(overrides),
			).toBe("damaged");
		}
		expect(failure(file({ dailyGoalChanges: [base, base] }))).toBe("damaged");
	});

	it("checks settings, which keep any plain JSON value", () => {
		const good = [
			{ key: "a", value: true, changedAt: 1 },
			{ key: "b", value: "text", changedAt: 1 },
			{ key: "c", value: 4.5, changedAt: 1 },
			{ key: "d", value: null, changedAt: 1 },
			{ key: "e", value: { nested: [1, { deep: "x" }] }, changedAt: 1 },
		];
		expect(validateBackup(file({ settings: good })).ok).toBe(true);
		const cases: unknown[] = [
			{ key: "", value: 1, changedAt: 1 },
			{ key: 1, value: 1, changedAt: 1 },
			{ key: "k".repeat(500), value: 1, changedAt: 1 },
			{ key: "a", value: 1, changedAt: -1 },
			{ key: "a", changedAt: 1 },
			{ key: "a", value: 1, changedAt: 1, extra: 1 },
			{ key: "a", value: "x".repeat(100_000), changedAt: 1 },
			{
				key: "a",
				value: Array.from({ length: 5_000 }, () => 1),
				changedAt: 1,
			},
		];
		for (const entry of cases) {
			expect(
				failure(file({ settings: [entry] })),
				JSON.stringify(entry).slice(0, 80),
			).toBe("damaged");
		}
		expect(
			failure(
				file({
					settings: [
						{ key: "a", value: 1, changedAt: 1 },
						{ key: "a", value: 2, changedAt: 2 },
					],
				}),
			),
		).toBe("damaged");
		let nested: unknown = 1;
		for (let i = 0; i < 40; i++) nested = [nested];
		expect(
			failure(file({ settings: [{ key: "a", value: nested, changedAt: 1 }] })),
		).toBe("damaged");
	});
});

describe("prototype pollution", () => {
	const head = `{"format":"${BACKUP_FORMAT}","version":1,"exportedAt":1`;
	const empty = `"documents":[],"sessions":[],"trainingResults":[],"dailyGoalChanges":[],"settings":[]`;

	it("refuses a __proto__ or constructor key in every record and leaves Object.prototype alone", () => {
		const hostile = [
			`{"__proto__":{"polluted":"yes"},"format":"${BACKUP_FORMAT}","version":1}`,
			`${head},"__proto__":{"polluted":"yes"},${empty}}`,
			`${head},"documents":[{"__proto__":{"polluted":"yes"}}],"sessions":[],"trainingResults":[],"dailyGoalChanges":[],"settings":[]}`,
			`${head},"documents":[],"sessions":[],"trainingResults":[{"id":"t","kind":"k","completedAt":1,"scores":{"__proto__":1,"constructor":2}}],"dailyGoalChanges":[],"settings":[]}`,
			`${head},"documents":[],"sessions":[],"trainingResults":[],"dailyGoalChanges":[],"settings":[{"key":"__proto__","value":{"polluted":"yes"},"changedAt":1}]}`,
			`${head},"documents":[],"sessions":[],"trainingResults":[],"dailyGoalChanges":[],"settings":[{"key":"ok","value":{"__proto__":{"polluted":"yes"}},"changedAt":1}]}`,
			`${head},"documents":[],"sessions":[],"trainingResults":[],"dailyGoalChanges":[],"settings":[{"key":"ok","value":{"constructor":{"prototype":{"polluted":"yes"}}},"changedAt":1}]}`,
		];
		for (const raw of hostile) {
			expect(parseBackup(raw).ok, raw.slice(0, 90)).toBe(false);
		}
		expect({} as Record<string, unknown>).not.toHaveProperty("polluted");
		expect(Object.keys(Object.prototype)).toEqual([]);
	});

	it("returns plain copies, not the parsed objects", () => {
		const result = parseBackup(text(file()));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		for (const record of [
			result.backup,
			result.backup.documents[0],
			result.backup.sessions[0],
			result.backup.settings[0],
			result.backup.trainingResults[0]?.scores,
		]) {
			const prototype = Object.getPrototypeOf(record);
			expect(prototype === Object.prototype || prototype === null).toBe(true);
		}
	});
});
