import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import {
	cell,
	coreXml,
	docx,
	link,
	listItem,
	numberingXml,
	para,
	relationships,
	row,
	run,
	styled,
	stylesXml,
	table,
} from "./docx-builder";
import { blocksOf, expectError, expectSuccess, textsOf } from "./helpers";
import { zip } from "./zip";

const read = (parts: Parameters<typeof docx>[0], name = "doc.docx") =>
	parse(docx(parts), name);

const STYLES = stylesXml([
	{ id: "Heading1", name: "heading 1" },
	{ id: "Kop2", name: "Heading 2" },
	{ id: "Subhead", name: "Subhead", basedOn: "Kop2" },
	{ id: "Chain", name: "Chain", basedOn: "Subhead" },
	{ id: "Odd", name: "Odd", outline: 3 },
	{ id: "TitleStyle", name: "Title" },
	{ id: "Quote", name: "Quote" },
	{ id: "Intense", name: "Intense Quote" },
	{ id: "BlockQuotation", name: "Block Quotation" },
	{ id: "SourceCode", name: "Source Code" },
	{ id: "Caption", name: "caption" },
	{ id: "Strong", name: "Strong", type: "character", props: "<w:b/>" },
	{ id: "Em", name: "Emphasis", type: "character", props: "<w:i/>" },
	{ id: "Loud", name: "Loud", type: "character", props: "<w:b/><w:i/>" },
	{ id: "ListBullet", name: "List Bullet", numId: 3 },
]);

const NUMBERING = numberingXml(
	{
		0: ["bullet", "bullet", "bullet"],
		1: ["decimal", "lowerLetter", "lowerRoman"],
		2: ["none"],
	},
	{ 1: 0, 2: 1, 3: 0, 4: 2 },
);

describe("docx: headings", () => {
	it("maps Heading 1 to 6 by style name, whatever the style id is", async () => {
		const blocks = blocksOf(
			await read({
				styles: STYLES,
				body: [
					styled("Heading1", "One"),
					styled("Kop2", "Two"),
					styled("TitleStyle", "The Title"),
				].join(""),
			}),
		);
		expect(blocks).toEqual([
			{ kind: "heading", level: 1, text: "One", spans: [] },
			{ kind: "heading", level: 2, text: "Two", spans: [] },
			{ kind: "heading", level: 1, text: "The Title", spans: [] },
		]);
	});

	it("follows basedOn chains to a heading style", async () => {
		const blocks = blocksOf(
			await read({
				styles: STYLES,
				body: styled("Subhead", "Sub") + styled("Chain", "Deeper"),
			}),
		);
		expect(blocks.map((b) => b.kind)).toEqual(["heading", "heading"]);
		expect(blocks.map((b) => (b.kind === "heading" ? b.level : 0))).toEqual([
			2, 2,
		]);
	});

	it("uses a style's outline level when its name says nothing", async () => {
		const [block] = blocksOf(
			await read({ styles: STYLES, body: styled("Odd", "Outlined") }),
		);
		expect(block).toMatchObject({ kind: "heading", level: 4 });
	});

	it("reads the default style ids when there is no styles part", async () => {
		const blocks = blocksOf(
			await read({
				body: styled("Heading1", "Big") + styled("Heading6", "Small"),
			}),
		);
		expect(blocks).toMatchObject([
			{ kind: "heading", level: 1 },
			{ kind: "heading", level: 6 },
		]);
	});

	it("keeps heading levels in 1 to 6 even for Heading 9", async () => {
		const [block] = blocksOf(
			await read({
				styles: stylesXml([{ id: "Heading9", name: "heading 9" }]),
				body: styled("Heading9", "Deep"),
			}),
		);
		expect(block?.kind).not.toBe("heading");
	});
});

