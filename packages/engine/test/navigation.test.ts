import type { Document } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import {
	buildTimeline,
	createEngine,
	createManualClock,
	findChapters,
} from "../src/index";
import { paragraphs } from "./helpers";

/** 200 ms per Frame at 300 wpm, with no extra pauses so the timing stays easy to read. */
function setup(document: Document, { withChapters = false } = {}) {
	const clock = createManualClock();
	const engine = createEngine({
		clock,
		timeline: buildTimeline(document, {
			wpm: 300,
			sentencePauseMultiplier: 0,
			paragraphPauseMultiplier: 1,
		}),
		...(withChapters ? { chapters: findChapters(document) } : {}),
	});
	const seeks: { block: number; offset: number }[] = [];
	engine.on("seek", ({ position }) => seeks.push(position));
	const goTo = (word: string) => {
		const frame = engine.timeline.frames.find((f) => f.text === word);
		if (!frame) throw new Error(`no Frame "${word}"`);
		engine.seek(frame.position);
		seeks.length = 0;
	};
	return { clock, engine, seeks, goTo };
}

describe("back one sentence", () => {
	const doc = () => paragraphs("One two. Three four five. Six seven.");

	it("goes to the start of the current sentence from the middle of it", () => {
		const { engine, goTo } = setup(doc());
		goTo("five");
		engine.back();
		expect(engine.frame?.text).toBe("Three");
	});

	it("goes to the start of the previous sentence from a sentence start", () => {
		const { engine, goTo } = setup(doc());
		goTo("Six");
		engine.back("sentence");
		expect(engine.frame?.text).toBe("Three");
		engine.back();
		expect(engine.frame?.text).toBe("One");
	});

	it("stays at the document start and still emits seek", () => {
		const { engine, seeks, goTo } = setup(doc());
		goTo("two");
		engine.back();
		expect(engine.frame?.text).toBe("One");
		seeks.length = 0;
		engine.back();
		expect(engine.frame?.text).toBe("One");
		expect(seeks).toEqual([{ block: 0, offset: 0 }]);
	});

	it("emits seek with the landing Position", () => {
		const { engine, seeks, goTo } = setup(doc());
		goTo("four");
		engine.back();
		expect(seeks).toEqual([{ block: 0, offset: 9 }]);
	});

	it("treats a closing quote after the full stop as the end of the sentence", () => {
		const { engine, goTo } = setup(paragraphs('He said "stop." Then go.'));
		goTo("go.");
		engine.back();
		expect(engine.frame?.text).toBe("Then");
		engine.back();
		expect(engine.frame?.text).toBe("He");
	});

	it("crosses blocks", () => {
		const { engine, goTo } = setup(
			paragraphs("First one. Second here.", "Third part"),
		);
		goTo("Third");
		engine.back();
		expect(engine.frame?.text).toBe("Second");
	});

	it("treats the start of a block as a sentence start", () => {
		const { engine, goTo } = setup(paragraphs("a b", "c d"));
		goTo("d");
		engine.back();
		expect(engine.frame?.text).toBe("c");
		engine.back();
		expect(engine.frame?.text).toBe("a");
	});

	it("skips image placeholders between blocks", () => {
		const document = {
			version: 1,
			blocks: [
				{ kind: "paragraph", text: "before it", spans: [] },
				{ kind: "image-placeholder", alt: "a picture" },
				{ kind: "paragraph", text: "after it", spans: [] },
			],
		} as unknown as Document;
		const { engine, goTo } = setup(document);
		goTo("after");
		engine.back();
		expect(engine.frame?.text).toBe("before");
	});

	it("resumes playing from the landing Frame", () => {
		const { engine, clock, goTo } = setup(doc());
		goTo("Six");
		engine.play();
		clock.advance(100);
		engine.back();
		expect(engine.playing).toBe(true);
		expect(engine.frame?.text).toBe("Three");
		clock.advance(250);
		expect(engine.frame?.text).toBe("four");
	});

	it("does nothing for an empty Timeline", () => {
		const { engine, seeks } = setup(paragraphs(""));
		engine.back();
		expect(seeks).toEqual([]);
		expect(engine.frame).toBeUndefined();
	});
});

describe("back one paragraph", () => {
	it("goes to the start of the current paragraph, then the previous ones", () => {
		const { engine, goTo } = setup(paragraphs("one two three", "four five six"));
		goTo("five");
		engine.back("paragraph");
		expect(engine.frame?.text).toBe("four");
		engine.back("paragraph");
		expect(engine.frame?.text).toBe("one");
		engine.back("paragraph");
		expect(engine.frame?.text).toBe("one");
	});

	it("ignores sentence ends inside the paragraph", () => {
		const { engine, goTo } = setup(paragraphs("a b. c d. e f."));
		goTo("e");
		engine.back("paragraph");
		expect(engine.frame?.text).toBe("a");
	});
});

describe("back one chapter", () => {
	const book = (): Document => ({
		version: 1,
		blocks: [
			{ kind: "heading", level: 1, text: "Ch One", spans: [] },
			{ kind: "paragraph", text: "alpha beta", spans: [] },
			{ kind: "heading", level: 2, text: "Ch Two", spans: [] },
			{ kind: "paragraph", text: "gamma delta", spans: [] },
			{ kind: "heading", level: 3, text: "Aside", spans: [] },
			{ kind: "paragraph", text: "epsilon zeta", spans: [] },
		],
	});

	it("goes to the start of the current chapter, then the previous one", () => {
		const { engine, goTo } = setup(book(), { withChapters: true });
		goTo("delta");
		engine.back("chapter");
		expect(engine.frame?.position).toEqual({ block: 2, offset: 0 });
		engine.back("chapter");
		expect(engine.frame?.position).toEqual({ block: 0, offset: 0 });
		engine.back("chapter");
		expect(engine.frame?.position).toEqual({ block: 0, offset: 0 });
	});

	it("does not treat a deep heading as a chapter", () => {
		const { engine, goTo } = setup(book(), { withChapters: true });
		goTo("zeta");
		engine.back("chapter");
		expect(engine.frame?.position).toEqual({ block: 2, offset: 0 });
	});

	it("goes to the document start when there are no chapters", () => {
		const { engine, goTo } = setup(paragraphs("one two", "three four"));
		goTo("four");
		engine.back("chapter");
		expect(engine.frame?.text).toBe("one");
	});

	it("finds chapters at heading levels 1 and 2", () => {
		expect(findChapters(book())).toEqual([
			{ block: 0, offset: 0 },
			{ block: 2, offset: 0 },
		]);
	});
});
