import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	ARTICLES,
	articleSources,
	HUB,
	READING_SPEED,
} from "../src/lib/learn/articles.ts";
import { SOURCES } from "../src/lib/learn/sources.ts";
import { PUBLIC_PAGES } from "../src/lib/seo/pages.ts";

const messages = JSON.parse(
	readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"),
) as Record<string, string>;

type Article = (typeof ARTICLES)[number];

const slugs = ARTICLES.map((article) => article.slug);
const article = (slug: string): Article => {
	const found = ARTICLES.find((item) => item.slug === slug);
	if (!found) throw new Error(`no article ${slug}`);
	return found;
};
const text = (key: string): string => {
	const value = messages[key];
	if (!value) throw new Error(`missing message ${key}`);
	return value;
};
const blocksOf = (item: Article) =>
	item.sections.flatMap((section) => section.blocks);
/** Every message of one page, by key prefix. */
const copyOf = (prefix: string): [string, string][] =>
	Object.entries(messages).filter(([key]) => key.startsWith(`${prefix}_`));
const joined = (prefix: string): string =>
	copyOf(prefix)
		.map(([, value]) => value)
		.join("\n");
const allLearnCopy = (): [string, string][] => copyOf("learn");
/** The digits in a text: "18,573" is one number, "500–750" is two. */
const numbersIn = (value: string): string[] =>
	(value.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,$/, ""));

