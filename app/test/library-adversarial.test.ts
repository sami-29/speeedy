/*
 * Adversarial tests for ticket #52's Library changes: the structural content hash, the
 * *ChangedAt stamps and applyRemotePosition. Expected values come from the ticket, the
 * "Orchestrator decisions for #52" note (Q1: the hash covers block kind, level, depth,
 * ordered and text, and nothing else; Q3: setters stamp their own change times; Risk 11:
 * a remote Position keeps the remote time) or a hand calculation in the test. A failing
 * test exposes a defect in the code under test.
 */
import "fake-indexeddb/auto";
import type { Block, Document } from "@speeedy/contracts";
import { syncDevice } from "@speeedy/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLibraryStore,
	type DocumentMeta,
	LIBRARY_DB_NAME,
	type LibraryStore,
} from "../src/lib/library/store.ts";

let counter = 0;
let clock = 1_000;
let store: LibraryStore;
const opened: LibraryStore[] = [];

beforeEach(() => {
	clock = 1_000;
	store = createLibraryStore({
		name: `${LIBRARY_DB_NAME}-adv-${++counter}`,
		now: () => clock,
	});
	opened.push(store);
});

afterEach(() => {
	for (const each of opened.splice(0)) each.close();
});

const blocksOf = (...blocks: Block[]): Document => ({ version: 1, blocks });
const hashOf = async (...blocks: Block[]) => {
	const { meta } = await store.addDocument({
		document: blocksOf(...blocks),
		title: "t",
		language: "en",
	});
	return meta.contentHash;
};
const para = (text: string): Block => ({ kind: "paragraph", text, spans: [] });
const heading = (text: string, level: 1 | 2 | 3 | 4 | 5 | 6): Block => ({
	kind: "heading",
	level,
	text,
	spans: [],
});
const item = (text: string, depth: number, ordered: boolean): Block => ({
	kind: "list-item",
	depth,
	ordered,
	text,
	spans: [],
});

/* ------------------------------------------------------------------------------------ */
/* The structural hash                                                                   */
/* ------------------------------------------------------------------------------------ */

describe("content hash: what it distinguishes", () => {
	it("tells every text-bearing kind apart for the same text", async () => {
		const kinds = [
			"paragraph",
			"quote",
			"code",
			"table-text",
			"caption",
		] as const;
		const hashes = new Set<string>();
		for (const kind of kinds) {
			hashes.add(
				await hashOf({ kind, text: "same words", spans: [] } as Block),
			);
		}
		hashes.add(await hashOf(heading("same words", 1)));
		hashes.add(await hashOf(item("same words", 0, false)));
		hashes.add(await hashOf({ kind: "image-placeholder", alt: "same words" }));
		expect(hashes.size).toBe(kinds.length + 3);
	});

	it("tells every heading level apart", async () => {
		const hashes = new Set<string>();
		for (const level of [1, 2, 3, 4, 5, 6] as const) {
			hashes.add(await hashOf(heading("Title", level)));
		}
		expect(hashes.size).toBe(6);
	});

	it("tells list depths and ordered from unordered apart", async () => {
		const hashes = new Set<string>();
		for (const depth of [0, 1, 2, 7]) {
			for (const ordered of [false, true]) {
				hashes.add(await hashOf(item("x", depth, ordered)));
			}
		}
		expect(hashes.size).toBe(8);
	});

	it("tells block order, splits and joins apart", async () => {
		const hashes = new Set([
			await hashOf(para("a"), para("b")),
			await hashOf(para("b"), para("a")),
			await hashOf(para("ab")),
			await hashOf(para("a b")),
			await hashOf(para("a"), para("b"), para("")),
			await hashOf(para(""), para("a"), para("b")),
			await hashOf(para("a\nb")),
		]);
		expect(hashes.size).toBe(7);
	});

	it("is not fooled by text that looks like the hashed encoding", async () => {
		// The encoding is JSON; text with quotes, commas and brackets must not forge a boundary.
		const forged = await hashOf(para('a"],["paragraph","b'));
		const real = await hashOf(para("a"), para("b"));
		expect(forged).not.toBe(real);
		expect(await hashOf(para('x","paragraph","y'))).not.toBe(
			await hashOf(para("x"), para("y")),
		);
	});

	it("tells every character-level difference in the text apart", async () => {
		const texts = [
			"word",
			"Word",
			"word ",
			" word",
			"wo rd",
			"word​",
			"é", // e + combining acute
			"é", // precomposed e acute
			"😀", // a well-formed pair
			"Å",
			"Å",
			"Å", // Angstrom sign
		];
		const hashes = new Set<string>();
		for (const text of texts) hashes.add(await hashOf(para(text)));
		expect(hashes.size).toBe(texts.length);
	});

	it("tells an empty alt text from no image", async () => {
		expect(
			await hashOf({ kind: "image-placeholder", alt: "" }, para("x")),
		).not.toBe(await hashOf(para("x")));
	});
});

