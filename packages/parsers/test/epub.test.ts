import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import {
	ADOBE_FONT,
	AES_128,
	container,
	encryptionXml,
	epub,
	IDPF_FONT,
	opf,
	xhtml,
} from "./epub-builder";
import { blocksOf, expectError, expectSuccess, textsOf, utf8 } from "./helpers";
import { zip } from "./zip";

const read = (bytes: Uint8Array, name = "book.epub") => parse(bytes, name);

describe("epub: chapters, order and headings", () => {
	it("reads the chapters in spine order, not manifest order", async () => {
		const bytes = epub({
			chapters: [
				{ id: "b", body: "<p>Second in the manifest, first to read</p>" },
				{ id: "a", body: "<p>First in the manifest, second to read</p>" },
			],
			manifest: [
				{ id: "a", href: "a.xhtml" },
				{ id: "b", href: "b.xhtml" },
			],
			spine: [{ idref: "b" }, { idref: "a" }],
		});
		expect(textsOf(await read(bytes))).toEqual([
			"Second in the manifest, first to read",
			"First in the manifest, second to read",
		]);
	});

	it("keeps chapter headings as heading blocks with their levels", async () => {
		const bytes = epub({
			chapters: [
				{
					body: "<h1>Chapter One</h1><p>Text one.</p><h2>A Section</h2><p>More.</p>",
				},
				{ body: "<h1>Chapter Two</h1><h3>Deep</h3><p>Text two.</p>" },
			],
		});
		const blocks = blocksOf(await read(bytes));
		expect(blocks.map((b) => b.kind)).toEqual([
			"heading",
			"paragraph",
			"heading",
			"paragraph",
			"heading",
			"heading",
			"paragraph",
		]);
		expect(
			blocks.flatMap((b) => (b.kind === "heading" ? [[b.level, b.text]] : [])),
		).toEqual([
			[1, "Chapter One"],
			[2, "A Section"],
			[1, "Chapter Two"],
			[3, "Deep"],
		]);
	});

	it("maps lists, quotes and inline marks inside chapters", async () => {
		const bytes = epub({
			chapters: [
				{
					body: '<ul><li>one<ul><li>nested</li></ul></li></ul><blockquote><p>quoted</p></blockquote><p>Some <em>slanted</em> and <strong>heavy</strong> and <a href="https://example.org/x">linked</a> text.</p>',
				},
			],
		});
		const blocks = blocksOf(await read(bytes));
		expect(blocks[0]).toMatchObject({
			kind: "list-item",
			depth: 0,
			text: "one",
		});
		expect(blocks[1]).toMatchObject({
			kind: "list-item",
			depth: 1,
			text: "nested",
		});
		expect(blocks[2]).toMatchObject({ kind: "quote", text: "quoted" });
		expect(blocks[3]).toMatchObject({
			kind: "paragraph",
			text: "Some slanted and heavy and linked text.",
			spans: [
				{ kind: "emphasis", start: 5, end: 12 },
				{ kind: "strong", start: 17, end: 22 },
				{ kind: "link", start: 27, end: 33, href: "https://example.org/x" },
			],
		});
	});

	it("decodes XHTML named entities that XML itself does not define", async () => {
		const bytes = epub({
			chapters: [
				{
					body: "<p>Non&nbsp;breaking &mdash; dash, &hellip; &eacute;&amp;&#233;&#x41; &lt;tag&gt;</p>",
				},
			],
		});
		const [text] = textsOf(await read(bytes));
		expect(text).toBe("Non breaking — dash, … é&éA <tag>");
		expect(text).not.toMatch(/&\w+;/);
	});

	it("does not let self-closing XHTML tags swallow the rest of the chapter", async () => {
		const bytes = epub({
			chapters: [
				{
					body: '<a id="top"/><span class="pb"/><em/><p>First paragraph.</p><div class="gap"/><script type="text/javascript" src="x.js"/><p>Second paragraph, not italic.</p><p/><p>Third.</p>',
				},
			],
		});
		const blocks = blocksOf(await read(bytes));
		expect(
			blocks.map((b) => (b.kind === "image-placeholder" ? "" : b.text)),
		).toEqual(["First paragraph.", "Second paragraph, not italic.", "Third."]);
		for (const block of blocks) {
			if (block.kind !== "image-placeholder") expect(block.spans).toEqual([]);
		}
	});

	it("turns images into placeholders with the alt text and no bytes", async () => {
		const bytes = epub({
			chapters: [
				{
					body: '<p>Before.</p><p><img src="data:image/png;base64,iVBORw0KGgo=" alt="A lamp"/></p><p>After.</p>',
				},
			],
			extra: [{ name: "OEBPS/lamp.png", data: "PNGDATA" }],
		});
		const blocks = blocksOf(await read(bytes));
		expect(blocks.map((b) => b.kind)).toEqual([
			"paragraph",
			"image-placeholder",
			"paragraph",
		]);
		expect(JSON.stringify(blocks)).not.toMatch(/data:|base64|PNGDATA/);
	});

	it("reads a chapter that has a byte order mark or is UTF-16", async () => {
		const withBom = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...utf8(xhtml("<p>Bom chapter</p>")),
		]);
		const utf16 = new Uint8Array([0xff, 0xfe]);
		const text = xhtml("<p>Wide chapter</p>");
		const wide = new Uint8Array(2 + text.length * 2);
		wide.set(utf16);
		for (let i = 0; i < text.length; i++) {
			wide[2 + i * 2] = text.charCodeAt(i) & 0xff;
			wide[3 + i * 2] = text.charCodeAt(i) >> 8;
		}
		const bytes = epub({
			chapters: [{ raw: withBom }, { raw: wide }],
		});
		expect(textsOf(await read(bytes))).toEqual(["Bom chapter", "Wide chapter"]);
	});
});

