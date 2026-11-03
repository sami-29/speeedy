import { describe, expect, it } from "vitest";
import {
	applyPush,
	mergeDocument,
	type Push,
	SyncError,
	type SyncSession,
} from "../src/index.ts";
import { server, serverDoc, session } from "./fixtures.ts";

const push = (overrides: Partial<Push> = {}): Push => ({
	documents: [],
	uploads: [],
	tombstones: [],
	sessions: [],
	settings: {},
	dailyGoalChanges: [],
	trainingResults: [],
	...overrides,
});

const invalid = (bad: Push) => {
	const start = server({ documents: [serverDoc("a")] });
	const before = structuredClone(start);
	let caught: unknown;
	try {
		applyPush(start, bad);
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(SyncError);
	expect((caught as SyncError).code).toBe("invalid-argument");
	// Nothing it was handed has changed.
	expect(start).toEqual(before);
};

describe("applyPush refuses a malformed push as a whole", () => {
	it("throws invalid-argument for a push that is not one", () => {
		for (const bad of [null, 5, "x", [], {}, { ...push(), documents: null }]) {
			invalid(bad as never);
		}
	});

	it("throws for a negative or non-finite time on any record", () => {
		for (const at of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			invalid(push({ documents: [serverDoc("a", { titleChangedAt: at })] }));
			invalid(
				push({
					documents: [serverDoc("a", { languageOverrideChangedAt: at })],
				}),
			);
			invalid(push({ documents: [serverDoc("a", { positionChangedAt: at })] }));
			invalid(
				push({ tombstones: [{ id: "a", contentHash: "h", deletedAt: at }] }),
			);
			invalid(push({ sessions: [session("s", { startedAt: at })] }));
			invalid(push({ sessions: [session("s", { activeMs: at })] }));
			invalid(
				push({ settings: { libraryLineHidden: { value: 1, changedAt: at } } }),
			);
			invalid(
				push({
					dailyGoalChanges: [
						{
							id: "g",
							minutes: 10,
							effectiveDate: "2026-11-01",
							changedAt: at,
						},
					],
				}),
			);
			invalid(
				push({
					trainingResults: [
						{ id: "r", kind: "k", completedAt: at, scores: {} },
					],
				}),
			);
		}
	});

	it("throws for a Daily Goal change or Training result without its fields", () => {
		for (const bad of [null, {}, { id: 5 }, { id: "g", minutes: "10" }]) {
			invalid(push({ dailyGoalChanges: [bad as never] }));
			invalid(push({ trainingResults: [bad as never] }));
		}
		invalid(
			push({
				trainingResults: [
					{ id: "r", kind: "k", completedAt: 1, scores: { a: "1" } as never },
				],
			}),
		);
	});

	it("throws for an upload that is not a document ID", () => {
		invalid(push({ uploads: [5 as never] }));
	});

	it("throws for a whole push when one record of many is bad, and keeps none of it", () => {
		invalid(
			push({
				documents: [serverDoc("n")],
				sessions: [session("ok"), session("bad", { activeMs: Number.NaN })],
			}),
		);
	});

	it("still takes Library records with fields of their own", () => {
		const stored = {
			...serverDoc("n"),
			source: "own",
			createdAt: 1,
			lastReadAt: null,
			deviceOnly: false,
			deviceOnlyChangedAt: 0,
			sync: { pending: false, remoteId: null },
		};
		const result = applyPush(server(), push({ documents: [stored] }));
		expect(result.server.documents).toEqual([serverDoc("n")]);
	});

	it("keeps only a Position's block and offset", () => {
		const doc = serverDoc("n", {
			position: { block: 1, offset: 2, extra: true } as never,
		});
		const result = applyPush(server(), push({ documents: [doc] }));
		expect(result.server.documents[0]?.position).toEqual({
			block: 1,
			offset: 2,
		});
	});
});

describe("a document ID names one text", () => {
	it("refuses a pushed document whose ID the account holds with another text", () => {
		const held = serverDoc("a", { contentHash: "ha", title: "kept" });
		const result = applyPush(
			server({ documents: [held] }),
			push({
				documents: [
					serverDoc("a", {
						contentHash: "other",
						title: "evil",
						titleChangedAt: 99,
					}),
				],
			}),
		);
		expect(result.refused).toEqual([{ id: "a", existingId: "a" }]);
		expect(result.server.documents).toEqual([held]);
	});

	it("mergeDocument will not blend two documents with different IDs or texts", () => {
		const a = serverDoc("a", { contentHash: "h" });
		for (const b of [
			serverDoc("b", { contentHash: "h" }),
			serverDoc("a", { contentHash: "other" }),
		]) {
			expect(() => mergeDocument(a, b)).toThrow(SyncError);
			expect(() => mergeDocument(b, a)).toThrow(SyncError);
		}
	});
});

describe("a Session marked local-only", () => {
	it("is ignored by the server even when a device sends it", () => {
		const marked: SyncSession = { ...session("s"), localOnly: true };
		const result = applyPush(server(), push({ sessions: [marked] }));
		expect(result.server.sessions).toEqual([]);
	});
});