describe("the /learn registry", () => {
	it("has the hub and the three articles, in the route table of ticket 34", () => {
		expect(HUB.path).toBe("/learn");
		expect(slugs).toEqual([
			"how-to-read-faster",
			"what-is-rsvp",
			"average-reading-speed",
		]);
		for (const item of ARTICLES) {
			expect(item.path).toBe(`/learn/${item.slug}`);
		}
	});

	it("lists all four pages for the sitemap, each once, with a real lastmod", () => {
		const paths = PUBLIC_PAGES.map((page) => page.path);
		for (const path of [HUB.path, ...ARTICLES.map((item) => item.path)]) {
			expect(paths.filter((p) => p === path)).toHaveLength(1);
		}
		const today = new Date().toISOString().slice(0, 10);
		for (const page of PUBLIC_PAGES.filter((p) =>
			p.path.startsWith("/learn"),
		)) {
			expect(page.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(page.lastmod <= today).toBe(true);
		}
	});
});

describe("titles and descriptions", () => {
	it("uses the ticket 34 title for the hub", () => {
		expect(messages[`${HUB.prefix}_title`]).toBe(
			"Learn: Reading Speed, Backed by Research | Speeedy",
		);
	});

	const pages = [
		{ name: "hub", prefix: HUB.prefix },
		...ARTICLES.map((item) => ({ name: item.slug, prefix: item.prefix })),
	];

	for (const page of pages) {
		it(`${page.name}: title within 60 characters and ends with the brand`, () => {
			const title = text(`${page.prefix}_title`);
			expect(title.length).toBeLessThanOrEqual(60);
			expect(title.endsWith(" | Speeedy")).toBe(true);
		});

		it(`${page.name}: description within 155 characters`, () => {
			const description = text(`${page.prefix}_description`);
			expect(description.length).toBeGreaterThan(60);
			expect(description.length).toBeLessThanOrEqual(155);
		});
	}

	it("gives every page its own title and description", () => {
		const titles = pages.map((page) => text(`${page.prefix}_title`));
		const descriptions = pages.map((page) =>
			text(`${page.prefix}_description`),
		);
		expect(new Set(titles).size).toBe(pages.length);
		expect(new Set(descriptions).size).toBe(pages.length);
	});

	it("puts the 238 figure in the average-reading-speed title", () => {
		expect(text("learn_avg_title")).toContain("238");
	});
});

describe("every claim cites a source from the reading-science research note", () => {
	it("has a message behind every key the articles use", () => {
		for (const item of ARTICLES) {
			for (const key of [
				`${item.prefix}_headline`,
				`${item.prefix}_lead`,
				`${item.prefix}_summary`,
			]) {
				expect(messages[key], key).toBeTruthy();
			}
			for (const section of item.sections) {
				expect(messages[section.titleKey], section.titleKey).toBeTruthy();
				for (const block of section.blocks) {
					const key = block.kind === "chart" ? block.captionKey : block.key;
					expect(messages[key], key).toBeTruthy();
					if (block.kind === "frame" && block.link) {
						expect(
							messages[block.link.labelKey],
							block.link.labelKey,
						).toBeTruthy();
					}
				}
			}
		}
	});

	it("leaves no message of an article unused", () => {
		for (const item of ARTICLES) {
			const used = new Set<string>(
				["title", "description", "headline", "lead", "summary"].map(
					(part) => `${item.prefix}_${part}`,
				),
			);
			for (const section of item.sections) {
				used.add(section.titleKey);
				for (const block of section.blocks) {
					used.add(block.kind === "chart" ? block.captionKey : block.key);
					if (block.kind === "frame" && block.link)
						used.add(block.link.labelKey);
				}
			}
			const hasChart = blocksOf(item).some((block) => block.kind === "chart");
			for (const [key] of copyOf(item.prefix)) {
				// A chart's own labels live under `<prefix>_chart_`.
				const chartLabel = hasChart && key.startsWith(`${item.prefix}_chart_`);
				expect(
					used.has(key) || chartLabel,
					`${key} is not used by ${item.slug}`,
				).toBe(true);
			}
		}
	});

	for (const item of ARTICLES) {
		describe(item.slug, () => {
			const claims = blocksOf(item).flatMap((block) =>
				block.kind === "claim"
					? [{ key: block.key, cite: block.cite }]
					: block.kind === "chart"
						? [{ key: block.captionKey, cite: block.cite }]
						: [],
			);

			it("has claims, and each cites at least one known source, once", () => {
				expect(claims.length).toBeGreaterThanOrEqual(4);
				for (const claim of claims) {
					expect(claim.cite.length, claim.key).toBeGreaterThan(0);
					expect(new Set(claim.cite).size, claim.key).toBe(claim.cite.length);
					for (const id of claim.cite) expect(SOURCES[id], id).toBeTruthy();
				}
			});

			it("states only numbers that its cited sources give", () => {
				for (const claim of claims) {
					const allowed = new Set<string>();
					for (const id of claim.cite) {
						for (const figure of SOURCES[id].figures) allowed.add(figure);
						allowed.add(String(SOURCES[id].year));
					}
					for (const number of numbersIn(text(claim.key))) {
						expect(
							allowed.has(number),
							`${claim.key}: "${number}" is not a figure of ${claim.cite.join(", ")}`,
						).toBe(true);
					}
				}
			});

			it("keeps framing text free of findings and numbers", () => {
				const framing = [
					text(`${item.prefix}_lead`),
					text(`${item.prefix}_summary`),
					...blocksOf(item).flatMap((block) =>
						block.kind === "frame" ? [text(block.key)] : [],
					),
				];
				for (const value of framing) {
					expect(value).not.toMatch(/\d/);
					expect(value).not.toMatch(
						/\b(stud(y|ies)|found|finding|trial|percent)\b|%/i,
					);
				}
			});

			it("lists exactly the sources its claims cite, in order of first use", () => {
				const order: string[] = [];
				for (const claim of claims) {
					for (const id of claim.cite) if (!order.includes(id)) order.push(id);
				}
				expect(articleSources(item)).toEqual(order);
			});
		});
	}

	it("each article rests on the sources the ticket names", () => {
		expect(articleSources(article("how-to-read-faster"))).toEqual(
			expect.arrayContaining(["rayner2016", "schotter2014"]),
		);
		expect(articleSources(article("what-is-rsvp"))).toEqual(
			expect.arrayContaining([
				"rayner2016",
				"benedetto2015",
				"oregan1992",
				"rayner1998",
				"primativo2016",
			]),
		);
		expect(articleSources(article("average-reading-speed"))).toEqual(
			expect.arrayContaining(["brysbaert2019"]),
		);
	});
});

describe("the sources", () => {
	// The DOIs of reading-science.md, which resolved against Crossref on 2026-10-19.
	const DOIS: Record<string, string> = {
		rayner2016: "10.1177/1529100615623267",
		brysbaert2019: "10.1016/j.jml.2019.104047",
		rubin1992: "10.1016/0042-6989(92)90032-E",
		primativo2016: "10.1371/journal.pone.0153786",
		benedetto2015: "10.1016/j.chb.2014.12.043",
		ricciardi2017: "10.1016/j.chb.2016.12.047",
		oquist2003: "10.1016/S0953-5438(03)00039-0",
		masson1983: "10.3758/BF03196973",
		schotter2014: "10.1177/0956797614531148",
		oregan1992: "10.1037/0096-1523.18.1.185",
		rayner1998: "10.1037/0033-2909.124.3.372",
		snell2024: "10.1016/j.actpsy.2024.104304",
		parker2026: "10.1098/rsos.250177",
		moussaoui2025: "10.1017/S1355617725101628",
		breznitz2013: "10.1038/ncomms2488",
	};

	it("carries the DOI the note gives for each", () => {
		for (const [id, doi] of Object.entries(DOIS)) {
			expect(SOURCES[id as keyof typeof SOURCES].doi, id).toBe(doi);
		}
		expect(Object.keys(SOURCES).sort()).toEqual(Object.keys(DOIS).sort());
	});

	it("names the author and the year in each citation", () => {
		for (const source of Object.values(SOURCES)) {
			expect(source.citation).toContain(String(source.year));
			expect(source.citation).toContain(source.short.split(" ")[0] as string);
			expect(source.citation.length).toBeGreaterThan(40);
		}
	});

	it("says where the note read only an abstract, highlights or a summary", () => {
		expect(SOURCES.benedetto2015.access).toBe("abstract");
		expect(SOURCES.ricciardi2017.access).toBe("highlights");
		expect(SOURCES.masson1983.access).toBe("review");
	});

	it("holds no source that no article cites", () => {
		const cited = new Set<string>(
			ARTICLES.flatMap((item) => articleSources(item)),
		);
		for (const id of Object.keys(SOURCES)) {
			expect(cited.has(id), `${id} is never cited`).toBe(true);
		}
	});
});

describe("the copy rules, on every /learn page", () => {
	it("promises no speed multiplier and nothing 'best'", () => {
		for (const [key, value] of allLearnCopy()) {
			expect(value, key).not.toMatch(/\bbest\b/i);
			expect(value, key).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
			expect(value, key).not.toMatch(/\b(guarantee[sd]?|proven|miracle)\b/i);
			if (/\b(double|triple|twice)\b/i.test(value)) {
				// Only the review's own conclusion may use the words, and only as a doubt.
				expect(value, key).toMatch(/“unlikely”/);
			}
		}
	});

	it("puts no file path or code in its text", () => {
		for (const [key, value] of allLearnCopy()) {
			if (key.endsWith("_title") || key.endsWith("_description")) continue;
			expect(value, key).not.toMatch(/\.(ts|svelte|json|js)\b|\bsrc\/|`/);
		}
	});

	it("keeps ADHD, dyslexia and Bionic claims inside the research", () => {
		for (const item of ARTICLES) {
			for (const block of blocksOf(item)) {
				if (block.kind !== "claim") continue;
				const value = text(block.key);
				if (/ADHD/.test(value)) {
					expect(block.cite, block.key).toContain("moussaoui2025");
					expect(value, block.key).toMatch(
						/initial step|not statistically significant/,
					);
				}
				if (/dyslex/i.test(value)) {
					expect(block.cite, block.key).toContain("breznitz2013");
				}
				if (/bionic/i.test(value)) {
					expect(
						block.cite.some((id) => id === "snell2024" || id === "parker2026"),
						block.key,
					).toBe(true);
				}
			}
		}
		for (const [key, value] of allLearnCopy()) {
			expect(value, key).not.toMatch(/\b(cure|cures|treats|heals|therapy)\b/i);
			expect(value, key).not.toMatch(/font|overlay|irlen/i);
		}
	});

	it("repeats none of the 1.x thresholds the research rejects", () => {
		for (const [key, value] of allLearnCopy()) {
			expect(value, key).not.toMatch(/\b(400|450|500)\+|400–450|300–500/);
			expect(value, key).not.toMatch(/bottleneck is (your )?eyes/i);
		}
	});
});

describe("the RSVP article", () => {
	const copy = joined("learn_rsvp");

	it("carries the Rayner 2016 caveat, in the review's own word, before anything in RSVP's favour", () => {
		expect(copy).toContain("Rayner");
		expect(copy).toContain("2016");
		expect(copy).toContain("“unlikely”");
		const first = blocksOf(article("what-is-rsvp")).find(
			(block) => block.kind === "claim",
		);
		expect(first?.kind === "claim" && first.cite).toContain("rayner2016");
	});

	it("names the ADHD study's limits next to its result", () => {
		expect(copy).toContain("Moussaoui");
		expect(copy).toMatch(/initial step/);
	});

	it("says nobody has shown that ORP alignment helps comprehension in RSVP", () => {
		expect(copy).toMatch(/Nobody has shown/);
	});
});

describe("the average-reading-speed article", () => {
	const copy = joined("learn_avg");

	it("gives Brysbaert's figures", () => {
		expect(READING_SPEED).toEqual({
			nonFiction: 238,
			fiction: 260,
			rangeLow: 175,
			rangeHigh: 300,
		});
		for (const figure of ["238", "260", "190", "18,573", "175", "300"]) {
			expect(copy).toContain(figure);
		}
		expect(copy).toContain("Brysbaert");
	});

	it("has the chart as one illustration with a cited caption", () => {
		const charts = blocksOf(article("average-reading-speed")).filter(
			(block) => block.kind === "chart",
		);
		expect(charts).toHaveLength(1);
		const chart = charts[0];
		expect(chart?.kind === "chart" && chart.cite).toEqual(["brysbaert2019"]);
	});
});

describe("no 1.x Learn copy carries over", () => {
	// Sentences from the 1.x Learn page (src/components/learn-page.ts on main). No run of
	// six words from any of them may appear in the 2.0 pages.
	const OLD = [
		"The average adult reads at about 238 WPM. With RSVP practice, many readers reach 400 or more WPM.",
		"Comprehension drops for most people above about 450 WPM.",
		"Here is how it works and what the research shows.",
		"The real bottleneck is your eyes, not your brain",
		"When you read a line of text, your eyes don't glide smoothly. They jump 3–4 times per line in rapid bursts called saccades.",
		"During each saccade you read nothing, it's pure motor overhead.",
		"The brain itself can process language significantly faster than 238 WPM. The bottleneck is the eye movement pipeline, not cognition.",
		"Speed reading techniques target that pipeline.",
		"One word. One fixed point. No eye movement.",
		"Studies show RSVP readers can reach 300–500+ WPM with comprehension similar to normal reading.",
		"Above about 450 WPM, comprehension drops for most readers.",
		"It's less suited for reference material where you need to jump around or skim headings.",
		"Speed is usually how RSVP gets marketed, but it's not always the main benefit.",
		"Comfort and comprehension are different measures. Both matter.",
		"Your baseline WPM matters more than the comparison.",
		"The goal is to comfortably absorb more in less time, not to hit an arbitrary number.",
		"The honest answer is: it depends on speed.",
		"Most readers keep good comprehension up to about 400–450 WPM with pausing. Beyond that, expect some trade-off.",
		"A note on subvocalization: the inner voice is often described as a habit to eliminate.",
		"Research suggests it's actually useful for complex text, helping you hold syntax in working memory.",
		"Some readers find it helpful at high speeds. Try it and see.",
		"The feature is there as an option, not a promise.",
		"Set the reader to a speed that feels slightly uncomfortable, not painful. Your brain adapts in a few sessions.",
		"Starting too fast leads to frustration and poor comprehension.",
		"Turn on sentence and comma pauses. That gives working memory the consolidation window it needs, especially for complex or technical text.",
		"Before guessing your WPM, take a proper reading test.",
		"Short daily sessions work better than occasional long ones.",
		"builds the pattern recognition your brain uses to process words faster.",
		"Show 1–3 context words before and after the current word, dimmed.",
		"The theory is that your brain uses the bolded anchors to predict and fill in the rest of the word faster.",
		"Some readers find the fixed focal point easier to sustain than scanning across lines, regardless of speed.",
	];
	const words = (value: string) =>
		value
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter(Boolean);
	const runs = (value: string, size = 6): string[] => {
		const w = words(value);
		const out: string[] = [];
		for (let i = 0; i + size <= w.length; i++)
			out.push(w.slice(i, i + size).join(" "));
		return out;
	};

	it("shares no six-word run with the 1.x page", () => {
		const copy = allLearnCopy()
			.map(([, value]) => words(value).join(" "))
			.join(" ¶ ");
		for (const sentence of OLD) {
			for (const run of runs(sentence)) {
				expect(copy, `1.x run: "${run}"`).not.toContain(run);
			}
		}
	});
});