describe("content hash: what it ignores", () => {
	it("ignores spans, link targets and image sizes", async () => {
		const plain = await hashOf(
			para("hello world"),
			heading("H", 2),
			item("i", 1, true),
			{ kind: "image-placeholder", alt: "pic" },
		);
		const styled = await hashOf(
			{
				kind: "paragraph",
				text: "hello world",
				spans: [
					{ kind: "strong", start: 0, end: 5 },
					{ kind: "link", start: 6, end: 11, href: "https://example.com" },
				],
			},
			{
				kind: "heading",
				level: 2,
				text: "H",
				spans: [{ kind: "emphasis", start: 0, end: 1 }],
			},
			{
				kind: "list-item",
				depth: 1,
				ordered: true,
				text: "i",
				spans: [{ kind: "emphasis", start: 0, end: 1 }],
			},
			{ kind: "image-placeholder", alt: "pic", width: 1, height: 2 },
		);
		expect(styled).toBe(plain);
	});

	it("ignores a list depth that a heading does not have and a level that a list does not have", async () => {
		// A heading's hash holds its level, not a depth: a stray `depth` field is not hashed.
		const a = await hashOf(heading("H", 3));
		const b = await hashOf({
			kind: "heading",
			level: 3,
			text: "H",
			spans: [],
		} as Block);
		expect(a).toBe(b);
	});

	it("gives the same document the same hash on another store (title, language, source URL, clock)", async () => {
		const other = createLibraryStore({
			name: `${LIBRARY_DB_NAME}-adv-other-${++counter}`,
			now: () => 99,
		});
		opened.push(other);
		const first = await store.addDocument({
			document: blocksOf(heading("H", 1), para("body")),
			title: "One",
			language: "en",
			sourceUrl: "https://a.example",
		});
		const second = await other.addDocument({
			document: blocksOf(heading("H", 1), para("body")),
			title: "Two",
			language: "fr",
			source: "demo",
			sourceUrl: "https://b.example",
		});
		expect(second.meta.contentHash).toBe(first.meta.contentHash);
	});
});

