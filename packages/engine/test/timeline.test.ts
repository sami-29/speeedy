import type { Document } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import { buildTimeline, computeOrp } from "../src/index";
import { framesOf, paragraphs } from "./helpers";

const durations = (text: string, settings = {}) =>
	framesOf(text, settings).map((frame) => frame.durationMs);

describe("Frame positions", () => {
	it("carries the Position where each Frame starts and ends", () => {
		const { frames } = buildTimeline(paragraphs("Hello big world", "Next one"));
		expect(frames.map((frame) => frame.position)).toEqual([
			{ block: 0, offset: 0 },
			{ block: 0, offset: 6 },
			{ block: 0, offset: 10 },
			{ block: 1, offset: 0 },
			{ block: 1, offset: 5 },
		]);
		expect(frames[2]?.end).toEqual({ block: 0, offset: 15 });
	});

	it("includes attached punctuation in the Frame's range", () => {
		const [, frame] = framesOf('say "hi!" now');
		expect(frame?.text).toBe('"hi!"');
		expect(frame?.position).toEqual({ block: 0, offset: 4 });
		expect(frame?.end).toEqual({ block: 0, offset: 9 });
	});

	it("counts offsets in UTF-16 code units", () => {
		const frames = framesOf("😀 hi there");
		expect(frames.at(-1)?.text).toBe("there");
		expect(frames.at(-1)?.position.offset).toBe(6);
	});

	it("reads headings, lists, quotes and code, and skips image placeholders", () => {
		const document: Document = {
			version: 1,
			blocks: [
				{ kind: "heading", level: 1, text: "Title here", spans: [] },
				{ kind: "image-placeholder", alt: "A chart of sales" },
				{
					kind: "list-item",
					depth: 0,
					ordered: false,
					text: "item",
					spans: [],
				},
				{ kind: "code", text: "x = 1", spans: [] },
			],
		};
		const { frames } = buildTimeline(document);
		expect(frames.map((frame) => frame.text)).toEqual([
			"Title",
			"here",
			"item",
			"x=",
			"1",
		]);
		expect(frames[2]?.position).toEqual({ block: 2, offset: 0 });
	});

	it("builds an empty Timeline for a Document with no words", () => {
		expect(buildTimeline({ version: 1, blocks: [] })).toEqual({
			frames: [],
			totalMs: 0,
		});
	});
});

describe("Frame ORP", () => {
	it("carries the ORP split and the pivot index from computeOrp", () => {
		const [frame] = framesOf("reading");
		expect(frame?.orp).toEqual({ before: "re", pivot: "a", after: "ding" });
		expect(frame?.orpIndex).toBe(2);
	});

	it("counts leading punctuation in the ORP index", () => {
		const [frame] = framesOf('"hello"');
		expect(frame?.orpIndex).toBe(2);
		expect(frame?.orp.pivot).toBe("e");
	});
});

describe("computeOrp (kept from 1.x)", () => {
	it("returns the whole text as pivot for a single character", () => {
		expect(computeOrp("a")).toEqual({ before: "", pivot: "a", after: "" });
	});

	it("places the pivot by word length", () => {
		expect(computeOrp("hello")).toEqual({
			before: "h",
			pivot: "e",
			after: "llo",
		});
		expect(computeOrp("reading")).toEqual({
			before: "re",
			pivot: "a",
			after: "ding",
		});
		expect(computeOrp("speedreading")).toEqual({
			before: "spe",
			pivot: "e",
			after: "dreading",
		});
	});

	it("keeps punctuation around the core word", () => {
		expect(computeOrp("word.").after).toContain(".");
		expect(computeOrp('"hello"').before).toBe('"h');
	});

	it("treats pure punctuation as the pivot", () => {
		expect(computeOrp("...")).toEqual({ before: "", pivot: "...", after: "" });
	});

	it("shifts the pivot with the focus position", () => {
		expect(computeOrp("reading", "early").before.length).toBe(1);
		expect(computeOrp("reading", "late").before.length).toBe(3);
	});

	it("keeps combining marks with the pivot", () => {
		const word = "e\u0301tude";
		const { before, pivot, after } = computeOrp(word);
		expect(before + pivot + after).toBe(word);
		expect(pivot).toBe("t");
	});
});