describe("epub: finding the package and its parts", () => {
	it("follows the container to an OPF in any folder and resolves relative hrefs", async () => {
		const bytes = zip([
			{ name: "mimetype", data: "application/epub+zip", method: 0 },
			{
				name: "META-INF/container.xml",
				data: container("book/ops/package.opf"),
			},
			{
				name: "book/ops/package.opf",
				data: opf({
					manifest: [
						{ id: "one", href: "text/one.xhtml" },
						{ id: "two", href: "../shared/two.xhtml" },
					],
					spine: [{ idref: "one" }, { idref: "two" }],
				}),
			},
			{ name: "book/ops/text/one.xhtml", data: xhtml("<p>One</p>") },
			{ name: "book/shared/two.xhtml", data: xhtml("<p>Two</p>") },
		]);
		expect(textsOf(await read(bytes))).toEqual(["One", "Two"]);
	});

	it("finds parts by a fragment-less, percent-decoded, case-insensitive path", async () => {
		const bytes = epub({
			chapters: [
				{ id: "a", href: "my chapter.xhtml", body: "<p>Spaced</p>" },
				{ id: "b", href: "Upper.XHTML", body: "<p>Cased</p>" },
				{ id: "c", href: "plain.xhtml", body: "<p>Plain</p>" },
			],
			manifest: [
				{ id: "a", href: "my%20chapter.xhtml#start" },
				{ id: "b", href: "upper.xhtml" },
				{ id: "c", href: "./plain.xhtml?x=1" },
			],
		});
		expect(textsOf(await read(bytes))).toEqual(["Spaced", "Cased", "Plain"]);
	});

	it("reads an OPF that uses a namespace prefix and a byte order mark", async () => {
		const prefixed = `﻿<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><opf:metadata><dc:title>Prefixed Title</dc:title></opf:metadata><opf:manifest><opf:item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></opf:manifest><opf:spine><opf:itemref idref="c1"/></opf:spine></opf:package>`;
		const bytes = epub({ rawOpf: prefixed });
		const result = expectSuccess(await read(bytes));
		expect(result.title).toBe("Prefixed Title");
		expect(textsOf(result)).toEqual(["Hello EPUB world"]);
	});

	it("skips spine entries that point to nothing and reads the rest", async () => {
		const bytes = epub({
			chapters: [{ id: "real", body: "<p>Present</p>" }],
			manifest: [
				{ id: "real", href: "real.xhtml" },
				{ id: "gone", href: "gone.xhtml" },
			],
			spine: [{ idref: "gone" }, { idref: "nope" }, { idref: "real" }],
		});
		expect(textsOf(await read(bytes))).toEqual(["Present"]);
	});

	it("skips items that are not XHTML, the navigation document and linear=no items", async () => {
		const bytes = epub({
			chapters: [
				{ id: "cover", type: "image/svg+xml", body: "<p>Cover svg text</p>" },
				{
					id: "nav",
					properties: "nav",
					body: "<nav><ol><li><a href='c.xhtml'>Contents</a></li></ol></nav>",
				},
				{ id: "note", linear: "no", body: "<p>An auxiliary note</p>" },
				{ id: "main", body: "<p>The story</p>" },
			],
		});
		expect(textsOf(await read(bytes))).toEqual(["The story"]);
	});

	it("reads linear=no items when nothing else is linear", async () => {
		const bytes = epub({
			chapters: [
				{ id: "a", linear: "no", body: "<p>Only content A</p>" },
				{ id: "b", linear: "no", body: "<p>Only content B</p>" },
			],
		});
		expect(textsOf(await read(bytes))).toEqual([
			"Only content A",
			"Only content B",
		]);
	});

	it("reads an item listed twice in the spine once", async () => {
		const bytes = epub({
			chapters: [{ id: "a", body: "<p>Once</p>" }],
			spine: [{ idref: "a" }, { idref: "a" }, { idref: "a" }],
		});
		expect(textsOf(await read(bytes))).toEqual(["Once"]);
	});

	it("does not need the mimetype entry", async () => {
		expect(textsOf(await read(epub({ noMimetype: true })))).toEqual([
			"Hello EPUB world",
		]);
	});
});