describe("content hash: against an independent oracle", () => {
	// A small deterministic generator (mulberry32) over a tiny alphabet, so collisions in
	// the structure happen often. Oracle: two documents hash the same exactly when their
	// (kind, level|depth+ordered, text) lists are equal.
	const rng = (seed: number) => () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const texts = ["a", "b", "ab", "", " ", "a b", '"', "\\"];
	const makeBlock = (next: () => number): Block => {
		const text = texts[Math.floor(next() * texts.length)] as string;
		const spans =
			text !== "" && next() < 0.3
				? [{ kind: "strong" as const, start: 0, end: 1 }]
				: [];
		switch (Math.floor(next() * 4)) {
			case 0:
				return {
					kind: "heading",
					level: (1 + Math.floor(next() * 2)) as 1 | 2,
					text,
					spans,
				};
			case 1:
				return {
					kind: "list-item",
					depth: Math.floor(next() * 2),
					ordered: next() < 0.5,
					text,
					spans,
				};
			case 2:
				return { kind: "quote", text, spans };
			default:
				return { kind: "paragraph", text, spans };
		}
	};
	const oracleKey = (blocks: Block[]) =>
		blocks
			.map((block) =>
				block.kind === "heading"
					? `h|${block.level}|${block.text.length}|${block.text}`
					: block.kind === "list-item"
						? `l|${block.depth}|${block.ordered}|${block.text.length}|${block.text}`
						: `${block.kind}|${block.text.length}|${block.text}`,
			)
			.join("\n");

	it("hashes two random documents the same exactly when their structure is the same", async () => {
		const next = rng(12345);
		const seen = new Map<string, string>(); // oracle key -> hash
		const byHash = new Map<string, string>(); // hash -> oracle key
		for (let i = 0; i < 400; i++) {
			const blocks = Array.from({ length: 1 + Math.floor(next() * 2) }, () =>
				makeBlock(next),
			);
			const key = oracleKey(blocks);
			const hash = await hashOf(...blocks);
			if (seen.has(key)) expect(hash).toBe(seen.get(key));
			if (byHash.has(hash)) expect(key).toBe(byHash.get(hash));
			seen.set(key, hash);
			byHash.set(hash, key);
		}
		// The alphabet is small enough that the loop met repeats and near-misses.
		expect(seen.size).toBeGreaterThan(50);
	}, 60_000);
});

/* ------------------------------------------------------------------------------------ */
/* Change-time stamps                                                                    */
/* ------------------------------------------------------------------------------------ */

describe("change-time stamps", () => {
	const add = async (text = "one two three") =>
		(
			await store.addDocument({
				document: blocksOf(para(text)),
				title: "T",
				language: "en",
			})
		).meta;

	it("leaves every other field's time alone when one field changes", async () => {
		const meta = await add();
		clock = 2_000;
		await store.rename(meta.id, "New");
		clock = 3_000;
		await store.setLanguageOverride(meta.id, "de");
		clock = 4_000;
		await store.savePosition(meta.id, { block: 0, offset: 4 }, 0.3);
		clock = 5_000;
		await store.setDeviceOnly(meta.id, true);
		expect(await store.get(meta.id)).toMatchObject({
			titleChangedAt: 2_000,
			languageOverrideChangedAt: 3_000,
			positionChangedAt: 4_000,
			deviceOnlyChangedAt: 5_000,
			lastReadAt: 4_000,
		});
	});

	it("does not stamp a Position that was refused", async () => {
		const meta = await add();
		clock = 9_000;
		for (const bad of [
			{ block: -1, offset: 0 },
			{ block: 0, offset: 1.5 },
			{ block: 0 },
			null,
		]) {
			await expect(
				store.savePosition(meta.id, bad as never, 0.5),
			).rejects.toBeDefined();
		}
		await expect(
			store.savePosition(meta.id, { block: 0, offset: 1 }, Number.NaN),
		).rejects.toBeDefined();
		expect(await store.get(meta.id)).toMatchObject({
			positionChangedAt: 0,
			lastReadAt: null,
			position: { block: 0, offset: 0 },
		});
	});

	it("does not stamp device-only when it is set to the value it already has", async () => {
		// Turning "Keep on this device only" off when it is already off changes nothing, so it
		// must not count as a later change: Sync revives a document deleted elsewhere when
		// deviceOnlyChangedAt is later than the delete.
		const meta = await add();
		clock = 5_000;
		const after = await store.setDeviceOnly(meta.id, false);
		expect(after.deviceOnlyChangedAt).toBe(meta.deviceOnlyChangedAt);
	});

	it("a no-op device-only call cannot revive a document another device deleted", async () => {
		const meta = await add();
		clock = 3_000; // another device deleted it at 3000
		const tombstone = {
			id: meta.id,
			contentHash: meta.contentHash,
			deletedAt: 3_000,
		};
		clock = 5_000;
		const after = await store.setDeviceOnly(meta.id, false);
		const result = syncDevice({
			device: {
				generation: "g",
				documents: [after],
				tombstones: [],
				settings: {},
				dailyGoalChanges: [],
				sessions: [],
				trainingResults: [],
			},
			server: {
				generation: "g",
				documents: [],
				tombstones: [tombstone],
				settings: {},
				dailyGoalChanges: [],
				sessions: [],
				trainingResults: [],
			},
			now: 6_000,
			newId: () => "fresh",
		});
		if (result.status !== "synced") throw new Error("expected a sync");
		expect(result.device.documents).toEqual([]);
	});
});

