import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import { blocksOf, expectError, expectSuccess, textsOf, utf8 } from "./helpers";
import {
	BOLD,
	cell,
	h,
	ITALIC,
	image,
	link,
	list,
	listStyle,
	odt,
	p,
	row,
	span,
	table,
	textStyle,
} from "./odt-builder";
import { zip } from "./zip";

const read = (bytes: Uint8Array, name = "doc.odt") => parse(bytes, name);

describe("odt: headings, paragraphs and inline marks", () => {
	it("maps text:h with its outline level, clamped to 1..6", async () => {
		const bytes = odt({
			body:
				h("One", 1) +
				h("Three", 3) +
				h("Nine", 9) +
				h("Unleveled", null) +
				p("Body text."),
		});
		const blocks = blocksOf(await read(bytes));
		expect(blocks).toEqual([
			{ kind: "heading", level: 1, text: "One", spans: [] },
			{ kind: "heading", level: 3, text: "Three", spans: [] },
			{ kind: "heading", level: 6, text: "Nine", spans: [] },
			{ kind: "heading", level: 1, text: "Unleveled", spans: [] },
			{ kind: "paragraph", text: "Body text.", spans: [] },
		]);
	});

	it("maps bold and italic automatic styles to strong and emphasis spans", async () => {
		const bytes = odt({
			automatic:
				textStyle("T1", BOLD) +
				textStyle("T2", ITALIC) +
				textStyle("T3", `${BOLD} ${ITALIC}`),
			body: p(
				`plain ${span("T1", "heavy")} then ${span("T2", "slanted")} and ${span("T3", "both")}.`,
			),
		});
		const [block] = blocksOf(await read(bytes));
		expect(block).toMatchObject({
			kind: "paragraph",
			text: "plain heavy then slanted and both.",
		});
		const spans = (block as { spans: unknown[] }).spans;
		expect(spans).toEqual(
			expect.arrayContaining([
				{ kind: "strong", start: 6, end: 11 },
				{ kind: "emphasis", start: 17, end: 24 },
				{ kind: "strong", start: 29, end: 33 },
				{ kind: "emphasis", start: 29, end: 33 },
			]),
		);
		expect(spans).toHaveLength(4);
	});

	it("follows named and parent styles, and the encoded names LibreOffice writes", async () => {
		const bytes = odt({
			named:
				textStyle("Strong_20_Emphasis", BOLD, { display: "Strong Emphasis" }) +
				textStyle("Emphasis", ITALIC),
			automatic: textStyle("T1", "", { parent: "Strong_20_Emphasis" }),
			body: p(
				`a ${span("T1", "inherits bold")} b ${span("Emphasis", "named italic")}`,
			),
		});
		const [block] = blocksOf(await read(bytes));
		expect((block as { spans: unknown[] }).spans).toEqual([
			{ kind: "strong", start: 2, end: 15 },
			{ kind: "emphasis", start: 18, end: 30 },
		]);
	});

	it("survives a style that is its own ancestor", async () => {
		const bytes = odt({
			automatic:
				textStyle("A", "", { parent: "B" }) +
				textStyle("B", "", { parent: "A" }),
			body: p(`x ${span("A", "loop")}`),
		});
		expect(textsOf(await read(bytes))).toEqual(["x loop"]);
	});

	it("keeps safe links and drops script and data targets", async () => {
		const bytes = odt({
			body: p(
				`${link("https://example.org/a", "good")} ${link("javascript:alert(1)", "bad")} ${link("data:text/html;base64,AAAA", "worse")} ${link("mailto:a@example.org", "mail")}`,
			),
		});
		const [block] = blocksOf(await read(bytes));
		expect((block as { text: string }).text).toBe("good bad worse mail");
		expect((block as { spans: unknown[] }).spans).toEqual([
			{ kind: "link", start: 0, end: 4, href: "https://example.org/a" },
			{ kind: "link", start: 16, end: 20, href: "mailto:a@example.org" },
		]);
	});

	it("collapses source whitespace and reads text:s, text:tab and text:line-break as spaces", async () => {
		const bytes = odt({
			body: '<text:p text:style-name="x">  one \n   two<text:s text:c="3"/>three<text:tab/>four<text:line-break/>five  </text:p>',
		});
		expect(textsOf(await read(bytes))).toEqual(["one two three four five"]);
	});

	it("does not let a huge text:s count allocate", async () => {
		const bytes = odt({
			body: p('a<text:s text:c="999999999999"/>b'),
		});
		const [text] = textsOf(await read(bytes));
		expect(text?.length ?? 0).toBeLessThan(10);
		expect(text).toMatch(/^a\s+b$/);
	});

	it("decodes entities in content", async () => {
		const bytes = odt({
			body: "<text:p>Fish &amp;amp; chips &lt;3 &#233;</text:p>",
		});
		const [text] = textsOf(await read(bytes));
		expect(text).toBe("Fish &amp; chips <3 é");
	});
});

