import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import { blocksOf, expectError, expectSuccess, textsOf, utf8 } from "./helpers";

const md = (source: string, name = "doc.md") => parse(utf8(source), name);

describe("markdown: blocks", () => {
	it("maps ATX headings levels 1 to 6, trimming closing hashes", async () => {
		const blocks = blocksOf(
			await md("# One\n\n## Two ##\n\n###### Six\n\n####### Seven"),
		);
		expect(blocks).toEqual([
			{ kind: "heading", level: 1, text: "One", spans: [] },
			{ kind: "heading", level: 2, text: "Two", spans: [] },
			{ kind: "heading", level: 6, text: "Six", spans: [] },
			{ kind: "paragraph", text: "####### Seven", spans: [] },
		]);
	});

	it("maps setext headings", async () => {
		const blocks = blocksOf(await md("Title\n=====\n\nSub\n---\n\nbody"));
		expect(blocks.map((b) => b.kind)).toEqual([
			"heading",
			"heading",
			"paragraph",
		]);
		expect(blocks[0]).toMatchObject({ level: 1, text: "Title" });
		expect(blocks[1]).toMatchObject({ level: 2, text: "Sub" });
	});

	it("joins the lines of one paragraph with a space", async () => {
		expect(textsOf(await md("one\ntwo\n\nthree"))).toEqual([
			"one two",
			"three",
		]);
	});

	it("maps unordered and ordered lists with depth", async () => {
		const blocks = blocksOf(
			await md(
				"- a\n- b\n  - b1\n    - b2\n- c\n\n1. first\n2. second\n   continued\n3) third",
			),
		);
		expect(blocks).toEqual([
			{ kind: "list-item", depth: 0, ordered: false, text: "a", spans: [] },
			{ kind: "list-item", depth: 0, ordered: false, text: "b", spans: [] },
			{ kind: "list-item", depth: 1, ordered: false, text: "b1", spans: [] },
			{ kind: "list-item", depth: 2, ordered: false, text: "b2", spans: [] },
			{ kind: "list-item", depth: 0, ordered: false, text: "c", spans: [] },
			{ kind: "list-item", depth: 0, ordered: true, text: "first", spans: [] },
			{
				kind: "list-item",
				depth: 0,
				ordered: true,
				text: "second continued",
				spans: [],
			},
			{ kind: "list-item", depth: 0, ordered: true, text: "third", spans: [] },
		]);
	});

	it("maps block quotes, including nested markers, to quote blocks", async () => {
		const blocks = blocksOf(
			await md("> first line\n> still first\n>\n> second\n>> nested"),
		);
		expect(blocks.map((b) => b.kind)).toEqual(["quote", "quote", "quote"]);
		expect(
			textsOf(await md("> first line\n> still first\n>\n> second\n>> nested")),
		).toEqual(["first line still first", "second", "nested"]);
	});

	it("keeps fenced code verbatim in one code block and drops the info string", async () => {
		const blocks = blocksOf(
			await md(
				"```ts\nconst a = 1;\n  if (a)   { b(); }\n```\n\nafter\n\n~~~\ntilde\n~~~",
			),
		);
		expect(blocks).toEqual([
			{ kind: "code", text: "const a = 1;\n  if (a)   { b(); }", spans: [] },
			{ kind: "paragraph", text: "after", spans: [] },
			{ kind: "code", text: "tilde", spans: [] },
		]);
	});

	it("runs an unclosed fence to the end of the file", async () => {
		const blocks = blocksOf(await md("```\nline one\nline two"));
		expect(blocks).toEqual([
			{ kind: "code", text: "line one\nline two", spans: [] },
		]);
	});

	it("maps indented code after a blank line but not a paragraph continuation", async () => {
		const blocks = blocksOf(
			await md("para\n    still para\n\n    code here\n    more"),
		);
		expect(blocks[0]).toMatchObject({
			kind: "paragraph",
			text: "para still para",
		});
		expect(blocks[1]).toMatchObject({ kind: "code", text: "code here\nmore" });
	});

	it("drops horizontal rules", async () => {
		expect(textsOf(await md("a\n\n---\n\n***\n\n___\n\nb"))).toEqual([
			"a",
			"b",
		]);
	});

	it("maps pipe tables to one table-text block per row, skipping the delimiter row", async () => {
		const blocks = blocksOf(
			await md("| Name | Qty |\n| --- | ---: |\n| Apple | 3 |\n| Pear | 5 |"),
		);
		expect(blocks.map((b) => b.kind)).toEqual([
			"table-text",
			"table-text",
			"table-text",
		]);
		expect(
			textsOf(await md("| Name | Qty |\n| --- | ---: |\n| Apple | 3 |")),
		).toEqual(["Name Qty", "Apple 3"]);
	});

	it("maps a lone image to a placeholder that keeps only alt text", async () => {
		const blocks = blocksOf(
			await md("![A red barn](https://evil.example/barn.png)"),
		);
		expect(blocks).toEqual([{ kind: "image-placeholder", alt: "A red barn" }]);
		expect(JSON.stringify(blocks)).not.toContain("evil.example");
	});

	it("turns an inline image into its alt text", async () => {
		expect(
			textsOf(await md("See ![the map](data:image/png;base64,AAAA) below.")),
		).toEqual(["See the map below."]);
	});

	it("drops link reference definitions", async () => {
		expect(textsOf(await md("[x]: https://example.com/\n\nBody"))).toEqual([
			"Body",
		]);
	});
});