describe("epub: title and language", () => {
	it("takes the title from dc:title, falls back to the file name", async () => {
		const titled = expectSuccess(await read(epub({ title: "A Real Title" })));
		expect(titled.title).toBe("A Real Title");
		const untitled = expectSuccess(
			await read(epub({ title: null }), "My Great Book.epub"),
		);
		expect(untitled.title).toBe("My Great Book");
	});

	it("prefers the Dublin Core title over other title elements", async () => {
		const rawOpf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><title xmlns="urn:other">Not This One</title><dc:title>This One</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
		const bytes = epub({ rawOpf });
		expect(expectSuccess(await read(bytes)).title).toBe("This One");
	});

	it("uses dc:language, and a language hint overrides it", async () => {
		const bytes = epub({
			language: "tr",
			chapters: [{ body: "<p>Kısa bir metin.</p>" }],
		});
		const result = expectSuccess(await read(bytes));
		expect(result.language).toEqual({ code: "tr", source: "metadata" });
		const hinted = expectSuccess(
			await parse(bytes, "book.epub", { language: "de" }),
		);
		expect(hinted.language).toEqual({ code: "de", source: "hint" });
	});

	it("reports the format as epub with no text encoding", async () => {
		const result = expectSuccess(await read(epub()));
		expect(result.format).toBe("epub");
		expect(result.encoding).toBeNull();
	});
});

