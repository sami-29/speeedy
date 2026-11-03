import type { SourceId } from "./sources.ts";

/**
 * The structure of the /learn pages. The words live in messages/en.json; this module says
 * which message goes where and which sources stand behind it. A paragraph that states
 * something the research found is a `claim` and must name at least one source. A `frame`
 * paragraph only introduces or links: the unit tests keep numbers and findings out of it.
 */

export type Block =
	| { kind: "claim"; key: string; cite: readonly SourceId[] }
	| {
			kind: "frame";
			key: string;
			link?: { href: string; labelKey: string };
	  }
	| { kind: "chart"; captionKey: string; cite: readonly SourceId[] };

export type Section = { titleKey: string; blocks: readonly Block[] };

export type Article = {
	slug: "how-to-read-faster" | "what-is-rsvp" | "average-reading-speed";
	path: `/learn/${string}`;
	/** Message key prefix: `<prefix>_title`, `_description`, `_headline`, `_lead`, `_summary`. */
	prefix: string;
	sections: readonly Section[];
};

export const HUB = { path: "/learn", prefix: "learn_hub" } as const;

/** Brysbaert (2019), in words per minute, for English adults reading silently. */
export const READING_SPEED = {
	nonFiction: 238,
	fiction: 260,
	rangeLow: 175,
	rangeHigh: 300,
} as const;

export const ARTICLES: readonly Article[] = [
	{
		slug: "how-to-read-faster",
		path: "/learn/how-to-read-faster",
		prefix: "learn_faster",
		sections: [
			{
				titleKey: "learn_faster_tradeoff_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_faster_tradeoff_review",
						cite: ["rayner2016"],
					},
					{
						kind: "claim",
						key: "learn_faster_tradeoff_skill",
						cite: ["rayner2016"],
					},
				],
			},
			{
				titleKey: "learn_faster_lookback_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_faster_lookback_mask",
						cite: ["schotter2014"],
					},
					{
						kind: "claim",
						key: "learn_faster_lookback_repair",
						cite: ["schotter2014"],
					},
					{ kind: "frame", key: "learn_faster_lookback_rewind" },
				],
			},
			{
				titleKey: "learn_faster_training_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_faster_training_pressure",
						cite: ["breznitz2013"],
					},
					{
						kind: "claim",
						key: "learn_faster_training_modest",
						cite: ["rayner2016"],
					},
				],
			},
			{
				titleKey: "learn_faster_skimming_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_faster_skimming_cost",
						cite: ["masson1983", "rayner2016"],
					},
					{
						kind: "frame",
						key: "learn_faster_skimming_rsvp",
						link: {
							href: "/learn/what-is-rsvp",
							labelKey: "learn_faster_skimming_rsvp_link",
						},
					},
				],
			},
			{
				titleKey: "learn_faster_bionic_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_faster_bionic_snell",
						cite: ["snell2024"],
					},
					{
						kind: "claim",
						key: "learn_faster_bionic_parker",
						cite: ["parker2026"],
					},
				],
			},
		],
	},
	{
		slug: "what-is-rsvp",
		path: "/learn/what-is-rsvp",
		prefix: "learn_rsvp",
		sections: [
			{
				titleKey: "learn_rsvp_caveat_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_rsvp_caveat_review",
						cite: ["rayner2016"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_caveat_skill",
						cite: ["rayner2016"],
					},
				],
			},
			{
				titleKey: "learn_rsvp_removes_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_rsvp_removes_lookback",
						cite: ["schotter2014"],
					},
					{
						kind: "frame",
						key: "learn_rsvp_removes_more",
						link: {
							href: "/learn/how-to-read-faster",
							labelKey: "learn_rsvp_removes_more_link",
						},
					},
				],
			},
			{
				titleKey: "learn_rsvp_holds_title",
				blocks: [
					{ kind: "claim", key: "learn_rsvp_holds_rubin", cite: ["rubin1992"] },
					{
						kind: "claim",
						key: "learn_rsvp_holds_rubin_caveat",
						cite: ["rubin1992"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_holds_oquist",
						cite: ["oquist2003"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_holds_adaptive",
						cite: ["oquist2003"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_holds_adhd",
						cite: ["moussaoui2025"],
					},
					{
						kind: "frame",
						key: "learn_rsvp_holds_adhd_more",
						link: {
							href: "/adhd-reading-tool",
							labelKey: "learn_rsvp_holds_adhd_link",
						},
					},
				],
			},
			{
				titleKey: "learn_rsvp_costs_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_rsvp_costs_spritz",
						cite: ["benedetto2015"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_costs_reply",
						cite: ["ricciardi2017"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_costs_long",
						cite: ["oquist2003"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_costs_rates",
						cite: ["primativo2016"],
					},
				],
			},
			{
				titleKey: "learn_rsvp_orp_title",
				blocks: [
					{ kind: "claim", key: "learn_rsvp_orp_ovp", cite: ["oregan1992"] },
					{ kind: "frame", key: "learn_rsvp_orp_speeedy" },
					{
						kind: "claim",
						key: "learn_rsvp_orp_saccades",
						cite: ["rayner1998"],
					},
					{
						kind: "claim",
						key: "learn_rsvp_orp_untested",
						cite: ["benedetto2015"],
					},
				],
			},
			{
				titleKey: "learn_rsvp_use_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_rsvp_use_summary",
						cite: ["oquist2003", "ricciardi2017"],
					},
					{
						kind: "frame",
						key: "learn_rsvp_use_try",
						link: { href: "/", labelKey: "learn_rsvp_use_try_link" },
					},
				],
			},
		],
	},
	{
		slug: "average-reading-speed",
		path: "/learn/average-reading-speed",
		prefix: "learn_avg",
		sections: [
			{
				titleKey: "learn_avg_average_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_avg_average_figures",
						cite: ["brysbaert2019"],
					},
					{
						kind: "chart",
						captionKey: "learn_avg_chart_caption",
						cite: ["brysbaert2019"],
					},
				],
			},
			{
				titleKey: "learn_avg_range_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_avg_range_spread",
						cite: ["brysbaert2019"],
					},
				],
			},
			{
				titleKey: "learn_avg_differ_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_avg_differ_rates",
						cite: ["primativo2016"],
					},
					{
						kind: "claim",
						key: "learn_avg_differ_task",
						cite: ["rubin1992"],
					},
				],
			},
			{
				titleKey: "learn_avg_half_title",
				blocks: [
					{
						kind: "claim",
						key: "learn_avg_half_tradeoff",
						cite: ["rayner2016"],
					},
					{
						kind: "frame",
						key: "learn_avg_half_more",
						link: {
							href: "/learn/how-to-read-faster",
							labelKey: "learn_avg_half_more_link",
						},
					},
				],
			},
		],
	},
];

export function getArticle(slug: Article["slug"]): Article {
	const found = ARTICLES.find((article) => article.slug === slug);
	if (!found) throw new Error(`No article "${slug}"`);
	return found;
}

/**
 * The sources an article cites, in the order it first cites them. A source's number in the
 * text and in the reference list is its place here plus one.
 */
export function articleSources(article: Article): SourceId[] {
	const order: SourceId[] = [];
	for (const section of article.sections) {
		for (const block of section.blocks) {
			if (block.kind === "frame") continue;
			for (const id of block.cite) if (!order.includes(id)) order.push(id);
		}
	}
	return order;
}
