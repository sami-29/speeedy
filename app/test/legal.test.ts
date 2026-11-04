import { readFileSync } from "node:fs";
import { EVENTS, eventList, renderEventListMarkdown } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	eventListDocument,
	inlineParts,
	publishedEventList,
} from "../src/lib/legal/event-list.ts";
import { plusFigures } from "../src/lib/legal/figures.ts";
import { LAWYER_REVIEW_PENDING } from "../src/lib/legal/status.ts";
import {
	PLAY_ROWS,
	PROCESSORS,
	RETENTION_ROWS,
} from "../src/lib/legal/tables.ts";
import { PUBLIC_PAGES } from "../src/lib/seo/pages.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string): string =>
	readFileSync(new URL(path, root), "utf8");

const messages = JSON.parse(read("app/messages/en.json")) as Record<
	string,
	string
>;
const text = (key: string): string => {
	const value = messages[key];
	if (!value) throw new Error(`missing message ${key}`);
	return value;
};
const copyOf = (prefix: string): [string, string][] =>
	Object.entries(messages).filter(([key]) => key.startsWith(`${prefix}_`));
const joined = (prefix: string): string =>
	copyOf(prefix)
		.map(([, value]) => value)
		.join("\n");
const legalCopy = (): [string, string][] => [
	...copyOf("legal"),
	...copyOf("privacy"),
	...copyOf("terms"),
	...copyOf("events"),
];

const PAGES = [
	{ prefix: "privacy", path: "/privacy" },
	{ prefix: "terms", path: "/terms" },
	{ prefix: "events", path: "/privacy/events" },
] as const;