describe("docx: lists", () => {
	it("maps bullets and numbers with their depth", async () => {
		const blocks = blocksOf(
			await read({
				numbering: NUMBERING,
				body: [
					listItem(1, 0, "bullet one"),
					listItem(1, 1, "nested"),
					listItem(1, 2, "deeper"),
					listItem(2, 0, "first"),
					listItem(2, 1, "sub"),
				].join(""),
			}),
		);
		expect(blocks).toEqual([
			{ kind: "list-item", depth: 0, ordered: false, text: "bullet one", spans: [] },
			{ kind: "list-item", depth: 1, ordered: false, text: "nested", spans: [] },
			{ kind: "list-item", depth: 2, ordered: false, text: "deeper", spans: [] },
			{ kind: "list-item", depth: 0, ordered: true, text: "first", spans: [] },
			{ kind: "list-item", depth: 1, ordered: true, text: "sub", spans: [] },
		]);
	});

	it("treats numId 0 and a format of none as a plain paragraph", async () => {
		const blocks = blocksOf(
			await read({
				numbering: NUMBERING,
				body: listItem(0, 0, "not a list") + listItem(4, 0, "also not"),
			}),
		);
		expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
	});

	it("reads a list that comes from a paragraph style", async () => {
		const [block] = blocksOf(
			await read({
				styles: STYLES,
				numbering: NUMBERING,
				body: styled("ListBullet", "Styled bullet"),
			}),
		);
		expect(block).toEqual({
			kind: "list-item",
			depth: 0,
			ordered: false,
			text: "Styled bullet",
			spans: [],
		});
	});

	it("makes an unordered item when the numbering part is missing", async () => {
		const [block] = blocksOf(await read({ body: listItem(7, 1, "orphan") }));
		expect(block).toMatchObject({ kind: "list-item", depth: 1, ordered: false });
	});

	it("caps a list level that is out of range", async () => {
		const [block] = blocksOf(
			await read({ numbering: NUMBERING, body: listItem(1, 99, "far") }),
		);
		expect(block).toMatchObject({ kind: "list-item" });
		if (block?.kind === "list-item") {
			expect(block.depth).toBeLessThanOrEqual(8);
		}
	});
});

describe("docx: quotes, code and captions", () => {
	it("maps the quote styles Word and LibreOffice use", async () => {
		const blocks = blocksOf(
			await read({
				styles: STYLES,
				body:
					styled("Quote", "one") +
					styled("Intense", "two") +
					styled("BlockQuotation", "three"),
			}),
		);
		expect(blocks.map((b) => b.kind)).toEqual(["quote", "quote", "quote"]);
	});

	it("maps source code and caption styles", async () => {
		const blocks = blocksOf(
			await read({
				styles: STYLES,
				body: styled("SourceCode", "let x = 1;") + styled("Caption", "Figure 1"),
			}),
		);
		expect(blocks.map((b) => b.kind)).toEqual(["code", "caption"]);
	});
});