/* ------------------------------------------------------------------------------------ */
/* applyRemotePosition                                                                   */
/* ------------------------------------------------------------------------------------ */

type Remote = Pick<DocumentMeta, "position" | "progress" | "positionChangedAt">;

describe("applyRemotePosition", () => {
	const make = async () =>
		(
			await store.addDocument({
				document: blocksOf(para("first block here"), para("second block here")),
				title: "T",
				language: "en",
			})
		).meta;
	const remote = (
		block: number,
		offset: number,
		at: number,
		progress = 0.5,
	): Remote => ({
		position: { block, offset },
		progress,
		positionChangedAt: at,
	});
	const snapshot = async (id: string) => {
		const meta = await store.get(id);
		return JSON.stringify(meta);
	};

	it("never lets an older remote Position win, whatever its offset", async () => {
		const meta = await make();
		clock = 9_000;
		await store.savePosition(meta.id, { block: 0, offset: 2 }, 0.1);
		const before = await snapshot(meta.id);
		for (const at of [8_999, 1, 0, -1, -1e21, Number.MIN_SAFE_INTEGER]) {
			expect(
				await store.applyRemotePosition(meta.id, remote(1, 9, at, 1)),
			).toBe(false);
		}
		expect(await snapshot(meta.id)).toBe(before);
	});

	it("takes a strictly later one and reports it", async () => {
		const meta = await make();
		clock = 9_000;
		await store.savePosition(meta.id, { block: 0, offset: 2 }, 0.1);
		expect(await store.applyRemotePosition(meta.id, remote(1, 1, 9_001))).toBe(
			true,
		);
		expect(await store.get(meta.id)).toMatchObject({
			position: { block: 1, offset: 1 },
			positionChangedAt: 9_001,
			progress: 0.5,
		});
	});

	it("reports false and writes nothing when the remote copy is identical", async () => {
		const meta = await make();
		clock = 9_000;
		await store.savePosition(meta.id, { block: 0, offset: 2 }, 0.1);
		const before = await snapshot(meta.id);
		expect(
			await store.applyRemotePosition(meta.id, remote(0, 2, 9_000, 0.1)),
		).toBe(false);
		expect(await snapshot(meta.id)).toBe(before);
	});

	it("ends on the same Position whatever order a set of remote Positions arrives in", async () => {
		const set: Remote[] = [
			remote(0, 1, 5),
			remote(0, 2, 5),
			remote(1, 0, 7, 0.9),
			remote(1, 0, 7, 0.4),
			remote(0, 9, 3),
			remote(1, 3, 7, 0.4),
		];
		const orders = [
			[0, 1, 2, 3, 4, 5],
			[5, 4, 3, 2, 1, 0],
			[2, 0, 4, 1, 5, 3],
			[3, 2, 1, 0, 5, 4],
			[4, 5, 0, 3, 2, 1],
		];
		const finals = new Set<string>();
		for (const order of orders) {
			const meta = await make();
			// Each run needs its own document: make() on an existing text would dedupe.
			await store.deleteDocument(meta.id);
			const fresh = (
				await store.addDocument({
					document: blocksOf(
						para(`run ${order.join("")}`),
						para("second block here"),
					),
					title: "T",
					language: "en",
				})
			).meta;
			for (const index of order) {
				await store.applyRemotePosition(fresh.id, set[index] as Remote);
			}
			const end = await store.get(fresh.id);
			finals.add(
				JSON.stringify([end?.position, end?.progress, end?.positionChangedAt]),
			);
		}
		expect(finals.size).toBe(1);
		// Hand calculation: the latest time is 7. At time 7 the candidates are
		// {1,0 .9}, {1,0 .4} and {1,3 .4}; the tie rule keeps the larger canonical JSON of
		// {value:{position,progress},at}. Keys sort: "at" < "value"; inside value
		// "position" < "progress"; inside position "block" < "offset".
		// '{"at":7,"value":{"position":{"block":1,"offset":3},...' is the largest.
		const [only] = [...finals];
		expect(JSON.parse(only as string)).toEqual([
			{ block: 1, offset: 3 },
			0.4,
			7,
		]);
	});

	it("keeps the local Position when a remote one at the same time is the smaller record", async () => {
		const meta = await make();
		clock = 9_000;
		await store.savePosition(meta.id, { block: 1, offset: 5 }, 0.8);
		expect(
			await store.applyRemotePosition(meta.id, remote(0, 1, 9_000, 0.1)),
		).toBe(false);
		expect((await store.get(meta.id))?.position).toEqual({
			block: 1,
			offset: 5,
		});
	});

	it("runs concurrent applications and a local read to the same result in any interleaving", async () => {
		const run = async (order: number[]) => {
			const meta = (
				await store.addDocument({
					document: blocksOf(para(`order ${order.join("")}`), para("second")),
					title: "T",
					language: "en",
				})
			).meta;
			clock = 10_000;
			const jobs = [
				() => store.applyRemotePosition(meta.id, remote(0, 1, 2_000)),
				() => store.applyRemotePosition(meta.id, remote(1, 1, 6_000)),
				() => store.applyRemotePosition(meta.id, remote(0, 5, 5_000)),
				() => store.applyRemotePosition(meta.id, remote(1, 4, 3_000)),
				() => store.savePosition(meta.id, { block: 0, offset: 7 }, 0.2),
			];
			await Promise.all(
				order.map((index) => (jobs[index] as () => Promise<unknown>)()),
			);
			const end = await store.get(meta.id);
			return JSON.stringify([
				end?.position,
				end?.progress,
				end?.positionChangedAt,
			]);
		};
		const results = new Set<string>();
		for (const order of [
			[0, 1, 2, 3, 4],
			[4, 3, 2, 1, 0],
			[1, 4, 0, 3, 2],
			[2, 0, 4, 1, 3],
		]) {
			results.add(await run(order));
		}
		// The local read is the latest (10_000), so it wins in every order.
		expect([...results]).toEqual([
			JSON.stringify([{ block: 0, offset: 7 }, 0.2, 10_000]),
		]);
	});

	it("refuses a remote Position that is not one, and leaves the record exactly as it was", async () => {
		const meta = await make();
		clock = 9_000;
		await store.savePosition(meta.id, { block: 0, offset: 2 }, 0.1);
		const before = await snapshot(meta.id);
		const good = remote(1, 1, 99_999);
		const protoPosition = JSON.parse(
			'{"block":1,"offset":1,"__proto__":{"x":1}}',
		);
		const bads: unknown[] = [
			null,
			undefined,
			5,
			"x",
			[],
			{},
			{ ...good, position: null },
			{ ...good, position: [1, 1] },
			{ ...good, position: { block: 1 } },
			{ ...good, position: { block: 1, offset: 1, extra: true } },
			{ ...good, position: protoPosition },
			{ ...good, position: { block: -0.5, offset: 1 } },
			{ ...good, position: { block: Number.NaN, offset: 1 } },
			{ ...good, position: { block: 1e300, offset: 1 } },
			{ ...good, position: { block: "1", offset: 1 } },
			{ ...good, progress: "0.5" },
			{ ...good, progress: -0.0001 },
			{ ...good, progress: 1.0001 },
			{ ...good, progress: Number.NEGATIVE_INFINITY },
			{ ...good, progress: null },
			{ ...good, positionChangedAt: "99999" },
			{ ...good, positionChangedAt: Number.NaN },
			{ ...good, positionChangedAt: Number.NEGATIVE_INFINITY },
			{ ...good, positionChangedAt: undefined },
			{ ...good, positionChangedAt: null },
			{ position: good.position, progress: good.progress },
		];
		for (const bad of bads) {
			let outcome: unknown = "returned";
			try {
				outcome = await store.applyRemotePosition(meta.id, bad as Remote);
			} catch (error) {
				outcome = "threw";
				expect(error).toBeInstanceOf(Error);
			}
			expect(outcome, JSON.stringify(bad)).toBe("threw");
		}
		expect(await snapshot(meta.id)).toBe(before);
	});

	it("does not create a document for an unknown ID", async () => {
		await expect(
			store.applyRemotePosition("ghost", remote(0, 0, 5)),
		).rejects.toMatchObject({ code: "not-found" });
		expect(await store.list()).toEqual([]);
		await expect(
			store.applyRemotePosition("__proto__", remote(0, 0, 5)),
		).rejects.toMatchObject({ code: "not-found" });
	});

	it("takes only the three Position fields from what it is given", async () => {
		const meta = await make();
		const hostile = {
			...remote(1, 1, 9_000),
			title: "pwned",
			deviceOnly: true,
			sourceUrl: "https://evil.example",
			id: "other",
			contentHash: "x",
		};
		expect(await store.applyRemotePosition(meta.id, hostile as Remote)).toBe(
			true,
		);
		const after = await store.get(meta.id);
		expect(after).toMatchObject({
			id: meta.id,
			title: "T",
			deviceOnly: false,
			sourceUrl: null,
			contentHash: meta.contentHash,
		});
		expect(await store.get("other")).toBeNull();
	});

	it("keeps the stored Position independent of the object it was given", async () => {
		const meta = await make();
		const given = remote(1, 1, 9_000);
		await store.applyRemotePosition(meta.id, given);
		(given.position as { block: number }).block = 0;
		expect((await store.get(meta.id))?.position).toEqual({
			block: 1,
			offset: 1,
		});
	});

	it("leaves lastReadAt null for a never-read document when a remote copy at time 0 differs", async () => {
		// positionChangedAt 0 means "never read". Such a copy was not read at any time, so it
		// cannot make this document look read at the epoch (lastReadAt 0 sorts it below
		// every document that was ever added).
		const meta = await make();
		await store.applyRemotePosition(meta.id, remote(1, 0, 0, 0.5));
		const after = await store.get(meta.id);
		expect(after?.lastReadAt === null || (after?.lastReadAt ?? 0) > 0).toBe(
			true,
		);
	});

	it("still clamps a Position beyond the end when the document loads", async () => {
		const meta = await make();
		await store.applyRemotePosition(meta.id, remote(50, 400, 9_000, 1));
		const loaded = await store.load(meta.id);
		expect(loaded?.meta.position.block).toBeLessThan(2);
	});

	it("a local read never moves a Position's time backwards, even when the local clock is behind", async () => {
		// Clock skew is out of #52 (note Q5), but a last-write-wins register's time must never
		// go down: a read stamped 5_000 over a Position stamped 8_000 is silently lost on the
		// next sync, because the account still holds the 8_000 copy.
		const meta = await make();
		clock = 8_000;
		await store.applyRemotePosition(meta.id, remote(1, 1, 8_000));
		clock = 5_000;
		await store.savePosition(meta.id, { block: 0, offset: 3 }, 0.1);
		expect(
			(await store.get(meta.id))?.positionChangedAt,
		).toBeGreaterThanOrEqual(8_000);
	});
});