describe("epub: .zip files and files that are not books", () => {
	it("reads a .zip that holds an EPUB as an EPUB", async () => {
		const result = expectSuccess(await read(epub(), "download.zip"));
		expect(result.format).toBe("epub");
		expect(textsOf(result)).toEqual(["Hello EPUB world"]);
	});

	it("says a plain .zip is not supported, in plain words", async () => {
		const bytes = zip([{ name: "notes.txt", data: "just a text file" }]);
		const error = expectError(await read(bytes, "stuff.zip"), "unsupported");
		expect(error.message).toMatch(/EPUB/);
	});

	it("says an .epub that is not a ZIP is not supported", async () => {
		expectError(await read(utf8("not a zip at all"), "x.epub"), "unsupported");
	});

	it("says an EPUB with no chapters that can be read is unsupported", async () => {
		const bytes = epub({ chapters: [], manifest: [], spine: [] });
		expectError(await read(bytes), "unsupported");
	});

	it("says an EPUB whose chapters hold no text is empty", async () => {
		const bytes = epub({
			chapters: [{ body: '<p>   </p><img src="x.png" alt=""/>' }],
		});
		expectError(await read(bytes), "empty");
	});
});

describe("epub: DRM", () => {
	const chapters = [{ body: "<p>Readable only if not encrypted</p>" }];

	it("reads a book whose fonts are only obfuscated", async () => {
		const bytes = epub({
			chapters,
			encryption: encryptionXml([
				{ uri: "OEBPS/f/a.otf", algorithm: IDPF_FONT },
				{ uri: "OEBPS/f/b.otf", algorithm: ADOBE_FONT },
			]),
			extra: [
				{ name: "OEBPS/f/a.otf", data: "dummy" },
				{ name: "OEBPS/f/b.otf", data: "dummy" },
			],
		});
		expect(textsOf(await read(bytes))).toEqual([
			"Readable only if not encrypted",
		]);
	});

	it("returns drm, with a plain message, when a chapter is really encrypted", async () => {
		const bytes = epub({
			chapters,
			encryption: encryptionXml([
				{ uri: "OEBPS/c1.xhtml", algorithm: AES_128 },
			]),
		});
		const error = expectError(await read(bytes), "drm");
		expect(error.message).toMatch(/protect/i);
	});

	it("matches the encrypted path however it is written", async () => {
		for (const uri of [
			"oebps/C1.XHTML",
			"/OEBPS/c1.xhtml",
			"OEBPS/./c1.xhtml",
			"OEBPS/%63%31.xhtml",
		]) {
			const bytes = epub({
				chapters,
				encryption: encryptionXml([{ uri, algorithm: AES_128 }]),
			});
			expectError(await read(bytes), "drm");
		}
	});

	it("returns drm when the package document itself is encrypted", async () => {
		const bytes = epub({
			chapters,
			encryption: encryptionXml([
				{ uri: "OEBPS/content.opf", algorithm: AES_128 },
			]),
		});
		expectError(await read(bytes), "drm");
	});

	it("returns drm for real encryption that names no resource", async () => {
		const bytes = epub({
			chapters,
			encryption: encryptionXml([{ algorithm: AES_128 }]),
		});
		expectError(await read(bytes), "drm");
	});

	it("still reads the text when only images or fonts are really encrypted", async () => {
		const bytes = epub({
			chapters,
			encryption: encryptionXml([
				{ uri: "OEBPS/pic.jpg", algorithm: AES_128 },
				{ uri: "OEBPS/f.otf", algorithm: IDPF_FONT },
			]),
		});
		expect(textsOf(await read(bytes))).toEqual([
			"Readable only if not encrypted",
		]);
	});

	it("returns drm when a chapter entry is encrypted inside the ZIP itself", async () => {
		const flagged = zip([
			{ name: "META-INF/container.xml", data: container() },
			{
				name: "OEBPS/content.opf",
				data: opf({
					manifest: [{ id: "c1", href: "c1.xhtml" }],
					spine: [{ idref: "c1" }],
				}),
			},
			{ name: "OEBPS/c1.xhtml", data: xhtml("<p>x</p>"), flags: 0x0001 },
		]);
		const error = expectError(await read(flagged), "drm");
		expect(error.message).not.toMatch(/Word/);
	});
});
