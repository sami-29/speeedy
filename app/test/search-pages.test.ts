import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	KOKORO_ASSETS,
	TOTAL_DOWNLOAD_BYTES,
} from "../../packages/kokoro/src/assets.ts";
import { MAX_BYTES, MAX_MILLIS } from "../../packages/parsers/src/types.ts";
import { PUBLIC_PAGES } from "../src/lib/seo/pages.ts";
import { PLANNED_PUBLIC_ROUTES } from "../src/lib/seo/planned.ts";

const messages = JSON.parse(
	readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"),
) as Record<string, string>;

// One message prefix per search page, with the route, title and description wayfinder
// ticket 34 fixes. The Spreeder description is written with the page.
const PAGES = [
	{
		prefix: "pdf",
		path: "/pdf-speed-reader",
		title: "PDF Speed Reader, Free Online, No Upload | Speeedy",
		description:
			"Open a PDF and speed read it word by word or with a guided highlight. The file never leaves your device. Free, no account, works offline.",
	},
	{
		prefix: "epub",
		path: "/epub-speed-reader",
		title: "EPUB Speed Reader, Free in Your Browser | Speeedy",
		description:
			"Open a DRM-free EPUB and read it with RSVP, Pacer or Listen, picking up where you left off. Free, no account, the book stays on your device.",
	},
	{
		prefix: "adhd",
		path: "/adhd-reading-tool",
		title: "ADHD Reading Tool: One Word at a Time | Speeedy",
		description:
			"Read one word at a time in a fixed spot, at a steady pace. A small 2025 study found this helped students with ADHD at about 200 WPM. Free, no account.",
	},
	{
		prefix: "tts",
		path: "/text-to-speech-reader",
		title: "Free Text to Speech Reader with Word Highlight | Speeedy",
		description:
			"Hear your text read aloud while each word lights up as it's spoken. The built-in voice runs on your device, offline, after a one-time 31 MB download.",
	},
	{
		prefix: "spreeder",
		path: "/spreeder-alternative",
		title: "Free Spreeder Alternative, Open Source | Speeedy",
		description: undefined,
	},
] as const;

/** Every message that belongs to one page, by key prefix. */
const copyOf = (prefix: string): [string, string][] =>
	Object.entries(messages).filter(([key]) => key.startsWith(`${prefix}_`));

const allCopy = (prefix: string): string =>
	copyOf(prefix)
		.map(([, value]) => value)
		.join("\n");

describe("search pages registry", () => {
	it("lists all five search routes for the sitemap, each once", () => {
		const paths = PUBLIC_PAGES.map((page) => page.path);
		for (const { path } of PAGES) expect(paths).toContain(path);
		expect(new Set(paths).size).toBe(paths.length);
	});

	it("has no planned route left: the Spreeder page now exists", () => {
		expect(PLANNED_PUBLIC_ROUTES).toEqual([]);
	});
});

describe("search page titles and descriptions", () => {
	for (const page of PAGES) {
		it(`${page.path} uses the ticket 34 title, within 60 characters`, () => {
			expect(messages[`${page.prefix}_title`]).toBe(page.title);
			expect(page.title.length).toBeLessThanOrEqual(60);
		});

		it(`${page.path} has a description within 155 characters`, () => {
			const description = messages[`${page.prefix}_description`];
			expect(description).toBeTruthy();
			expect((description ?? "").length).toBeLessThanOrEqual(155);
			if (page.description) expect(description).toBe(page.description);
		});
	}
});

