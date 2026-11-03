import { describe, expect, it } from "vitest";
import {
	canonicalJson,
	mergeDocument,
	mergeInsertOnce,
	mergeSession,
	mergeSessions,
	mergeSettings,
	mergeTombstone,
	pickLatest,
} from "../src/index.ts";
import { serverDoc, session } from "./fixtures.ts";

describe("canonical JSON", () => {
	it("writes object keys in order, at every depth, and keeps array order", () => {
		expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
			'{"a":{"c":null,"d":[2,1]},"b":1}',
		);
	});

	it("leaves out undefined fields, as JSON does", () => {
		expect(canonicalJson({ a: undefined, b: "x" })).toBe('{"b":"x"}');
	});
});

describe("latest wins", () => {
	it("keeps the value with the later time", () => {
		expect(
			pickLatest({ value: "old", at: 1 }, { value: "new", at: 2 }),
		).toEqual({ value: "new", at: 2 });
		expect(
			pickLatest({ value: "new", at: 2 }, { value: "old", at: 1 }),
		).toEqual({ value: "new", at: 2 });
	});

	it("settles a tie on the larger canonical JSON, whichever side it is on", () => {
		const alpha = { value: "Alpha", at: 5 };
		const beta = { value: "Beta", at: 5 };
		expect(pickLatest(alpha, beta)).toEqual(beta);
		expect(pickLatest(beta, alpha)).toEqual(beta);
	});
});

describe("one document from two places", () => {
	it("takes each field from whichever side changed it last", () => {
		const phone = serverDoc("a", {
			title: "Phone name",
			titleChangedAt: 4_000,
			position: { block: 2, offset: 0 },
			progress: 0.2,
			positionChangedAt: 1_000,
		});
		const laptop = serverDoc("a", {
			title: "Laptop name",
			titleChangedAt: 2_000,
			languageOverride: "fr",
			languageOverrideChangedAt: 3_000,
			position: { block: 9, offset: 4 },
			progress: 0.8,
			positionChangedAt: 6_000,
		});
		const expected = serverDoc("a", {
			title: "Phone name",
			titleChangedAt: 4_000,
			languageOverride: "fr",
			languageOverrideChangedAt: 3_000,
			position: { block: 9, offset: 4 },
			progress: 0.8,
			positionChangedAt: 6_000,
		});
		expect(mergeDocument(phone, laptop)).toEqual(expected);
		expect(mergeDocument(laptop, phone)).toEqual(expected);
	});

	it("lets a later clear of the language override win over an earlier choice", () => {
		const chosen = serverDoc("a", {
			languageOverride: "de",
			languageOverrideChangedAt: 1_000,
		});
		const cleared = serverDoc("a", {
			languageOverride: null,
			languageOverrideChangedAt: 2_000,
		});
		expect(mergeDocument(chosen, cleared).languageOverride).toBeNull();
	});
});

describe("Sessions", () => {
	it("keeps the copy with more active time", () => {
		const short = session("s", { activeMs: 30_000, wordsRead: 100 });
		const long = session("s", { activeMs: 90_000, wordsRead: 300 });
		expect(mergeSession(short, long)).toEqual(long);
		expect(mergeSession(long, short)).toEqual(long);
	});

	it("unions two lists by ID", () => {
		const merged = mergeSessions(
			[session("a"), session("b", { activeMs: 10 })],
			[session("b", { activeMs: 20 }), session("c")],
		);
		expect(merged.map((each) => [each.id, each.activeMs])).toEqual([
			["a", 60_000],
			["b", 20],
			["c", 60_000],
		]);
	});
});

describe("tombstones", () => {
	it("keep the latest delete of one document", () => {
		const first = { id: "a", contentHash: "h", deletedAt: 1_000 };
		const again = { id: "a", contentHash: "h", deletedAt: 3_000 };
		expect(mergeTombstone(first, again)).toEqual(again);
		expect(mergeTombstone(again, first)).toEqual(again);
	});
});

describe("insert-once records", () => {
	it("adds what is new and never replaces a record already kept", () => {
		const kept = [{ id: "a", minutes: 10 }];
		const incoming = [
			{ id: "a", minutes: 99 },
			{ id: "b", minutes: 20 },
		];
		expect(mergeInsertOnce(kept, incoming)).toEqual([
			{ id: "a", minutes: 10 },
			{ id: "b", minutes: 20 },
		]);
	});
});

describe("settings", () => {
	it("merge one key at a time by each key's own change time", () => {
		expect(
			mergeSettings(
				{
					wpm: { value: 300, changedAt: 2_000 },
					chunkSize: { value: 1, changedAt: 1_000 },
				},
				{
					wpm: { value: 250, changedAt: 1_000 },
					chunkSize: { value: 3, changedAt: 3_000 },
					rewind: { value: 5, changedAt: 500 },
				},
			),
		).toEqual({
			wpm: { value: 300, changedAt: 2_000 },
			chunkSize: { value: 3, changedAt: 3_000 },
			rewind: { value: 5, changedAt: 500 },
		});
	});
});