describe("base WPM timing (1.x rules)", () => {
	it("shows a plain word for 60000 / wpm milliseconds", () => {
		expect(durations("one two", { wpm: 300 })).toEqual([200, 200]);
		expect(durations("one two", { wpm: 600 })).toEqual([100, 100]);
		expect(durations("one two", { wpm: 60 })).toEqual([1000, 1000]);
	});

	it("defaults to 300 wpm", () => {
		expect(durations("one")).toEqual([200]);
	});

	it("starts each Frame when the one before it ends", () => {
		const { frames, totalMs } = buildTimeline(paragraphs("one two three"), {
			wpm: 300,
		});
		expect(frames.map((frame) => frame.startMs)).toEqual([0, 200, 400]);
		expect(totalMs).toBe(600);
	});

	it("stretches a sentence end by the sentence pause multiplier", () => {
		expect(durations("end. next", { wpm: 300 })).toEqual([600, 200]);
		expect(
			durations("end. next", { wpm: 300, sentencePauseMultiplier: 1 }),
		).toEqual([400, 200]);
		expect(
			durations("end. next", { wpm: 300, sentencePauseMultiplier: 0 }),
		).toEqual([200, 200]);
	});

	it("treats ! ? and CJK full stops as sentence ends", () => {
		expect(durations("what? yes! ok", { wpm: 300 })).toEqual([600, 600, 200]);
		expect(durations("你好。再见", { wpm: 300 }).includes(600)).toBe(true);
	});

	it("stretches commas, semicolons and colons less, or like a sentence with commaAsPause", () => {
		expect(durations("a, b; c: d", { wpm: 300 })).toEqual([360, 360, 360, 200]);
		expect(durations("a, b; c: d", { wpm: 300, commaAsPause: true })).toEqual([
			600, 600, 360, 200,
		]);
	});

	it("pauses at the start of a paragraph after the first", () => {
		const { frames } = buildTimeline(paragraphs("one two", "three four"), {
			wpm: 300,
		});
		expect(frames.map((frame) => frame.durationMs)).toEqual([
			200, 200, 360, 200,
		]);
		expect(frames[2]?.context.paragraphStart).toBe(true);
		expect(frames[0]?.context.paragraphStart).toBe(false);
	});

	it("does not slow paragraph starts when the multiplier is 1", () => {
		const { frames } = buildTimeline(paragraphs("one", "two"), {
			wpm: 300,
			paragraphPauseMultiplier: 1,
		});
		expect(frames.map((frame) => frame.durationMs)).toEqual([200, 200]);
	});

	it("adds a short pause after a word that closes an aside", () => {
		expect(durations("see (this) now", { wpm: 300 })).toEqual([200, 230, 200]);
		expect(
			durations("see (this) now", { wpm: 300, contextPauseOnClose: false }),
		).toEqual([200, 200, 200]);
	});
});

describe("punctuation pauses ignore closing quotes and brackets (1.x regression)", () => {
	it('a sentence end inside a closing quote still gets the sentence pause: ."', () => {
		const [, , quoted] = framesOf('He said "stop." Then', {
			wpm: 300,
			contextPauseOnClose: false,
		});
		expect(quoted?.text).toBe('"stop."');
		expect(quoted?.durationMs).toBe(600);
	});

	it("a sentence end before a closing bracket still gets it: ?) and !)", () => {
		expect(
			durations("(really?) (stop!) ok", {
				wpm: 300,
				contextPauseOnClose: false,
			}),
		).toEqual([600, 600, 200]);
	});

	it("applies both the sentence pause and the aside pause", () => {
		expect(durations("(really?) ok", { wpm: 300 })).toEqual([690, 200]);
	});

	it("a quote closing a word with no punctuation adds no sentence pause", () => {
		expect(
			durations('said "stop" now', { wpm: 300, contextPauseOnClose: false }),
		).toEqual([200, 200, 200]);
	});

	it("an opening Slavic quote is not a sentence end (1.x gave it 2x)", () => {
		expect(
			durations("rzekł „stop” teraz", {
				wpm: 300,
				contextPauseOnClose: false,
			}),
		).toEqual([200, 200, 200]);
		expect(durations("rzekł „stop teraz", { wpm: 300 })).toEqual([
			200, 200, 200,
		]);
	});

	it("does not pause on a hyphen or dash", () => {
		expect(durations("well-known wait—what", { wpm: 300 })).toEqual([
			200, 200, 200, 200,
		]);
	});
});

describe("robust durations", () => {
	it("always produces positive finite durations for odd wpm values", () => {
		for (const wpm of [
			0,
			-50,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			1e9,
			0.01,
		]) {
			for (const duration of durations("Hello, world. (ok)", { wpm })) {
				expect(Number.isFinite(duration)).toBe(true);
				expect(duration).toBeGreaterThan(0);
			}
		}
	});

	it("survives structuredClone, so a worker can hand it over", () => {
		const timeline = buildTimeline(paragraphs('He said "stop." Then (ok).'));
		expect(structuredClone(timeline)).toEqual(timeline);
	});
});