describe("docx: tables", () => {
	it("makes one table-text block per row with the cells separated by a space", async () => {
		const outcome = await read({
			body: table(row("Month", "Ships"), row("March", "14")),
		});
		expect(blocksOf(outcome)).toEqual([
			{ kind: "table-text", text: "Month Ships", spans: [] },
			{ kind: "table-text", text: "March 14", spans: [] },
		]);
	});

	it("skips empty and merged cells and joins paragraphs in a cell", async () => {
		const outcome = await read({
			body: table(
				row(
					cell(para("One") + para("two")),
					cell(para("")),
					cell(para("three")),
				),
			),
		});
		expect(textsOf(outcome)).toEqual(["One two three"]);
	});

	it("keeps emphasis and links inside a cell at the right offsets", async () => {
		const [block] = blocksOf(
			await read({
				rels: relationships([link("rId9", "https://example.com/")]),
				body: table(
					row(
						"Plain",
						cell(
							para(
								run("bold", "<w:b/>") +
									'<w:hyperlink r:id="rId9">' +
									run("site") +
									"</w:hyperlink>",
							),
						),
					),
				),
			}),
		);
		expect(block).toMatchObject({
			kind: "table-text",
			text: "Plain boldsite",
			spans: [
				{ kind: "strong", start: 6, end: 10 },
				{ kind: "link", start: 10, end: 14, href: "https://example.com/" },
			],
		});
	});

	it("folds a nested table into the cell that holds it", async () => {
		const inner = table(row("x", "y"), row("z"));
		const outcome = await read({
			body: table(row(cell(para("A") + inner), "B")) + para("After"),
		});
		expect(textsOf(outcome)).toEqual(["A x y z B", "After"]);
	});

	it("puts an image from a cell after the row", async () => {
		const drawing = `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="p" descr="in a cell"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
		const blocks = blocksOf(
			await read({ body: table(row("Cell", cell(para(drawing)))) }),
		);
		expect(blocks).toEqual([
			{ kind: "table-text", text: "Cell", spans: [] },
			{ kind: "image-placeholder", alt: "in a cell" },
		]);
	});
});

describe("docx: inline emphasis", () => {
	it("maps bold and italic runs to spans over the right offsets", async () => {
		const [block] = blocksOf(
			await read({
				body: para(
					run("Some ") +
						run("bold", "<w:b/>") +
						run(" and ") +
						run("italic", "<w:i/>") +
						run(" text"),
				),
			}),
		);
		expect(block).toEqual({
			kind: "paragraph",
			text: "Some bold and italic text",
			spans: [
				{ kind: "strong", start: 5, end: 9 },
				{ kind: "emphasis", start: 14, end: 20 },
			],
		});
	});

	it("merges runs that Word split in the middle of a bold word", async () => {
		const [block] = blocksOf(
			await read({
				body: para(
					run("a ") +
						run("bo", "<w:b/>") +
						run("ld", "<w:b/>") +
						run("er", '<w:b w:val="1"/>') +
						run(" b"),
				),
			}),
		);
		expect(block).toMatchObject({
			text: "a bolder b",
			spans: [{ kind: "strong", start: 2, end: 8 }],
		});
	});

	it("honours switched-off bold and italic", async () => {
		const [block] = blocksOf(
			await read({
				body: para(
					run("a", '<w:b w:val="0"/>') +
						run("b", '<w:i w:val="false"/>') +
						run("c", '<w:b w:val="off"/><w:i w:val="0"/>'),
				),
			}),
		);
		expect(block).toMatchObject({ text: "abc", spans: [] });
	});

	it("reads character styles that carry bold or italic", async () => {
		const [block] = blocksOf(
			await read({
				styles: STYLES,
				body: para(
					run("s", '<w:rStyle w:val="Strong"/>') +
						run("e", '<w:rStyle w:val="Em"/>') +
						run("l", '<w:rStyle w:val="Loud"/>'),
				),
			}),
		);
		expect(block).toMatchObject({
			text: "sel",
			spans: expect.arrayContaining([
				{ kind: "strong", start: 0, end: 1 },
				{ kind: "emphasis", start: 1, end: 2 },
				{ kind: "strong", start: 2, end: 3 },
				{ kind: "emphasis", start: 2, end: 3 },
			]),
		});
	});

	it("reads complex-script bold and italic on right-to-left runs", async () => {
		const [block] = blocksOf(
			await read({
				body: para(
					run("שלום ") +
						run("עולם", "<w:bCs/><w:rtl/>") +
						run(" טוב", "<w:iCs/><w:rtl/>"),
				),
			}),
		);
		expect(block).toMatchObject({
			spans: [
				{ kind: "strong", start: 5, end: 9 },
				{ kind: "emphasis", start: 9, end: 13 },
			],
		});
	});

	it("counts offsets in UTF-16 units after astral characters", async () => {
		const [block] = blocksOf(
			await read({
				body: para(run("😀 ") + run("bold", "<w:b/>")),
			}),
		);
		expect(block).toMatchObject({
			text: "😀 bold",
			spans: [{ kind: "strong", start: 3, end: 7 }],
		});
	});

	it("drops a span that covers only spaces and trims edge spaces", async () => {
		const [block] = blocksOf(
			await read({
				body: para(
					run("a") + run("   ", "<w:b/>") + run(" word ", "<w:i/>") + run("z"),
				),
			}),
		);
		expect(block).toMatchObject({
			text: "a word z",
			spans: [{ kind: "emphasis", start: 2, end: 6 }],
		});
	});
});

describe("docx: links", () => {
	const rels = relationships([
		link("rId10", "https://example.com/a?x=1&y=2"),
		link("rId11", "mailto:me@example.com"),
		link("rId12", "javascript:alert(1)"),
		link("rId13", "data:text/html;base64,PHNjcmlwdD4="),
		link("rId14", " JaVa\tScRiPt:alert(1)"),
	]);

	it("resolves hyperlink relationships to link spans", async () => {
		const [block] = blocksOf(
			await read({
				rels,
				body: para(
					run("See ") +
						'<w:hyperlink r:id="rId10">' +
						run("the page") +
						"</w:hyperlink>" +
						run(" or ") +
						'<w:hyperlink r:id="rId11">' +
						run("mail me") +
						"</w:hyperlink>",
				),
			}),
		);
		expect(block).toMatchObject({
			text: "See the page or mail me",
			spans: [
				{ kind: "link", start: 4, end: 12, href: "https://example.com/a?x=1&y=2" },
				{ kind: "link", start: 16, end: 23, href: "mailto:me@example.com" },
			],
		});
	});

	it("keeps the text but drops script-capable and unknown schemes", async () => {
		const [block] = blocksOf(
			await read({
				rels,
				body: para(
					'<w:hyperlink r:id="rId12">' +
						run("one ") +
						"</w:hyperlink>" +
						'<w:hyperlink r:id="rId13">' +
						run("two ") +
						"</w:hyperlink>" +
						'<w:hyperlink r:id="rId14">' +
						run("three") +
						"</w:hyperlink>",
				),
			}),
		);
		expect(block).toMatchObject({ text: "one two three", spans: [] });
	});

	it("keeps the text of an internal anchor or an unknown relationship without a link", async () => {
		const [block] = blocksOf(
			await read({
				rels,
				body: para(
					'<w:hyperlink w:anchor="_Toc1">' +
						run("jump ") +
						"</w:hyperlink>" +
						'<w:hyperlink r:id="rId99">' +
						run("lost") +
						"</w:hyperlink>",
				),
			}),
		);
		expect(block).toMatchObject({ text: "jump lost", spans: [] });
	});

	it("reads HYPERLINK in a simple field and in a complex field", async () => {
		const [block] = blocksOf(
			await read({
				body: para(
					'<w:fldSimple w:instr=" HYPERLINK &quot;https://simple.example/&quot; ">' +
						run("simple") +
						"</w:fldSimple>" +
						run(" ") +
						'<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
						'<w:r><w:instrText xml:space="preserve"> HYPERLINK "https://complex.example/" </w:instrText></w:r>' +
						'<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
						run("complex") +
						'<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
						run(" end"),
				),
			}),
		);
		expect(block).toMatchObject({
			text: "simple complex end",
			spans: [
				{ kind: "link", start: 0, end: 6, href: "https://simple.example/" },
				{ kind: "link", start: 7, end: 14, href: "https://complex.example/" },
			],
		});
	});

	it("does not print field instructions as text", async () => {
		const outcome = await read({
			body: para(
				run("Page ") +
					'<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
					'<w:r><w:instrText> PAGE </w:instrText></w:r>' +
					'<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
					run("3") +
					'<w:r><w:fldChar w:fldCharType="end"/></w:r>',
			),
		});
		expect(textsOf(outcome)).toEqual(["Page 3"]);
	});
});

describe("docx: text details", () => {
	it("turns tabs and breaks into spaces and collapses runs of spaces", async () => {
		const outcome = await read({
			body: para(
				run("one") +
					"<w:r><w:tab/></w:r>" +
					run("two") +
					"<w:r><w:br/></w:r>" +
					run("  three   four"),
			),
		});
		expect(textsOf(outcome)).toEqual(["one two three four"]);
	});

	it("reads no-break hyphens, drops soft hyphens and unknown symbols", async () => {
		const outcome = await read({
			body: para(
				run("well") +
					"<w:r><w:noBreakHyphen/></w:r>" +
					run("known co") +
					"<w:r><w:softHyphen/></w:r>" +
					run("operate") +
					'<w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r>',
			),
		});
		expect(textsOf(outcome)).toEqual(["well-known cooperate"]);
	});

	it("decodes the XML entities and character references", async () => {
		const outcome = await read({
			rawDocument: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>a &amp; b &lt;c&gt; &quot;d&quot; &#x1F600; &#233;</w:t></w:r></w:p></w:body></w:document>`,
		});
		expect(textsOf(outcome)).toEqual(['a & b <c> "d" 😀 é']);
	});

	it("drops empty paragraphs", async () => {
		const outcome = await read({
			body: para("") + para("   ") + para("kept") + para(""),
		});
		expect(textsOf(outcome)).toEqual(["kept"]);
	});

	it("leaves deleted, hidden and fallback text out, and keeps insertions", async () => {
		const outcome = await read({
			body: [
				para(
					run("keep ") +
						'<w:del w:id="1"><w:r><w:delText>deleted</w:delText></w:r></w:del>' +
						'<w:ins w:id="2">' +
						run("inserted ") +
						"</w:ins>" +
						run("hidden ", "<w:vanish/>") +
						run("tail"),
				),
				para(
					"<mc:AlternateContent><mc:Choice Requires=\"wps\">" +
						run("choice") +
						"</mc:Choice><mc:Fallback>" +
						run("fallback") +
						"</mc:Fallback></mc:AlternateContent>",
				),
			].join(""),
		});
		expect(textsOf(outcome)).toEqual(["keep inserted tail", "choice"]);
	});

	it("reads content controls and smart tags but not text boxes", async () => {
		const outcome = await read({
			body: [
				"<w:sdt><w:sdtPr/><w:sdtContent>" + para("in a control") + "</w:sdtContent></w:sdt>",
				para(
					'<w:smartTag w:uri="x" w:element="y">' + run("tagged ") + "</w:smartTag>" + run("end"),
				),
				para(
					'<w:r><w:pict><v:shape><v:textbox><w:txbxContent>' +
						para("floating box") +
						"</w:txbxContent></v:textbox></v:shape></w:pict></w:r>" +
						run("body"),
				),
			].join(""),
		});
		expect(textsOf(outcome)).toEqual(["in a control", "tagged end", "body"]);
	});

	it("never reads headers, footers, footnotes or comments", async () => {
		const outcome = await read({
			body: para(
				run("Main text") +
					'<w:r><w:footnoteReference w:id="2"/></w:r>' +
					'<w:commentRangeStart w:id="0"/>' +
					run(" more") +
					'<w:commentRangeEnd w:id="0"/>',
			),
			extra: [
				{ name: "word/footer1.xml", data: "<w:ftr><w:p><w:r><w:t>SECRET FOOTER</w:t></w:r></w:p></w:ftr>" },
				{ name: "word/footnotes.xml", data: "<w:footnotes><w:p><w:r><w:t>SECRET NOTE</w:t></w:r></w:p></w:footnotes>" },
				{ name: "word/comments.xml", data: "<w:comments><w:p><w:r><w:t>SECRET COMMENT</w:t></w:r></w:p></w:comments>" },
			],
		});
		expect(textsOf(outcome)).toEqual(["Main text more"]);
	});

	it("keeps Turkish, Cyrillic, Arabic and Hebrew text exactly", async () => {
		const samples = [
			"İstanbul'dan şiddetli rüzgârda çağrıldı ığüşöç",
			"Смотритель маяка зажигал лампу каждый вечер",
			"كان الحارس يصعد السلم الطويل كل مساء",
			"השומר עלה במדרגות הארוכות בכל ערב",
		];
		const outcome = await read({ body: samples.map((s) => para(s)).join("") });
		expect(textsOf(outcome)).toEqual(samples);
	});
});

