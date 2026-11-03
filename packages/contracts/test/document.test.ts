import { describe, expect, it } from "vitest";
import {
	type Block,
	DOCUMENT_FORMAT_VERSION,
	type Document,
	isDocument,
	validateDocument,
} from "../src/index";

const doc = (...blocks: unknown[]): unknown => ({
	version: DOCUMENT_FORMAT_VERSION,
	blocks,
});

const paragraph = (text = "Hello world", spans: unknown[] = []) => ({
	kind: "paragraph",
	text,
	spans,
});

// One valid block of every kind.
const everyKind: Block[] = [
	{ kind: "heading", level: 1, text: "Title", spans: [] },
	{ kind: "heading", level: 6, text: "Deep", spans: [] },
	{ kind: "paragraph", text: "Plain words.", spans: [] },
	{
		kind: "list-item",
		depth: 0,
		ordered: false,
		text: "First",
		spans: [],
	},
	{ kind: "list-item", depth: 2, ordered: true, text: "Nested", spans: [] },
	{ kind: "quote", text: "To be or not", spans: [] },
	{ kind: "code", text: "const a = 1;", spans: [] },
	{ kind: "table-text", text: "name | age", spans: [] },
	{ kind: "caption", text: "Figure 1", spans: [] },
	{ kind: "image-placeholder", alt: "A chart" },
	{ kind: "image-placeholder", alt: "", width: 640, height: 480 },
];

describe("document format", () => {
	it("is version 1", () => {
		expect(DOCUMENT_FORMAT_VERSION).toBe(1);
	});

	it("accepts a Document holding every block kind", () => {
		const result = validateDocument({
			version: 1,
			blocks: everyKind,
		});
		expect(result.ok).toBe(true);
	});

	it("accepts an empty Document", () => {
		expect(isDocument(doc())).toBe(true);
	});

	it("returns the same Document when valid, typed", () => {
		const input: Document = {
			version: 1,
			blocks: [{ kind: "paragraph", text: "Hi", spans: [] }],
		};
		const result = validateDocument(input);
		expect(result.ok && result.document).toEqual(input);
	});

	it("accepts emphasis, strong and link spans, overlapping and nested", () => {
		const text = "Read the docs now";
		const valid = doc(
			paragraph(text, [
				{ kind: "emphasis", start: 0, end: 4 },
				{ kind: "strong", start: 0, end: 17 },
				{ kind: "link", start: 9, end: 13, href: "https://speeedy.app" },
			]),
		);
		expect(isDocument(valid)).toBe(true);
	});

	it("accepts spans that cover the whole block text", () => {
		expect(
			isDocument(doc(paragraph("abc", [{ kind: "strong", start: 0, end: 3 }]))),
		).toBe(true);
	});

	it("accepts multi-code-unit text, with offsets counted in UTF-16 code units", () => {
		const text = "a\u{1F600}b";
		expect(text.length).toBe(4);
		expect(
			isDocument(
				doc(paragraph(text, [{ kind: "emphasis", start: 1, end: 4 }])),
			),
		).toBe(true);
	});
});

