import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTICLES, READING_SPEED } from "../src/lib/learn/articles.ts";
import { PUBLIC_PAGES } from "../src/lib/seo/pages.ts";

const messages = JSON.parse(
	readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"),
) as Record<string, string>;

const copy = Object.entries(messages).filter(([key]) =>
	key.startsWith("benchmark_"),
);
const text = copy.map(([, value]) => value).join("\n");

describe("/reading-speed-test: title, description and the sitemap", () => {
	it("uses the ticket 34 title, within 60 characters", () => {
		expect(messages.benchmark_title).toBe(
			"Reading Speed Test with Comprehension, Free | Speeedy",
		);
		expect((messages.benchmark_title ?? "").length).toBeLessThanOrEqual(60);
	});

	it("uses the ticket 34 description, within 155 characters", () => {
		expect(messages.benchmark_description).toBe(
			"Find your reading speed in WPM, then answer a few questions to check what you understood. Free, no account, and your results stay on your device.",
		);
		expect((messages.benchmark_description ?? "").length).toBeLessThanOrEqual(
			155,
		);
	});

	it("is in the sitemap once", () => {
		const paths = PUBLIC_PAGES.map((page) => page.path);
		expect(paths.filter((path) => path === "/reading-speed-test")).toHaveLength(
			1,
		);
	});
});

describe("/reading-speed-test: what the page says", () => {
	it("states the adult average and range, from Brysbaert (2019)", () => {
		expect(text).toContain(String(READING_SPEED.nonFiction));
		expect(text).toContain(String(READING_SPEED.rangeLow));
		expect(text).toContain(String(READING_SPEED.rangeHigh));
		expect(text).toContain("Brysbaert");
		expect(text).toMatch(/non-fiction/);
	});

	it("says the test is a rough screen", () => {
		expect(text).toMatch(/rough screen/);
	});

	it("keeps results on the device, with no account and no limit", () => {
		expect(text).toMatch(/on this device/);
		expect(text).toMatch(/no account/i);
		expect(text).toMatch(/no limit|unlimited/i);
	});

	it("makes no promise about getting faster and calls nothing the best", () => {
		for (const [key, value] of copy) {
			expect(value, key).not.toMatch(/\bbest\b/i);
			expect(value, key).not.toMatch(/\bfaster\b/i);
			expect(value, key).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
		}
	});

	it("does not copy the 1.x claim about an RSVP-trained ceiling", () => {
		expect(text).not.toMatch(/600/);
		expect(text).not.toMatch(/ceiling|excellent/i);
	});
});

describe("the average-reading-speed article", () => {
	it("links to the test, in a frame paragraph with no figures", () => {
		const article = ARTICLES.find((a) => a.slug === "average-reading-speed");
		const blocks = article?.sections.flatMap((section) => section.blocks) ?? [];
		const link = blocks.find(
			(block) =>
				block.kind === "frame" && block.link?.href === "/reading-speed-test",
		);
		expect(link).toBeDefined();
	});
});