describe("docx: images", () => {
	const drawing = (alt: string, extra = "") =>
		`<w:r><w:drawing><wp:inline><wp:extent cx="381000" cy="285750"/><wp:docPr id="1" name="Picture 1" descr="${alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>${extra}</wp:inline></w:drawing></w:r>`;

	it("makes an image placeholder with alt text and size, and no bytes", async () => {
		const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
		const outcome = await read({
			rels: relationships([
				{ id: "rId5", type: "image", target: "media/image1.png" },
			]),
			body: para(drawing("A blue square")),
			extra: [{ name: "word/media/image1.png", data: png, method: 0 }],
		});
		expect(blocksOf(outcome)).toEqual([
			{ kind: "image-placeholder", alt: "A blue square", width: 40, height: 30 },
		]);
		expect(JSON.stringify(outcome)).not.toMatch(/data:|base64|PNG|media\//);
	});

	it("puts an image after the paragraph it sits in", async () => {
		const outcome = await read({
			body: para(run("Before ") + drawing("mid") + run("after")),
		});
		expect(blocksOf(outcome)).toEqual([
			{ kind: "paragraph", text: "Before after", spans: [] },
			{ kind: "image-placeholder", alt: "mid", width: 40, height: 30 },
		]);
	});

	it("uses an empty alt when the picture has none, and reads old VML pictures", async () => {
		const outcome = await read({
			body:
				para(drawing("")) +
				para('<w:r><w:pict><v:shape alt="vml alt"><v:imagedata r:id="rId6"/></v:shape></w:pict></w:r>'),
		});
		expect(blocksOf(outcome)).toMatchObject([
			{ kind: "image-placeholder", alt: "" },
			{ kind: "image-placeholder", alt: "vml alt" },
		]);
	});

	it("makes no placeholder for a chart or shape that is not a picture", async () => {
		const outcome = await read({
			body:
				para('<w:r><w:drawing><wp:inline><wp:docPr id="2" name="Chart"/><a:graphic><a:graphicData uri="chart"/></a:graphic></wp:inline></w:drawing></w:r>') +
				para("text"),
		});
		expect(textsOf(outcome)).toEqual(["text"]);
	});
});

describe("docx: title and language", () => {
	it("takes the title from the document properties", async () => {
		const outcome = expectSuccess(
			await read({ core: coreXml("The Real Title"), body: para("text") }),
		);
		expect(outcome.title).toBe("The Real Title");
		expect(outcome.format).toBe("docx");
		expect(outcome.encoding).toBeNull();
	});

	it("falls back to the file name without .docx, as 1.x did", async () => {
		const outcome = expectSuccess(
			await read({ core: coreXml("  "), body: para("text") }, "My Report.docx"),
		);
		expect(outcome.title).toBe("My Report");
		const noCore = expectSuccess(
			await read({ body: para("text") }, "dir/Other.DOCX"),
		);
		expect(noCore.title).toBe("Other");
	});

	it("detects the language from the text, not from the language tag in the properties", async () => {
		const outcome = expectSuccess(
			await read({
				core: coreXml("t", "fr-FR"),
				body: para(
					"Her akşam fener bekçisi uzun merdiveni yavaşça tırmanır ve lambayı yakardı. Işığın çok uzaklardan görünmesi için camları günde iki kez silerdi.",
				),
			}),
		);
		expect(outcome.language.code).toBe("tr");
	});

	it("honours the reader's language hint", async () => {
		const outcome = expectSuccess(
			await parse(docx({ body: para("hello there") }), "a.docx", {
				language: "de",
			}),
		);
		expect(outcome.language).toEqual({ code: "de", source: "hint" });
	});
});

describe("docx: results that are not documents", () => {
	it("reports a document with no text as empty", async () => {
		expectError(await read({ body: para("") + para(" ") }), "empty");
		expectError(await read({ body: "" }), "empty");
	});

	it("rejects a file that is not a ZIP package", async () => {
		const text = new TextEncoder().encode("just some text, not a package");
		expectError(await parse(text, "fake.docx"), "unsupported");
	});

	it("rejects a ZIP package that is not a Word document", async () => {
		const other = zip([{ name: "xl/workbook.xml", data: "<workbook/>" }]);
		expectError(await parse(other, "sheet.docx"), "unsupported");
	});

	it("stays within the hint ceilings", async () => {
		const bytes = docx({ body: para("one") + para("two") + para("three") });
		expectError(await parse(bytes, "a.docx", { maxBlocks: 2 }), "too-big");
		expectError(await parse(bytes, "a.docx", { maxBytes: 100 }), "too-big");
	});
});