describe("document validation rejects malformed input", () => {
	const bad: Array<[string, unknown]> = [
		["null", null],
		["a string", "hello"],
		["an array", []],
		["a number", 1],
		["missing version", { blocks: [] }],
		["missing blocks", { version: 1 }],
		["unknown version 2", { version: 2, blocks: [] }],
		["unknown version 0", { version: 0, blocks: [] }],
		["string version", { version: "1", blocks: [] }],
		["blocks not an array", { version: 1, blocks: {} }],
		["unknown top-level key", { version: 1, blocks: [], title: "x" }],
		["block that is null", doc(null)],
		["block that is a string", doc("paragraph")],
		["unknown block kind", doc({ kind: "video", text: "x", spans: [] })],
		["block with no kind", doc({ text: "x", spans: [] })],
		["paragraph without text", doc({ kind: "paragraph", spans: [] })],
		[
			"paragraph with numeric text",
			doc({ kind: "paragraph", text: 5, spans: [] }),
		],
		["paragraph without spans", doc({ kind: "paragraph", text: "x" })],
		["spans not an array", doc({ kind: "paragraph", text: "x", spans: {} })],
		["unknown key on a paragraph", doc({ ...paragraph(), extra: 1 })],
		[
			"heading level 0",
			doc({ kind: "heading", level: 0, text: "x", spans: [] }),
		],
		[
			"heading level 7",
			doc({ kind: "heading", level: 7, text: "x", spans: [] }),
		],
		[
			"heading level 1.5",
			doc({ kind: "heading", level: 1.5, text: "x", spans: [] }),
		],
		["heading without level", doc({ kind: "heading", text: "x", spans: [] })],
		[
			"list item with negative depth",
			doc({
				kind: "list-item",
				depth: -1,
				ordered: false,
				text: "x",
				spans: [],
			}),
		],
		[
			"list item with fractional depth",
			doc({
				kind: "list-item",
				depth: 0.5,
				ordered: false,
				text: "x",
				spans: [],
			}),
		],
		[
			"list item without ordered flag",
			doc({ kind: "list-item", depth: 0, text: "x", spans: [] }),
		],
		[
			"list item with string ordered flag",
			doc({
				kind: "list-item",
				depth: 0,
				ordered: "yes",
				text: "x",
				spans: [],
			}),
		],
		[
			"span of unknown kind",
			doc(paragraph("abc", [{ kind: "underline", start: 0, end: 1 }])),
		],
		["span that is null", doc(paragraph("abc", [null]))],
		[
			"span with negative start",
			doc(paragraph("abc", [{ kind: "strong", start: -1, end: 2 }])),
		],
		[
			"span ending past the text",
			doc(paragraph("abc", [{ kind: "strong", start: 0, end: 4 }])),
		],
		[
			"empty span",
			doc(paragraph("abc", [{ kind: "strong", start: 1, end: 1 }])),
		],
		[
			"reversed span",
			doc(paragraph("abc", [{ kind: "strong", start: 2, end: 1 }])),
		],
		[
			"fractional span offset",
			doc(paragraph("abc", [{ kind: "strong", start: 0.5, end: 2 }])),
		],
		[
			"NaN span offset",
			doc(paragraph("abc", [{ kind: "strong", start: Number.NaN, end: 2 }])),
		],
		[
			"link without href",
			doc(paragraph("abc", [{ kind: "link", start: 0, end: 1 }])),
		],
		[
			"link with empty href",
			doc(paragraph("abc", [{ kind: "link", start: 0, end: 1, href: "" }])),
		],
		[
			"link with numeric href",
			doc(paragraph("abc", [{ kind: "link", start: 0, end: 1, href: 3 }])),
		],
		[
			"href on a non-link span",
			doc(
				paragraph("abc", [
					{ kind: "strong", start: 0, end: 1, href: "https://a.b" },
				]),
			),
		],
		["image placeholder without alt", doc({ kind: "image-placeholder" })],
		[
			"image placeholder with numeric alt",
			doc({ kind: "image-placeholder", alt: 1 }),
		],
		[
			"image placeholder with zero width",
			doc({ kind: "image-placeholder", alt: "", width: 0 }),
		],
		[
			"image placeholder with negative height",
			doc({ kind: "image-placeholder", alt: "", height: -5 }),
		],
		[
			"image placeholder with fractional width",
			doc({ kind: "image-placeholder", alt: "", width: 1.5 }),
		],
	];

	it.each(bad)("rejects %s", (_name, value) => {
		expect(isDocument(value)).toBe(false);
		const result = validateDocument(value);
		expect(result.ok).toBe(false);
	});

	it("says which block is wrong", () => {
		const result = validateDocument(
			doc(paragraph(), { kind: "heading", level: 9, text: "x", spans: [] }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("blocks[1]");
		}
	});

	it("does not throw on hostile input", () => {
		const cyclic: Record<string, unknown> = { version: 1 };
		cyclic.blocks = [cyclic];
		expect(() => validateDocument(cyclic)).not.toThrow();
		expect(isDocument(cyclic)).toBe(false);
		const withGetter = {
			version: 1,
			get blocks(): unknown {
				throw new Error("boom");
			},
		};
		expect(() => validateDocument(withGetter)).not.toThrow();
	});
});

describe("no image bytes are representable", () => {
	it("rejects bytes-like fields on an image placeholder", () => {
		const carriers: unknown[] = [
			new Uint8Array([1, 2, 3]),
			new ArrayBuffer(8),
			"data:image/png;base64,AAAA",
			[1, 2, 3],
		];
		for (const field of ["data", "bytes", "src", "blob", "dataUri", "image"]) {
			for (const carrier of carriers) {
				const block = { kind: "image-placeholder", alt: "a", [field]: carrier };
				expect(isDocument(doc(block))).toBe(false);
			}
		}
	});

	it("rejects bytes-like fields on any other block", () => {
		expect(isDocument(doc({ ...paragraph(), data: new Uint8Array([1]) }))).toBe(
			false,
		);
	});

	it("rejects a bytes-like value as alt text, width or height", () => {
		expect(
			isDocument(doc({ kind: "image-placeholder", alt: new Uint8Array([1]) })),
		).toBe(false);
		expect(
			isDocument(
				doc({ kind: "image-placeholder", alt: "", width: new Uint8Array([1]) }),
			),
		).toBe(false);
	});

	it("does not type a bytes field on an image placeholder", () => {
		const block: Block = {
			kind: "image-placeholder",
			alt: "",
			// @ts-expect-error an image placeholder has no bytes field
			bytes: new Uint8Array(1),
		};
		expect(block.kind).toBe("image-placeholder");
	});
});