describe("the copy rules, on every search page", () => {
	for (const page of PAGES) {
		const copy = copyOf(page.prefix);

		it(`${page.path} has copy of its own`, () => {
			expect(copy.length).toBeGreaterThan(6);
		});

		it(`${page.path} promises no speed multiplier and nothing 'best'`, () => {
			for (const [key, value] of copy) {
				expect(value, key).not.toMatch(/\bbest\b/i);
				expect(value, key).not.toMatch(/\b\d+(\.\d+)?\s?(x|times)\b/i);
				expect(value, key).not.toMatch(/\b(double|triple|twice)\b/i);
				expect(value, key).not.toMatch(/\bfaster\b/i);
			}
		});

		it(`${page.path} puts no file path or code in its text`, () => {
			for (const [key, value] of copy) {
				if (key.endsWith("_title") || key.endsWith("_description")) continue;
				expect(value, key).not.toMatch(/\.(ts|svelte|json|js)\b|\bsrc\/|`/);
			}
		});
	}
});

describe("/pdf-speed-reader", () => {
	const copy = allCopy("pdf");

	it("quotes the rebuilt parser's own message for a scanned PDF", () => {
		const source = readFileSync(
			new URL("../../packages/parsers/src/pdf/blocks.ts", import.meta.url),
			"utf8",
		);
		const message = /"(This PDF is a scan:[^"]+)"/.exec(source)?.[1];
		expect(message).toBeTruthy();
		expect(copy).toContain(message as string);
	});

	it("says what to do with a scan and that there is no OCR", () => {
		expect(copy).toMatch(/OCR/);
		expect(copy).toMatch(/scan/i);
	});

	it("states the parser's real limits", () => {
		expect(copy).toContain(`${MAX_BYTES / 1_000_000} MB`);
		expect(copy).toContain(`${MAX_MILLIS / 60_000} minutes`);
	});

	it("covers locked files", () => {
		expect(copy).toMatch(/password/i);
	});
});

describe("/epub-speed-reader", () => {
	const copy = allCopy("epub");

	it("explains DRM and quotes the parser's message", () => {
		const source = readFileSync(
			new URL("../../packages/parsers/src/epub.ts", import.meta.url),
			"utf8",
		);
		const message = /"(This book is protected by DRM[^"]+)"/.exec(source)?.[1];
		expect(message).toBeTruthy();
		expect(copy).toContain(message as string);
	});

	it("says where your place is kept", () => {
		expect(copy).toMatch(/Library/);
		expect(copy).toMatch(/on this device/i);
	});
});

describe("/adhd-reading-tool", () => {
	const copy = allCopy("adhd");

	it("names the study and its limits", () => {
		expect(copy).toContain("Moussaoui");
		expect(copy).toContain("2025");
		expect(copy).toContain("38");
		expect(copy).toMatch(/initial step/);
		expect(copy).toMatch(/online/i);
		expect(copy).toMatch(/eye tracking/i);
		expect(copy).toMatch(/seven passages/i);
		expect(copy).toMatch(/one question/i);
		expect(copy).toMatch(/power analysis/i);
	});

	it("says both numbers: the study ran at about 200 WPM, the preset opens at 220", () => {
		expect(copy).toMatch(/about 200 (WPM|words per minute)/);
		expect(copy).toMatch(/220 (WPM|words per minute)/);
	});

	it("makes no Bionic, font, overlay or dyslexia claims", () => {
		const all = [
			...copyOf("adhd"),
			["title", messages.adhd_title],
			["description", messages.adhd_description],
		] as [string, string][];
		for (const [key, value] of all) {
			expect(value, key).not.toMatch(
				/bionic|font|overlay|dyslex|colou?r(ed)? |irlen/i,
			);
		}
	});

	it("does not call the tool a treatment or a cure", () => {
		expect(copy).not.toMatch(/\b(cure|cures|treats|heals)\b/i);
	});
});

describe("/text-to-speech-reader", () => {
	const copy = allCopy("tts");

	it("explains the on-device download, with sizes that match the pinned files", () => {
		const model = Math.round(KOKORO_ASSETS.model.bytes / 1e6);
		const total = Math.round(TOTAL_DOWNLOAD_BYTES / 1e6);
		expect(model).toBe(31);
		expect(copy).toContain(`${model} MB`);
		expect(copy).toContain(`${total} MB`);
		expect(copy).toMatch(/one-time/i);
		expect(copy).toMatch(/offline/i);
		expect(copy).toMatch(/nothing downloads until you/i);
	});

	it("describes browser voices as a fallback that highlights by sentence", () => {
		const voices = messages.tts_browser_body ?? "";
		expect(voices).toMatch(/fallback/i);
		expect(voices).toMatch(/sentence/i);
		expect(voices).not.toMatch(/word[- ](by|to)[- ]word|word sync|each word/i);
	});
});

describe("/spreeder-alternative", () => {
	const copy = allCopy("spreeder");

	it("prints the day the vendor facts were checked", () => {
		expect(copy).toMatch(/checked on 21 October 2026/i);
	});

	it("uses only what Spreeder's own pages said on that day", () => {
		expect(copy).toContain("200 words");
		expect(copy).toContain("eReflect");
		expect(copy).toContain("52 file formats");
	});

	it("states no price", () => {
		expect(copy).not.toMatch(/[$£€]\s?\d|\bUSD\b|\bEUR\b|\d+\.\d{2}\b/);
		expect(copy).not.toMatch(
			/\bper (month|year|week)\b|\blifetime\b|\bcheaper\b/i,
		);
	});

	it("says it is not affiliated", () => {
		expect(copy).toMatch(/not affiliated/i);
	});
});