describe("the pages are in the sitemap registry", () => {
	it("lists /privacy, /terms and the event list once each, with a real lastmod", () => {
		const today = new Date().toISOString().slice(0, 10);
		for (const page of PAGES) {
			const found = PUBLIC_PAGES.filter((p) => p.path === page.path);
			expect(found, page.path).toHaveLength(1);
			expect(found[0]?.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect((found[0]?.lastmod ?? "") <= today).toBe(true);
		}
	});
});

describe("titles and descriptions", () => {
	for (const page of PAGES) {
		it(`${page.path}: title within 60 characters and ends with the brand`, () => {
			const title = text(`${page.prefix}_title`);
			expect(title.length).toBeLessThanOrEqual(60);
			expect(title.endsWith(" | Speeedy")).toBe(true);
		});

		it(`${page.path}: description within 155 characters`, () => {
			const description = text(`${page.prefix}_description`);
			expect(description.length).toBeGreaterThan(40);
			expect(description.length).toBeLessThanOrEqual(155);
		});
	}

	it("uses plain names for the two legal pages, as the route table says", () => {
		expect(text("privacy_title")).toBe("Privacy Policy | Speeedy");
		expect(text("terms_title")).toBe("Terms of Service | Speeedy");
	});

	it("gives every page its own title and description", () => {
		const titles = PAGES.map((p) => text(`${p.prefix}_title`));
		const descriptions = PAGES.map((p) => text(`${p.prefix}_description`));
		expect(new Set(titles).size).toBe(PAGES.length);
		expect(new Set(descriptions).size).toBe(PAGES.length);
	});
});

describe("awaiting lawyer review", () => {
	it("is marked until the go-live gate", () => {
		expect(LAWYER_REVIEW_PENDING).toBe(true);
	});

	it("says so in words a reader can read", () => {
		expect(text("legal_status")).toMatch(/awaiting lawyer review/i);
	});
});

describe("copy rules for the legal pages", () => {
	it("never says 'best' or promises a speed multiplier", () => {
		for (const [key, value] of legalCopy()) {
			expect(value, key).not.toMatch(/\bbest\b/i);
			expect(value, key).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
		}
	});

	it("never says 'no tracking' or 'no data collection' (ticket 34, rule 6)", () => {
		for (const [key, value] of legalCopy()) {
			expect(value, key).not.toMatch(/\bno (data collection|tracking)\b/i);
			expect(value, key).not.toMatch(/\bwe (do not|don't) (track|collect)\b/i);
		}
	});

	it("does not name Umami as a processor (1.x only, gone at cutover)", () => {
		for (const [key, value] of legalCopy()) {
			expect(value, key).not.toMatch(/umami/i);
		}
	});

	it("has no empty message and no leftover placeholder", () => {
		for (const [key, value] of legalCopy()) {
			expect(value.trim(), key).not.toBe("");
			expect(value, key).not.toMatch(/\b(TODO|TBD|lorem)\b/i);
		}
	});
});

describe("the privacy policy follows the ticket 56 draft, amended by ticket 43", () => {
	const privacy = joined("privacy");

	it("opens with the short version, word for word", () => {
		expect(text("privacy_short")).toBe(
			"Speeedy reads your documents on your device. Nothing you read leaves it unless you turn on a Plus feature that needs our servers, and we ask first. No ad trackers, no sale of your data, no account to read.",
		);
	});

	it("names the controller and the contact", () => {
		expect(privacy).toContain("SamDev LLC");
		expect(privacy).toContain("privacy@speeedy.app");
	});

	it("says PostHog is in the US and never puts analytics in the EU", () => {
		const analytics = joined("privacy_analytics");
		expect(analytics).toMatch(/PostHog/);
		expect(text("privacy_proc_posthog_where")).toMatch(/\bUS\b|United States/);
		for (const [key, value] of copyOf("privacy")) {
			if (/posthog|analytics/i.test(key) || /PostHog/.test(value)) {
				expect(value, key).not.toMatch(/PostHog[^.]*\bin the EU\b/);
				expect(value, key).not.toMatch(/\bEU\b[^.]*PostHog/);
			}
		}
	});

	it("sends feedback and survey answers to PostHog, not D1 (ticket 43)", () => {
		const analytics = joined("privacy_analytics");
		expect(analytics).toMatch(/feedback/i);
		expect(analytics).toMatch(/survey/i);
		const cloudflare = text("privacy_proc_cloudflare_data");
		expect(cloudflare).not.toMatch(/feedback/i);
		const posthog = text("privacy_proc_posthog_data");
		expect(posthog).toMatch(/feedback/i);
		expect(posthog).toMatch(/survey/i);
		const feedbackRow = RETENTION_ROWS.find((row) => row === "feedback");
		expect(feedbackRow).toBeDefined();
		expect(text("privacy_keep_feedback_kept")).toMatch(/PostHog/);
		expect(text("privacy_keep_feedback_kept")).not.toMatch(/12 months/);
	});

	it("links the analytics section to the published event list", () => {
		expect(text("privacy_analytics_events_link")).toBeTruthy();
	});

	it("says what the extension does and that it collects nothing", () => {
		const extension = joined("privacy_extension");
		expect(extension).toMatch(/collects nothing/i);
		expect(extension).toMatch(/no sign-in/i);
		expect(extension).toMatch(/title and address/i);
		expect(extension).toMatch(/on (your|this) device/i);
	});

	it("covers the Android app and links the deletion page", () => {
		expect(joined("privacy_play")).toContain("/account/delete");
		expect(PLAY_ROWS.length).toBeGreaterThanOrEqual(5);
	});

	it("keeps the rights and the 30-day answer", () => {
		const rights = joined("privacy_rights");
		expect(rights).toContain("Download my data");
		expect(rights).toContain("/account/delete");
		expect(rights).toMatch(/30 days/);
	});
});

describe("the processor table", () => {
	it("has exactly one row per processor, with no duplicates", () => {
		const ids = PROCESSORS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.sort()).toEqual([
			"buttondown",
			"cloudflare",
			"modal",
			"polar",
			"posthog",
		]);
	});

	it("has no row for Stripe: it is Polar's payment processor and the fallback is off", () => {
		expect(PROCESSORS.map((p) => p.name.toLowerCase())).not.toContain("stripe");
		expect(text("privacy_proc_polar_data")).toMatch(/Stripe/);
	});

	it("gives every row a why, what it handles and where", () => {
		for (const processor of PROCESSORS) {
			for (const part of ["why", "data", "where"]) {
				expect(text(`privacy_proc_${processor.id}_${part}`)).toBeTruthy();
			}
		}
		const ids = new Set(PROCESSORS.map((p) => p.id));
		for (const [key] of copyOf("privacy_proc")) {
			const id = key.split("_")[2] ?? "";
			if (["title", "intro", "caption"].includes(id)) continue;
			expect(ids.has(id as never), key).toBe(true);
		}
	});

	it("names every processor the code and config actually use", () => {
		for (const processor of PROCESSORS) {
			expect(processor.evidence.length, processor.id).toBeGreaterThan(0);
			for (const proof of processor.evidence) {
				expect(read(proof.file), `${processor.id}: ${proof.file}`).toContain(
					proof.includes,
				);
			}
		}
	});

	it("has a row for every third-party service the code and config reach", () => {
		const SERVICE_TO_ROW: Record<string, string> = {
			"posthog.com": "posthog",
			posthog: "posthog",
			"buttondown.com": "buttondown",
			buttondown: "buttondown",
			"polar.sh": "polar",
			"stripe.com": "polar",
			"modal.run": "modal",
			"modal.com": "modal",
			"cloudflare.com": "cloudflare",
			"cloudflareinsights.com": "cloudflare",
			"challenges.cloudflare.com": "cloudflare",
		};
		const NOT_ALLOWED = [
			"umami",
			"google-analytics",
			"googletagmanager",
			"sentry",
			"hotjar",
			"mixpanel",
			"plausible",
			"amplitude",
			"segment.com",
			"fullstory",
			"mailchimp",
			"intercom",
		];
		const files = [
			"worker/wrangler.jsonc",
			"app/package.json",
			"worker/package.json",
			"app/src/app.html",
			"app/static/_headers",
			"extension/src/manifest.ts",
		];
		const rows = new Set(PROCESSORS.map((p) => p.id as string));
		for (const file of files) {
			const body = read(file).toLowerCase();
			for (const name of NOT_ALLOWED) {
				expect(body, `${file} reaches ${name}`).not.toContain(name);
			}
			for (const [needle, row] of Object.entries(SERVICE_TO_ROW)) {
				if (body.includes(needle)) {
					expect(rows.has(row), `${file} reaches ${needle}`).toBe(true);
				}
			}
		}
	});
});

describe("the tables have a message behind every cell", () => {
	it("retention: a data cell and a kept cell per row", () => {
		expect(RETENTION_ROWS.length).toBeGreaterThanOrEqual(9);
		for (const id of RETENTION_ROWS) {
			expect(text(`privacy_keep_${id}_data`)).toBeTruthy();
			expect(text(`privacy_keep_${id}_kept`)).toBeTruthy();
		}
		const ids = new Set<string>(RETENTION_ROWS);
		for (const [key] of copyOf("privacy_keep")) {
			const id = key.replace(/^privacy_keep_/, "").replace(/_(data|kept)$/, "");
			if (["title", "caption", "col"].some((p) => id.startsWith(p))) continue;
			expect(ids.has(id), key).toBe(true);
		}
	});

	it("keeps the drafted retention periods", () => {
		expect(text("privacy_keep_codes_kept")).toMatch(/10 minutes/);
		expect(text("privacy_keep_sessions_kept")).toMatch(/1 year/);
		expect(text("privacy_keep_unpaid_kept")).toMatch(/7 days/);
		expect(text("privacy_keep_ended_kept")).toMatch(/30 days/);
	});

	it("Data safety: a category cell and a declared cell per row", () => {
		for (const id of PLAY_ROWS) {
			expect(text(`privacy_play_${id}_category`)).toBeTruthy();
			expect(text(`privacy_play_${id}_declared`)).toBeTruthy();
		}
	});
});

describe("the terms follow the ticket 56 draft", () => {
	const terms = joined("terms");

	it("states the Free Pledge in its own section, with the three promises", () => {
		const pledge = joined("terms_pledge");
		expect(pledge).toMatch(/free forever/i);
		expect(pledge).toMatch(/no ads/i);
		expect(pledge).toMatch(/no account is needed to read/i);
		expect(pledge).toMatch(/Cutting a feature is allowed/);
		expect(pledge).toMatch(/putting one behind payment is not/);
	});

	it("puts the Free Pledge and the consent rule outside the change clause", () => {
		expect(text("terms_pledge_outside")).toMatch(
			/outside the clause that lets these Terms change/,
		);
		const changes = joined("terms_changes");
		expect(changes).not.toMatch(/Free Pledge/);
		expect(changes).toMatch(/30 days/);
		expect(changes).toMatch(/email/i);
	});

	it("keeps the consent rule: nothing that sends text to our servers is on by default", () => {
		const consent = joined("terms_consent");
		expect(consent).toMatch(/never on by default/);
		expect(consent).toMatch(/asks before it starts/);
	});

	it("takes its figures from the plan data, not from typed numbers", () => {
		const figures = plusFigures();
		expect(figures).toEqual({
			monthly: "$6",
			annual: "$60",
			launch: "$40",
			hours: "20",
			sync: "1 GB",
		});
		const plus = joined("terms_plus");
		for (const placeholder of ["monthly", "annual", "launch", "hours"]) {
			expect(plus).toContain(`{${placeholder}}`);
		}
		expect(plus).not.toMatch(/\$\d/);
		expect(plus).not.toMatch(/\b20 hours\b/);
	});

	it("keeps the 14-day refund, 18+ for Plus, Delaware law and the controller", () => {
		expect(joined("terms_plus")).toMatch(/14 days/);
		expect(joined("terms_accounts")).toMatch(/18 or over/);
		expect(joined("terms_law")).toMatch(/Delaware/);
		expect(joined("terms_law")).toMatch(/consumer protections/);
		expect(terms).toContain("SamDev LLC");
		expect(terms).toContain("privacy@speeedy.app");
	});

	it("says the free app has no age limit because it collects nothing about you", () => {
		expect(joined("terms_accounts")).toMatch(/no age limit/);
	});

	it("does not mention the Stripe Payment Link or a waitlist", () => {
		expect(terms).not.toMatch(/payment link|waitlist/i);
	});
});

describe("the published event list is generated from the registry", () => {
	const doc = publishedEventList();

	it("has one section per registered event, then the $exception shape", () => {
		expect(doc.events.map((e) => e.name)).toEqual([
			...Object.keys(EVENTS),
			"$exception",
		]);
	});

	it("lists every property of every registered event, with its required flag", () => {
		for (const row of eventList(EVENTS)) {
			const section = doc.events.find((e) => e.name === row.name);
			expect(section, row.name).toBeDefined();
			expect(
				section?.props.map((p) => [p.name, p.required]),
				row.name,
			).toEqual(row.props.map((p) => [p.name, !p.optional]));
		}
	});

	it("includes every route the pageview may carry, the event list's own among them", () => {
		const pageview = doc.events.find((e) => e.name === "$pageview");
		const route = pageview?.props.find((p) => p.name === "route");
		expect(route?.value).toContain("`/privacy/events`");
		expect(route?.value).toContain("`/privacy`");
		expect(route?.value).toContain("`/terms`");
	});

	it("is the same text as the committed generated/events.md, so a drift fails here", () => {
		expect(renderEventListMarkdown(EVENTS)).toBe(
			read("packages/contracts/generated/events.md"),
		);
	});

	it("is built from the registry, never typed into the page", () => {
		const page = read("app/src/routes/privacy/events/+page.svelte");
		for (const name of Object.keys(EVENTS)) {
			expect(page, name).not.toContain(name);
		}
		expect(page).toContain("publishedEventList");
		const messagesBlock = joined("events");
		for (const name of Object.keys(EVENTS)) {
			expect(messagesBlock, name).not.toContain(name);
		}
	});

	it("parses a small document the same way", () => {
		const parsed = eventListDocument(
			[
				"<!-- generated -->",
				"",
				"# Title",
				"",
				"Intro text.",
				"",
				"## `a_event`",
				"",
				"Does `a` thing.",
				"",
				"Sent by: the app. Schema version 1.",
				"",
				"| Property | Value | Required |",
				"| --- | --- | --- |",
				"| `x` | one of `p`, `q` | yes |",
				"| `y` | yes or no | no |",
				"",
				"## `b_event`",
				"",
				"No properties.",
				"",
			].join("\n"),
		);
		expect(parsed.intro).toEqual(["Intro text."]);
		expect(parsed.events.map((e) => e.name)).toEqual(["a_event", "b_event"]);
		expect(parsed.events[0]?.props).toEqual([
			{ name: "x", value: "one of `p`, `q`", required: true },
			{ name: "y", value: "yes or no", required: false },
		]);
		expect(parsed.events[0]?.paragraphs).toEqual([
			"Does `a` thing.",
			"Sent by: the app. Schema version 1.",
		]);
		expect(parsed.events[1]?.props).toEqual([]);
	});

	it("splits inline code from plain text", () => {
		expect(inlineParts("one of `a`, `b`")).toEqual([
			{ text: "one of ", code: false },
			{ text: "a", code: true },
			{ text: ", ", code: false },
			{ text: "b", code: true },
		]);
		expect(inlineParts("plain")).toEqual([{ text: "plain", code: false }]);
	});
});
