import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import { textsOf } from "./helpers";

/**
 * Real PDFs laid out by LibreOffice (see `fixtures-src/pdf/build.mts`). The text of each is
 * known, so the whole output can be compared with it: every paragraph, in order, with the
 * line-end hyphens rejoined, the running heads and page numbers gone, and the real
 * compounds ("well-known", "self-paced") still hyphenated.
 */
const fixtures = join(import.meta.dirname, "fixtures", "pdf");
const sources = join(import.meta.dirname, "..", "fixtures-src", "pdf");

const NAMES = [
	"paper-two-column",
	"textbook-pages",
	"article-block-paragraphs",
] as const;

async function read(name: string) {
	const bytes = new Uint8Array(readFileSync(join(fixtures, `${name}.pdf`)));
	const expected = JSON.parse(
		readFileSync(join(sources, `${name}.paragraphs.json`), "utf8"),
	) as string[];
	return { outcome: await parse(bytes, `${name}.pdf`), expected };
}

describe("pdf: real documents", () => {
	for (const name of NAMES) {
		it(`${name}: gives back every paragraph exactly`, async () => {
			const { outcome, expected } = await read(name);
			expect(textsOf(outcome)).toEqual(expected);
		});

		it(`${name}: has no running head, page number or broken word`, async () => {
			const { outcome, expected } = await read(name);
			const text = textsOf(outcome).join("\n");
			expect(text).not.toMatch(/Page \d+ of \d+/);
			expect(text).not.toMatch(/[A-Za-z]- [a-z]/);
			expect(text).not.toMatch(/\u00ad/);
			const vocabulary = new Set(
				expected
					.join(" ")
					.split(/\s+/)
					.map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")),
			);
			const unknown = text
				.split(/\s+/)
				.map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
				.filter((w) => w !== "" && !vocabulary.has(w));
			expect(unknown).toEqual([]);
		});
	}

	it("keeps real hyphenated compounds whole where a line broke them", async () => {
		const { outcome } = await read("paper-two-column");
		const text = textsOf(outcome).join("\n");
		for (const compound of [
			"well-known",
			"self-paced",
			"long-term",
			"high-frequency",
		]) {
			expect(text.toLowerCase()).toContain(compound);
		}
		expect(text).not.toMatch(/wellknown|selfpaced|longterm|highfrequency/i);
	});

	it("reads the title block of a two-column paper before its columns", async () => {
		const { outcome } = await read("paper-two-column");
		const texts = textsOf(outcome);
		expect(texts[0]).toBe(
			"Paced Reading and Sustained Attention: A Pilot Study",
		);
		expect(texts[3]).toBe("1 Introduction");
	});
});