describe("odt: lists, tables, quotes, code and images", () => {
	it("maps lists with depth and the ordered flag from the list style", async () => {
		const bytes = odt({
			automatic:
				listStyle("L1", ["bullet", "bullet"]) +
				listStyle("L2", ["number", "bullet"]),
			body:
				list("L1", p("top", "P1") + list(null, p("child", "P1"))) +
				list(
					"L2",
					p("first", "P1") +
						list(null, p("inner", "P1")) +
						p("second item continues", "P1"),
				),
		});
		const blocks = blocksOf(await read(bytes));
		expect(blocks).toEqual([
			{ kind: "list-item", depth: 0, ordered: false, text: "top", spans: [] },
			{ kind: "list-item", depth: 1, ordered: false, text: "child", spans: [] },
			{ kind: "list-item", depth: 0, ordered: true, text: "first", spans: [] },
			{ kind: "list-item", depth: 1, ordered: true, text: "inner", spans: [] },
			{
				kind: "list-item",
				depth: 0,
				ordered: true,
				text: "second item continues",
				spans: [],
			},
		]);
	});

	it("reads a heading inside a list item as a heading", async () => {
		const bytes = odt({ body: list(null, h("Numbered heading", 2)) });
		expect(blocksOf(await read(bytes))).toEqual([
			{ kind: "heading", level: 2, text: "Numbered heading", spans: [] },
		]);
	});

	it("turns each table row into one table-text block, cells joined by a space", async () => {
		const bytes = odt({
			body: table(
				row("Pier", "Time"),
				row(
					"North",
					cell(
						p("06:00", "Table_20_Contents") + p("daily", "Table_20_Contents"),
					),
				),
			),
		});
		expect(blocksOf(await read(bytes))).toEqual([
			{ kind: "table-text", text: "Pier Time", spans: [] },
			{ kind: "table-text", text: "North 06:00 daily", spans: [] },
		]);
	});

	it("maps Quotations, Preformatted Text (merged lines) and Caption styles", async () => {
		const bytes = odt({
			named:
				textStyle("Quotations", "", { family: "paragraph" }) +
				textStyle("Preformatted_20_Text", "", { family: "paragraph" }) +
				textStyle("Caption", "", { family: "paragraph" }),
			automatic: textStyle("P7", "", {
				family: "paragraph",
				parent: "Preformatted_20_Text",
			}),
			body:
				p("Said the tide.", "Quotations") +
				p("line one", "Preformatted_20_Text") +
				p("line two", "P7") +
				p("A plain paragraph.") +
				p("Figure 1: the pier", "Caption"),
		});
		expect(blocksOf(await read(bytes))).toEqual([
			{ kind: "quote", text: "Said the tide.", spans: [] },
			{ kind: "code", text: "line one\nline two", spans: [] },
			{ kind: "paragraph", text: "A plain paragraph.", spans: [] },
			{ kind: "caption", text: "Figure 1: the pier", spans: [] },
		]);
	});

	it("makes an image a placeholder with its alt text and keeps no source", async () => {
		const bytes = odt({
			body: p("Before.") + p(image("A small ferry")) + p(image("")),
			extra: [{ name: "Pictures/a.png", data: "PNGBYTES" }],
		});
		const blocks = blocksOf(await read(bytes));
		expect(blocks[0]).toMatchObject({ kind: "paragraph", text: "Before." });
		expect(blocks[1]).toEqual({
			kind: "image-placeholder",
			alt: "A small ferry",
		});
		expect(JSON.stringify(blocks)).not.toMatch(/Pictures|PNGBYTES|xlink/);
	});
});

