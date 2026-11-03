/**
 * Tuning record for the saved-page paragraph filter (ticket #22).
 *
 * `tuning/html-pages.json` holds, for every real saved page under `fixtures/html/`, the
 * article blocks a reader should get (the truth), where each page came from, and what the
 * filter kept at the two candidate link-density thresholds (0.5 and 0.8). This test re-runs
 * the filter and fails if the numbers drift, so a later change to the filter has to update
 * the record on purpose. It also pins the threshold the parser ships with to the one the
 * data picked.
 *
 * Method: a block in the output matches a truth block by the first 60 characters of its
 * whitespace-collapsed text. Recall is the truth blocks present. Noise is the output blocks
 * (not code, images, table rows or the h1) whose text appears nowhere in the article container.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Block, blockText } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import { htmlToBlocks, LINK_DENSITY_MAX } from "../src/html";
import { BlockSink } from "../src/types";

type Measure = { kept: number; recall: number; noise: number };
type Page = {
	url: string;
	license: string;
	truth: string[];
	container: string[];
	results: Record<string, Measure>;
};
type Control = { results: Record<string, { kept: number }> };
type Tuning = {
	thresholds: number[];
	chosen: number;
	pages: Record<string, Page>;
	controls: Record<string, Control>;
};

const tuning = JSON.parse(
	readFileSync(join(import.meta.dirname, "tuning/html-pages.json"), "utf8"),
) as Tuning;

const key = (text: string): string =>
	text.replace(/\s+/g, " ").trim().slice(0, 60);

function filtered(file: string, linkDensity: number): Block[] {
	const html = readFileSync(
		join(import.meta.dirname, "fixtures/html", file),
		"utf8",
	);
	const sink = new BlockSink(1_000_000);
	htmlToBlocks(html, sink, { linkDensity });
	return sink.blocks;
}

function measure(file: string, page: Page, linkDensity: number): Measure {
	const blocks = filtered(file, linkDensity);
	const present = new Set(blocks.map((block) => key(blockText(block))));
	const container = new Set(page.container);
	const noise = blocks.filter(
		(block) =>
			!container.has(key(blockText(block))) &&
			block.kind !== "code" &&
			block.kind !== "image-placeholder" &&
			block.kind !== "table-text" &&
			!(block.kind === "heading" && block.level === 1),
	);
	return {
		kept: blocks.length,
		recall: page.truth.filter((entry) => present.has(entry)).length,
		noise: noise.length,
	};
}

describe("saved-page paragraph filter: tuning record", () => {
	const files = Object.keys(tuning.pages);

	it("was tuned on at least five real saved pages with a known source", () => {
		expect(files.length).toBeGreaterThanOrEqual(5);
		for (const file of files) {
			const page = tuning.pages[file] as Page;
			expect(page.url).toMatch(/^https:\/\//);
			expect(page.license.length).toBeGreaterThan(0);
			expect(page.truth.length).toBeGreaterThan(5);
		}
	});

	it("ships the threshold the data picked, out of the two candidates", () => {
		expect(tuning.thresholds).toEqual([0.5, 0.8]);
		expect(tuning.thresholds).toContain(tuning.chosen);
		expect(LINK_DENSITY_MAX).toBe(tuning.chosen);
	});

	for (const file of files) {
		it(`${file}: the recorded numbers still hold at both thresholds`, () => {
			const page = tuning.pages[file] as Page;
			for (const threshold of tuning.thresholds) {
				expect(measure(file, page, threshold)).toEqual(
					page.results[String(threshold)],
				);
			}
		});
	}

	it("the chosen threshold keeps at least as much of every article, with no extra noise", () => {
		for (const file of files) {
			const page = tuning.pages[file] as Page;
			const other = page.results["0.5"] as Measure;
			const chosen = page.results[String(tuning.chosen)] as Measure;
			expect(chosen.recall, file).toBeGreaterThanOrEqual(other.recall);
			expect(chosen.noise, file).toBeLessThanOrEqual(other.noise);
		}
	});

	it("keeps nearly all of the article text across the corpus", () => {
		let truth = 0;
		let recall = 0;
		let noise = 0;
		let kept = 0;
		for (const file of files) {
			const page = tuning.pages[file] as Page;
			const result = page.results[String(tuning.chosen)] as Measure;
			truth += page.truth.length;
			recall += result.recall;
			noise += result.noise;
			kept += result.kept;
		}
		expect(recall / truth).toBeGreaterThan(0.93);
		expect(noise / kept).toBeLessThan(0.03);
	});

	it("a page of links with no article stays small at the chosen threshold", () => {
		for (const [file, control] of Object.entries(tuning.controls)) {
			for (const threshold of tuning.thresholds) {
				expect(filtered(file, threshold).length).toBe(
					control.results[String(threshold)]?.kept,
				);
			}
		}
	});
});