describe("markdown: inline spans", () => {
	it("maps emphasis and strong to spans over the cleaned text", async () => {
		const [block] = blocksOf(await md("Hello *world* and **strong** done"));
		expect(block).toMatchObject({
			text: "Hello world and strong done",
			spans: [
				{ kind: "emphasis", start: 6, end: 11 },
				{ kind: "strong", start: 16, end: 22 },
			],
		});
	});

	it("accepts underscores, and both marks together", async () => {
		const [a] = blocksOf(await md("an _em_ and __st__"));
		expect(a).toMatchObject({
			text: "an em and st",
			spans: [
				{ kind: "emphasis", start: 3, end: 5 },
				{ kind: "strong", start: 10, end: 12 },
			],
		});
		const [b] = blocksOf(await md("***both***"));
		expect(b).toMatchObject({ text: "both" });
		const kinds = (b && "spans" in b ? b.spans : []).map((s) => s.kind).sort();
		expect(kinds).toEqual(["emphasis", "strong"]);
	});

	it("nests emphasis inside strong", async () => {
		const [block] = blocksOf(await md("**bold *and em* bold**"));
		expect(block).toMatchObject({
			text: "bold and em bold",
			spans: [
				{ kind: "strong", start: 0, end: 16 },
				{ kind: "emphasis", start: 5, end: 11 },
			],
		});
	});

	it("leaves unmatched marks, spaced stars and intraword underscores literal", async () => {
		expect(
			textsOf(await md("2 * 3 * 4 and snake_case_name and *dangling")),
		).toEqual(["2 * 3 * 4 and snake_case_name and *dangling"]);
		const [block] = blocksOf(await md("2 * 3 * 4 snake_case_name"));
		expect(block).toMatchObject({ spans: [] });
	});

	it("maps links to link spans and keeps the label", async () => {
		const [block] = blocksOf(
			await md(
				'Read [the docs](https://example.com/a?b=1 "Title") now, or [mail](mailto:a@b.co).',
			),
		);
		expect(block).toMatchObject({
			text: "Read the docs now, or mail.",
			spans: [
				{ kind: "link", start: 5, end: 13, href: "https://example.com/a?b=1" },
				{ kind: "link", start: 22, end: 26, href: "mailto:a@b.co" },
			],
		});
	});

	it("resolves reference links and autolinks", async () => {
		const [block] = blocksOf(
			await md(
				"See [the site][s] or <https://example.org/x>.\n\n[s]: https://example.com/",
			),
		);
		expect(block).toMatchObject({
			text: "See the site or https://example.org/x.",
			spans: [
				{ kind: "link", start: 4, end: 12, href: "https://example.com/" },
				{ kind: "link", start: 16, end: 37, href: "https://example.org/x" },
			],
		});
	});

	it("drops the link span, not the text, for dangerous or unknown schemes", async () => {
		for (const href of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			"&#106;avascript:alert(1)",
			"data:text/html,<b>x</b>",
			"vbscript:x",
			"file:///etc/passwd",
		]) {
			const [block] = blocksOf(await md(`[click](${href}) end`));
			expect(block, href).toMatchObject({ text: "click end", spans: [] });
		}
	});

	it("keeps relative and fragment links", async () => {
		const [block] = blocksOf(await md("[a](#top) [b](/x/y) [c](page.html)"));
		const hrefs = (block && "spans" in block ? block.spans : []).map((s) =>
			s.kind === "link" ? s.href : "",
		);
		expect(hrefs).toEqual(["#top", "/x/y", "page.html"]);
	});

	it("unwraps inline code without a span and keeps its content literal", async () => {
		const [block] = blocksOf(await md("run `a *b* c` now and ``x ` y``"));
		expect(block).toMatchObject({
			text: "run a *b* c now and x ` y",
			spans: [],
		});
	});

	it("handles backslash escapes and HTML entities", async () => {
		expect(
			textsOf(
				await md(
					"\\*not em\\* &amp; &lt;b&gt; &#65;&#x42; &copy; &#1114112; &#0; &bogus;",
				),
			),
		).toEqual(["*not em* & <b> AB © &#1114112; &#0; &bogus;"]);
	});

	it("strips raw HTML tags from text", async () => {
		const [text] = textsOf(
			await md("a <b>bold</b> <script>alert(1)</script> <br/> z"),
		);
		expect(text).not.toMatch(/[<>]/);
		expect(text).toContain("bold");
	});

	it("keeps spans inside list items, headings and quotes", async () => {
		const blocks = blocksOf(await md("# A *b*\n\n- x **y**\n\n> p _q_"));
		for (const block of blocks) {
			expect("spans" in block && block.spans.length).toBe(1);
		}
	});
});

describe("markdown: metadata", () => {
	it("reads title and language from front matter and removes it from the text", async () => {
		const result = expectSuccess(
			await md(
				'---\ntitle: "Der Prozess"\nlang: de\n---\n\nEs war einmal ein Mann.',
			),
		);
		expect(result.title).toBe("Der Prozess");
		expect(result.language).toMatchObject({ code: "de", source: "metadata" });
		expect(result.document.blocks).toHaveLength(1);
		expect(result.format).toBe("markdown");
	});

	it("falls back to the first heading, then the file name, for the title", async () => {
		expect(expectSuccess(await md("# The Heading\n\nbody")).title).toBe(
			"The Heading",
		);
		expect(
			expectSuccess(await md("just body", "my-notes.markdown")).title,
		).toBe("my-notes");
	});

	it("ignores an unterminated front matter block", async () => {
		expect(textsOf(await md("---\ntitle: x\nbody"))).toEqual(["title: x body"]);
	});

	it("returns empty for a document with only a front matter block or only rules", async () => {
		expectError(await md("---\ntitle: x\n---\n"), "empty");
		expectError(await md("---\n\n***\n"), "empty");
	});

	it("decodes Markdown bytes with the same BOM and codepage rules as text", async () => {
		const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("# Héllo")]);
		expect(textsOf(await parse(bom, "a.md"))).toEqual(["Héllo"]);
	});
});