describe("odt: what is left out", () => {
	it("leaves out footnotes, comments, tracked deletions, hidden text, indexes and text boxes", async () => {
		const body =
			"<text:tracked-changes><text:changed-region><text:deletion><text:p>DELETED PARAGRAPH</text:p></text:deletion></text:changed-region></text:tracked-changes>" +
			"<text:table-of-content><text:index-body><text:p>TOC ENTRY ........ 3</text:p></text:index-body></text:table-of-content>" +
			p(
				'Kept text<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>FOOTNOTE BODY</text:p></text:note-body></text:note>' +
					"<office:annotation><dc:creator>Someone</dc:creator><text:p>COMMENT BODY</text:p></office:annotation>" +
					'<text:span text:style-name="Hid">HIDDEN WORDS</text:span> end.',
			) +
			'<text:p text:style-name="Standard"><draw:frame><draw:text-box><text:p>TEXT BOX BODY</text:p></draw:text-box></draw:frame>After box.</text:p>' +
			"<text:p>Page <text:page-number>7</text:page-number> of <text:page-count>9</text:page-count></text:p>" +
			"<office:forms><text:p>FORM</text:p></office:forms>" +
			"<office:scripts><text:p>SCRIPT</text:p></office:scripts>";
		const bytes = odt({
			automatic: `<style:style style:name="Hid" style:family="text"><style:text-properties text:display="none"/></style:style>`,
			body,
		});
		const result = await read(bytes);
		const joined = textsOf(result).join("|");
		expect(joined).toContain("Kept text");
		expect(joined).toContain("After box.");
		expect(joined).not.toMatch(
			/DELETED|TOC ENTRY|FOOTNOTE|COMMENT|Someone|HIDDEN|TEXT BOX|FORM|SCRIPT|PAGE HEADER/,
		);
	});

	it("reads only the body: not headers from the styles part", async () => {
		const result = await read(odt({ body: p("Body only") }));
		expect(textsOf(result)).toEqual(["Body only"]);
	});
});

describe("odt: title, language and format", () => {
	it("takes the title from meta.xml and falls back to the file name", async () => {
		const titled = expectSuccess(
			await read(odt({ body: p("x"), title: "Meta Title" })),
		);
		expect(titled.title).toBe("Meta Title");
		const plain = expectSuccess(
			await read(odt({ body: p("x") }), "Field Notes.odt"),
		);
		expect(plain.title).toBe("Field Notes");
	});

	it("reports odt with no text encoding and decides the language from the text", async () => {
		const result = expectSuccess(
			await read(
				odt({
					title: "T",
					language: "fr",
					body: p(
						"The ferry leaves at six and returns at nine, and the weather is good for all of the people.",
					),
				}),
			),
		);
		expect(result.format).toBe("odt");
		expect(result.encoding).toBeNull();
		expect(result.language.code).toBe("en");
	});
});

describe("odt: files that are not readable text documents", () => {
	it("returns drm for a password-protected document", async () => {
		const bytes = odt({
			body: p("scrambled"),
			manifest: [{ path: "content.xml", encrypted: true }],
		});
		const error = expectError(await read(bytes), "drm");
		expect(error.message).toMatch(/password/i);
	});

	it("reads a document where only an unrelated part is encrypted", async () => {
		const bytes = odt({
			body: p("fine"),
			manifest: [
				{ path: "content.xml" },
				{ path: "Pictures/a.png", encrypted: true },
			],
		});
		expect(textsOf(await read(bytes))).toEqual(["fine"]);
	});

	it("says a spreadsheet or presentation named .odt is not supported", async () => {
		for (const mimetype of [
			"application/vnd.oasis.opendocument.spreadsheet",
			"application/vnd.oasis.opendocument.presentation",
		]) {
			expectError(await read(odt({ body: p("x"), mimetype })), "unsupported");
		}
	});

	it("says a DOCX named .odt, a ZIP without content.xml and non-ZIP bytes are not supported", async () => {
		expectError(
			await read(
				zip([
					{ name: "[Content_Types].xml", data: "<Types/>" },
					{ name: "word/document.xml", data: "<w:document/>" },
				]),
			),
			"unsupported",
		);
		expectError(await read(odt({ noContent: true })), "unsupported");
		expectError(await read(utf8("plain text, not an archive")), "unsupported");
		expectError(await read(zip([{ name: "a.txt", data: "a" }])), "unsupported");
	});

	it("says a document with no text is empty", async () => {
		expectError(await read(odt({ body: `${p("   ")}<text:p/>` })), "empty");
	});

	it("reads content.xml even when the mimetype entry is missing", async () => {
		const bytes = odt({ body: p("no mimetype"), mimetype: null });
		expect(textsOf(await read(bytes))).toEqual(["no mimetype"]);
	});

	it("reads a document written without any automatic-styles element", async () => {
		const raw = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>bare</text:p></office:text></office:body></office:document-content>`;
		expect(textsOf(await read(odt({ rawContent: raw })))).toEqual(["bare"]);
	});
});
