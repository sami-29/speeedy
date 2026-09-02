import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedDocument } from "../models/types.js";

const { store } = vi.hoisted(() => ({
	store: new Map<IDBValidKey, unknown>(),
}));

vi.mock("idb", () => ({
	openDB: vi.fn(async () => ({
		getAll: async () => [...store.values()],
		put: async (_storeName: string, value: { id: string }) => {
			store.set(value.id, value);
		},
		get: async (_storeName: string, key: IDBValidKey) => store.get(key),
		delete: async (_storeName: string, key: IDBValidKey) => {
			store.delete(key);
		},
		transaction: () => {
			const keys = [...store.keys()];
			let index = 0;
			const nextCursor = () => {
				if (index >= keys.length) return null;
				const key = keys[index++];
				return {
					get value() {
						return store.get(key) ?? null;
					},
					delete: async () => {
						store.delete(key);
					},
					continue: async () => nextCursor(),
				};
			};
			return {
				store: {
					openCursor: async () => nextCursor(),
				},
				done: Promise.resolve(),
			};
		},
	})),
}));

function makeDoc(
	overrides: Partial<SavedDocument> & Pick<SavedDocument, "id" | "text">,
): SavedDocument {
	return {
		title: "A book",
		wordCount: 2,
		savedAt: "2026-01-01T00:00:00.000Z",
		resumeWordIndex: 0,
		completionPercent: 0,
		...overrides,
	};
}

describe("storage-service documents", () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
	});

	it("treats null and incomplete records as invalid", async () => {
		const { isValidSavedDocument } = await import("./storage-service.js");
		expect(isValidSavedDocument(null)).toBe(false);
		expect(isValidSavedDocument(undefined)).toBe(false);
		expect(isValidSavedDocument({ id: "x" })).toBe(false);
		expect(
			isValidSavedDocument(
				makeDoc({ id: "ok", text: "Hello world", title: "Ok" }),
			),
		).toBe(true);
	});

	it("loads the library even when IndexedDB returns a null record", async () => {
		store.set("ghost", null);
		store.set(
			"ok",
			makeDoc({
				id: "ok",
				text: "Hello world",
				savedAt: "2026-02-01T00:00:00.000Z",
			}),
		);

		const { getSavedDocuments } = await import("./storage-service.js");
		const docs = await getSavedDocuments();

		expect(docs).toHaveLength(1);
		expect(docs[0].id).toBe("ok");
		expect(store.has("ghost")).toBe(false);
		expect(store.has("ok")).toBe(true);
	});

	it("returns an empty library when the only record is null", async () => {
		store.set("ghost", null);

		const { getSavedDocuments } = await import("./storage-service.js");
		await expect(getSavedDocuments()).resolves.toEqual([]);
		expect(store.size).toBe(0);
	});

	it("saves a new document when a null library record would previously crash", async () => {
		store.set("ghost", null);
		store.set("broken", { id: "broken" });

		const { saveDocument, getSavedDocuments } = await import(
			"./storage-service.js"
		);
		const saved = await saveDocument({
			title: "Pasted Text",
			text: "Fresh text to read",
			wordCount: 4,
			resumeWordIndex: 0,
			completionPercent: 0,
		});

		expect(saved.id).toBeTruthy();
		expect(saved.contentHash).toMatch(/^[a-f0-9]{64}$/);
		const docs = await getSavedDocuments();
		expect(docs.some((d) => d.id === saved.id)).toBe(true);
		expect(store.has("ghost")).toBe(false);
		expect(store.has("broken")).toBe(false);
	});

	it("still dedupes against a valid existing document", async () => {
		store.set(
			"old",
			makeDoc({
				id: "old",
				text: "Same text",
				contentHash: undefined,
			}),
		);

		const { saveDocument } = await import("./storage-service.js");
		const saved = await saveDocument({
			title: "Copy",
			text: "Same text",
			wordCount: 2,
			resumeWordIndex: 0,
			completionPercent: 0,
		});

		expect(saved.id).toBe("old");
	});
});
