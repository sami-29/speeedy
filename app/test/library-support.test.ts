import "fake-indexeddb/auto";
import { validateDocument } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import { progressTracker } from "../src/lib/library/progress.ts";
import { SAMPLES, sampleById } from "../src/lib/library/samples.ts";
import {
	createLibraryStore,
	LIBRARY_DB_NAME,
} from "../src/lib/library/store.ts";
import { documentTitle } from "../src/lib/library/title.ts";

describe("sample documents", () => {
	it("ship with the app as valid Documents with titles", () => {
		expect(SAMPLES.length).toBeGreaterThanOrEqual(2);
		expect(new Set(SAMPLES.map((sample) => sample.id)).size).toBe(
			SAMPLES.length,
		);
		for (const sample of SAMPLES) {
			expect(sample.title.trim()).not.toBe("");
			expect(sample.language).toBe("en");
			expect(validateDocument(sample.document).ok).toBe(true);
			expect(sample.document.blocks.length).toBeGreaterThan(1);
		}
		expect(sampleById(SAMPLES[0]?.id ?? "")).toBe(SAMPLES[0]);
		expect(sampleById("nope")).toBeUndefined();
	});

	it("open in the Library with source demo, once however often they are opened", async () => {
		const store = createLibraryStore({ name: `${LIBRARY_DB_NAME}-samples` });
		try {
			const sample = SAMPLES[0];
			if (!sample) throw new Error("no sample shipped");
			const first = await store.addDocument({
				document: sample.document,
				title: sample.title,
				language: sample.language,
				source: "demo",
			});
			expect(first.meta.source).toBe("demo");
			const second = await store.addDocument({
				document: sample.document,
				title: sample.title,
				language: sample.language,
				source: "demo",
			});
			expect(second.duplicate).toBe(true);
			expect(await store.list()).toHaveLength(1);
		} finally {
			store.close();
		}
	});
});

describe("progress", () => {
	const document = {
		version: 1 as const,
		blocks: [
			{ kind: "paragraph" as const, text: "aaaa", spans: [] },
			{ kind: "paragraph" as const, text: "bbbbbb", spans: [] },
			{ kind: "paragraph" as const, text: "cccccccccc", spans: [] },
		],
	};

	it("is the share of the text before the Position", () => {
		const progress = progressTracker(document);
		expect(progress({ block: 0, offset: 0 })).toBe(0);
		expect(progress({ block: 1, offset: 0 })).toBe(0.2);
		expect(progress({ block: 1, offset: 3 })).toBe(0.35);
		expect(progress({ block: 2, offset: 10 })).toBe(1);
	});

	it("clamps a Position outside the Document and copes with an empty one", () => {
		const progress = progressTracker(document);
		expect(progress({ block: 99, offset: 0 })).toBe(1);
		expect(progress({ block: 0, offset: -5 })).toBe(0);
		expect(
			progressTracker({ version: 1, blocks: [] })({ block: 0, offset: 0 }),
		).toBe(0);
	});
});

describe("document titles", () => {
	const paragraphs = (text: string) => ({
		version: 1 as const,
		blocks: [{ kind: "paragraph" as const, text, spans: [] }],
	});

	it("prefers the title the parser found", () => {
		expect(documentTitle("  Chapter One ", paragraphs("It began."))).toBe(
			"Chapter One",
		);
	});

	it("falls back to the opening words, cut at a word", () => {
		const title = documentTitle(
			null,
			paragraphs(
				"It was a bright cold day in April, and the clocks were striking thirteen.",
			),
		);
		expect(title.length).toBeLessThanOrEqual(61);
		expect(title.startsWith("It was a bright cold day in April,")).toBe(true);
		expect(title.endsWith("…")).toBe(true);
	});

	it("uses a plain name for a Document with no text", () => {
		expect(documentTitle(null, { version: 1, blocks: [] })).toBe("Untitled");
	});
});
