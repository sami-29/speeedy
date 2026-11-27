import "fake-indexeddb/auto";
import type { Document, Position } from "@speeedy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPositionKeeper,
	PENDING_POSITION_KEY,
	recoverPendingPosition,
} from "../src/lib/library/pending-position.ts";
import { createPositionSaver } from "../src/lib/library/position-saver.ts";
import { createLibraryStore } from "../src/lib/library/store.ts";

function memoryStorage() {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key),
	};
}

const at = (offset: number): Position => ({ block: 0, offset });

describe("the position saver", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		});
		vi.stubGlobal("document", {
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			visibilityState: "visible",
		});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("keeps a paused Position in storage before the Library write finishes", () => {
		const storage = memoryStorage();
		// The Library write never finishes, as when the page goes first.
		const save = vi.fn(() => new Promise<void>(() => undefined));
		const saver = createPositionSaver({
			save,
			progress: () => 0.25,
			keeper: createPositionKeeper(storage, "doc-1"),
		});
		saver.record(at(12), true);

		expect(save).toHaveBeenCalledOnce();
		expect(
			JSON.parse(storage.items.get(PENDING_POSITION_KEY) ?? "null"),
		).toMatchObject({
			id: "doc-1",
			position: at(12),
			progress: 0.25,
		});
		saver.dispose();
	});

	it("lets go of the kept Position once the Library has it", async () => {
		const storage = memoryStorage();
		const saver = createPositionSaver({
			save: () => Promise.resolve(),
			progress: () => 0.25,
			keeper: createPositionKeeper(storage, "doc-1"),
		});
		saver.record(at(12), true);
		await vi.advanceTimersByTimeAsync(0);

		expect(storage.items.has(PENDING_POSITION_KEY)).toBe(false);
		saver.dispose();
	});

	it("does not drop a newer Position when an older write finishes late", async () => {
		const storage = memoryStorage();
		const finish: (() => void)[] = [];
		const saver = createPositionSaver({
			save: () => new Promise<void>((done) => finish.push(done)),
			progress: () => 0.5,
			keeper: createPositionKeeper(storage, "doc-1", () => 1000),
		});
		saver.record(at(3), true);
		saver.record(at(9), true);
		finish[0]?.();
		await vi.advanceTimersByTimeAsync(0);

		expect(
			JSON.parse(storage.items.get(PENDING_POSITION_KEY) ?? "null"),
		).toMatchObject({
			position: at(9),
		});
		saver.dispose();
	});
});

describe("recoverPendingPosition", () => {
	const document: Document = {
		version: 1,
		blocks: [
			{
				kind: "paragraph",
				text: "one two three four five six seven eight",
				spans: [],
			},
		],
	};
	let n = 0;
	const open = () =>
		createLibraryStore({ name: `speeedy-pending-${++n}-${Math.random()}` });
	const add = (store: ReturnType<typeof open>) =>
		store.addDocument({
			document,
			title: "Words",
			language: "en",
			source: "own",
		});

	it("puts a Position the last page left pending into the Library", async () => {
		const store = open();
		const { meta } = await add(store);
		const storage = memoryStorage();
		const keeper = createPositionKeeper(storage, meta.id);
		keeper.keep(at(8), 0.2);

		await recoverPendingPosition(storage, store);

		const after = await store.get(meta.id);
		expect(after?.position).toEqual(at(8));
		expect(after?.progress).toBe(0.2);
		expect(storage.items.has(PENDING_POSITION_KEY)).toBe(false);
	});

	it("leaves a later read the Library already holds alone", async () => {
		const store = open();
		const { meta } = await add(store);
		const storage = memoryStorage();
		const keeper = createPositionKeeper(storage, meta.id, () => 5);
		keeper.keep(at(8), 0.2);
		await store.savePosition(meta.id, at(20), 0.5);

		await recoverPendingPosition(storage, store);

		expect((await store.get(meta.id))?.position).toEqual(at(20));
		expect(storage.items.has(PENDING_POSITION_KEY)).toBe(false);
	});

	it("drops a Position whose document is gone, and ignores damaged storage", async () => {
		const store = open();
		const storage = memoryStorage();
		createPositionKeeper(storage, "gone").keep(at(8), 0.2);
		await recoverPendingPosition(storage, store);
		expect(storage.items.has(PENDING_POSITION_KEY)).toBe(false);

		storage.items.set(PENDING_POSITION_KEY, "{not json");
		await expect(
			recoverPendingPosition(storage, store),
		).resolves.toBeUndefined();
		storage.items.set(
			PENDING_POSITION_KEY,
			JSON.stringify({ id: "x", position: "no", progress: 0, at: 1 }),
		);
		await expect(
			recoverPendingPosition(storage, store),
		).resolves.toBeUndefined();
		await expect(
			recoverPendingPosition(undefined, store),
		).resolves.toBeUndefined();
	});
});
