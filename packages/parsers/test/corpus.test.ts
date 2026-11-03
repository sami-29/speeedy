/**
 * The fixture corpus and its runner.
 *
 * Every file under `test/fixtures/` (any depth) is a fixture. Each one has a sibling
 * `<file>.expected.json` that says what `parse` must do with it. Later parser tickets add
 * their fixtures here and need no runner changes: drop in the file plus its expectation.
 *
 * Expectation fields:
 *   hints     optional `ParseHints` passed to `parse` (for example a codepage)
 *   skip      optional reason; the fixture is listed as skipped until a sample turns up
 *   outcome   "document" | "error"
 *   reason    (error) the typed `ParseError` reason
 *   format, title, encoding   (document) the result metadata
 *   language  (document) the detected language code
 *   blocks    (document) the number of blocks
 *   kinds     (document, optional) the block kinds in order
 *   spans     (document, optional) the total number of inline spans
 *   first     (document) the start of the joined block text (first 40 characters)
 *   last      (document) the end of the joined block text (last 40 characters)
 *   words     (document) [min, max] word count of the joined block text
 *
 * The runner also fails on a fixture with no expectation and on an expectation with no
 * fixture, so the corpus cannot drift.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ParseHints, parse } from "../src/index";
import { expectError, expectSuccess } from "./helpers";

const root = join(import.meta.dirname, "fixtures");
const SUFFIX = ".expected.json";

type Expectation = {
	hints?: ParseHints;
	skip?: string;
	outcome: "document" | "error";
	reason?: string;
	format?: string;
	title?: string | null;
	encoding?: string | null;
	language?: string;
	blocks?: number;
	kinds?: string[];
	spans?: number;
	first?: string;
	last?: string;
	words?: [number, number];
};

const files = (
	readdirSync(root, {
		recursive: true,
		withFileTypes: true,
	}) as import("node:fs").Dirent[]
)
	.filter((entry) => entry.isFile())
	.map((entry) => relative(root, join(entry.parentPath, entry.name)))
	.sort();
const fixtures = files.filter((file) => !file.endsWith(SUFFIX));
const expectations = files.filter((file) => file.endsWith(SUFFIX));

describe("fixture corpus", () => {
	it("has fixtures", () => {
		expect(fixtures.length).toBeGreaterThan(20);
	});

	it("gives every fixture an expectation and every expectation a fixture", () => {
		const expected = new Set(
			expectations.map((file) => file.slice(0, -SUFFIX.length)),
		);
		expect(fixtures.filter((file) => !expected.has(file))).toEqual([]);
		expect([...expected].filter((file) => !fixtures.includes(file))).toEqual(
			[],
		);
	});

	for (const file of fixtures) {
		const expected = JSON.parse(
			readFileSync(join(root, file + SUFFIX), "utf8"),
		) as Expectation;
		const run = expected.skip ? it.skip : it;
		run(
			`${file}${expected.skip ? ` (skipped: ${expected.skip})` : ""}`,
			async () => {
				const bytes = new Uint8Array(readFileSync(join(root, file)));
				const name = file.split("/").pop() ?? file;
				const outcome = await parse(bytes, name, expected.hints);
				if (expected.outcome === "error") {
					expectError(outcome, expected.reason as never);
					return;
				}
				const result = expectSuccess(outcome);
				expect(result.format).toBe(expected.format);
				expect(result.title).toBe(expected.title);
				expect(result.encoding).toBe(expected.encoding);
				expect(result.language.code).toBe(expected.language);
				const blocks = result.document.blocks;
				expect(blocks).toHaveLength(expected.blocks ?? -1);
				if (expected.kinds)
					expect(blocks.map((b) => b.kind)).toEqual(expected.kinds);
				if (expected.spans !== undefined) {
					const count = blocks.reduce(
						(n, b) => n + (b.kind === "image-placeholder" ? 0 : b.spans.length),
						0,
					);
					expect(count).toBe(expected.spans);
				}
				const joined = blocks
					.map((b) => (b.kind === "image-placeholder" ? b.alt : b.text))
					.join("\n");
				expect(joined.startsWith(expected.first ?? "\u0000")).toBe(true);
				expect(joined.endsWith(expected.last ?? "\u0000")).toBe(true);
				const words = joined.split(/\s+/).filter(Boolean).length;
				expect(words).toBeGreaterThanOrEqual(
					expected.words?.[0] ?? Number.POSITIVE_INFINITY,
				);
				expect(words).toBeLessThanOrEqual(
					expected.words?.[1] ?? Number.NEGATIVE_INFINITY,
				);
			},
		);
	}
});
