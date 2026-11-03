import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import {
	blocksOf,
	bytesOf,
	concat,
	expectError,
	expectSuccess,
	textsOf,
	utf8,
	utf16,
} from "./helpers";

const html = (source: string, name = "page.html") => parse(utf8(source), name);

describe("html: structure", () => {
	it("maps headings, paragraphs and plain text", async () => {
		const blocks = blocksOf(
			await html("<h1>Title</h1><h3>Sub</h3><p>Hello world</p>"),
		);
		expect(blocks).toEqual([
			{ kind: "heading", level: 1, text: "Title", spans: [] },
			{ kind: "heading", level: 3, text: "Sub", spans: [] },
			{ kind: "paragraph", text: "Hello world", spans: [] },
		]);
		expect(textsOf(await html("Just plain text"))).toEqual(["Just plain text"]);
	});

	it("keeps paragraphs in order and strips attributes", async () => {
		expect(
			textsOf(await html('<p class="a" id="b">First</p><p>Second</p>')),
		).toEqual(["First", "Second"]);
	});

	it("turns a line break into a space and collapses whitespace", async () => {
		expect(
			textsOf(await html("<p>  Line one<br>Line\n\ttwo  three  </p>")),
		).toEqual(["Line one Line two three"]);
	});

	it("reads nested inline markup as one paragraph with spans", async () => {
		const [block] = blocksOf(
			await html(
				"<div><p>Hello <strong>big <em>bold</em></strong> world</p></div>",
			),
		);
		expect(block).toMatchObject({
			kind: "paragraph",
			text: "Hello big bold world",
			spans: expect.arrayContaining([
				{ kind: "strong", start: 6, end: 14 },
				{ kind: "emphasis", start: 10, end: 14 },
			]),
		});
	});

	it("maps b and i to strong and emphasis and keeps links with safe targets", async () => {
		const [block] = blocksOf(
			await html(
				'<p><b>one</b> <i>two</i> <a href="https://example.com/x?a=1&amp;b=2">three</a> <a href="/rel">four</a></p>',
			),
		);
		expect(block).toMatchObject({ text: "one two three four" });
		const spans = (block as { spans: unknown[] }).spans;
		expect(spans).toEqual(
			expect.arrayContaining([
				{ kind: "strong", start: 0, end: 3 },
				{ kind: "emphasis", start: 4, end: 7 },
				{
					kind: "link",
					start: 8,
					end: 13,
					href: "https://example.com/x?a=1&b=2",
				},
				{ kind: "link", start: 14, end: 18, href: "/rel" },
			]),
		);
	});

	it("drops unsafe link targets but keeps their text", async () => {
		const hrefs = [
			"javascript:alert(1)",
			" JaVa\tScRiPt:alert(1)",
			"java&#x0A;script:alert(1)",
			"&#106;avascript:alert(1)",
			"data:text/html,<b>x</b>",
			"vbscript:x",
			"file:///etc/passwd",
		];
		for (const href of hrefs) {
			const [block] = blocksOf(
				await html(`<p>see <a href="${href}">here</a></p>`),
			);
			expect(block).toMatchObject({ text: "see here", spans: [] });
		}
	});

	it("maps lists with depth and ordering", async () => {
		const blocks = blocksOf(
			await html(
				"<ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul><ol><li>one</li><li>two</li></ol>",
			),
		);
		expect(blocks).toEqual([
			{ kind: "list-item", depth: 0, ordered: false, text: "a", spans: [] },
			{ kind: "list-item", depth: 0, ordered: false, text: "b", spans: [] },
			{ kind: "list-item", depth: 1, ordered: false, text: "b1", spans: [] },
			{ kind: "list-item", depth: 0, ordered: true, text: "one", spans: [] },
			{ kind: "list-item", depth: 0, ordered: true, text: "two", spans: [] },
		]);
	});

	it("reads unclosed list items", async () => {
		expect(textsOf(await html("<ul><li>item one<li>item two</ul>"))).toEqual([
			"item one",
			"item two",
		]);
	});

	it("maps block quotes, one quote block per paragraph inside", async () => {
		const blocks = blocksOf(
			await html("<blockquote><p>Said one.</p><p>Said two.</p></blockquote>"),
		);
		expect(blocks.map((b) => b.kind)).toEqual(["quote", "quote"]);
		expect(textsOf(await html("<blockquote>Bare quote</blockquote>"))).toEqual([
			"Bare quote",
		]);
	});

	it("keeps pre blocks exactly, dropping only the first newline", async () => {
		const blocks = blocksOf(
			await html("<pre>\nline one\n  indented  <b>bold</b>\nline three</pre>"),
		);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			kind: "code",
			text: "line one\n  indented  bold\nline three",
		});
	});

	it("reads each table row as one table-text block, with the caption", async () => {
		const blocks = blocksOf(
			await html(
				"<table><caption>Birds seen</caption><tr><th>Name</th><th>Count</th></tr><tr><td>Heron</td><td>3</td></tr></table>",
			),
		);
		expect(blocks).toEqual([
			{ kind: "caption", text: "Birds seen", spans: [] },
			{ kind: "table-text", text: "Name Count", spans: [] },
			{ kind: "table-text", text: "Heron 3", spans: [] },
		]);
	});

	it("maps figcaption to a caption", async () => {
		const blocks = blocksOf(
			await html(
				'<figure><img src="a.png" alt="A heron"><figcaption>A heron at dusk</figcaption></figure>',
			),
		);
		expect(blocks).toEqual([
			{ kind: "image-placeholder", alt: "A heron" },
			{ kind: "caption", text: "A heron at dusk", spans: [] },
		]);
	});

	it("turns images into placeholders with alt and size, never keeping the source", async () => {
		const blocks = blocksOf(
			await html(
				'<p><img src="data:image/png;base64,AAAA" alt="Tom &amp; Jerry" width="640" height="480"></p><p>after</p>',
			),
		);
		expect(blocks).toEqual([
			{
				kind: "image-placeholder",
				alt: "Tom & Jerry",
				width: 640,
				height: 480,
			},
			{ kind: "paragraph", text: "after", spans: [] },
		]);
		expect(JSON.stringify(blocks)).not.toContain("data:");
	});

	it("keeps an image inside a sentence out of the sentence", async () => {
		const blocks = blocksOf(
			await html('<p>Before <img alt="pic" src="x.png"> after.</p>'),
		);
		expect(blocks.map((b) => b.kind)).toEqual([
			"paragraph",
			"image-placeholder",
		]);
		expect(blocks[0]).toMatchObject({ text: "Before after." });
	});

	it("ignores tracking pixels and invalid sizes", async () => {
		const blocks = blocksOf(
			await html(
				'<p>text</p><img src="x" width="1" height="1"><img alt="ok" width="-5" height="abc">',
			),
		);
		expect(blocks).toEqual([
			{ kind: "paragraph", text: "text", spans: [] },
			{ kind: "image-placeholder", alt: "ok" },
		]);
	});

	it("splits a div that mixes loose text and paragraphs", async () => {
		expect(
			textsOf(await html("<div>loose text<p>para</p>more loose</div>")),
		).toEqual(["loose text", "para", "more loose"]);
	});

	it("never puts script, style, template, noscript, svg or form controls in the text", async () => {
		const out = textsOf(
			await html(
				"<html><head><title>T</title><style>p{color:red}</style><script>var x = 1;</script></head><body><p>keep</p><script>alert('x')</script><style>.a{}</style><template><p>tpl</p></template><noscript>enable js</noscript><svg><title>chart</title><text>svgtext</text></svg><select><option>opt</option></select><textarea>ta</textarea><button>btn</button><!-- comment --><p>also</p></body></html>",
			),
		);
		expect(out).toEqual(["keep", "also"]);
	});

	it("skips elements hidden by attribute or inline style", async () => {
		expect(
			textsOf(
				await html(
					'<p>shown</p><p hidden>a</p><div aria-hidden="true"><p>b</p></div><p style="display: none">c</p><p style="color:red;VISIBILITY:hidden">d</p><p>end</p>',
				),
			),
		).toEqual(["shown", "end"]);
	});

	it("reads a malformed page the way a browser does", async () => {
		const out = textsOf(
			await html(
				"<!DOCTYPE html><html><head><title>Malformed</title></head><body><h1>Unclosed heading<p>First para with <b>bold text and <i>nested italics</b> after.<p>Second para<br>line two&nbsp;with nbsp &copy 2026 &amp no-semicolon</div><ul><li>item one<li>item two</ul><h3>Sub heading</h3><p unquoted=yes>Attr test</p></body></html>",
			),
		);
		expect(out).toEqual([
			"Unclosed heading",
			"First para with bold text and nested italics after.",
			"Second para line two with nbsp © 2026 & no-semicolon",
			"item one",
			"item two",
			"Sub heading",
			"Attr test",
		]);
	});
});

describe("html: entities", () => {
	it("decodes named, decimal and hex entities with no leakage", async () => {
		const [block] = blocksOf(
			await html(
				"<p>Tom &amp; Jerry &mdash; caf&eacute; &#233; &#xE9; &hellip; &lt;b&gt; &quot;q&quot; &#305; &#x131;</p>",
			),
		);
		expect((block as { text: string }).text).toBe(
			'Tom & Jerry — café é é … <b> "q" ı ı',
		);
	});

	it("decodes once, so &amp;amp; shows as &amp;", async () => {
		expect(textsOf(await html("<p>&amp;amp; and &amp;lt;</p>"))).toEqual([
			"&amp; and &lt;",
		]);
	});

	it("leaves unknown entities as written and survives broken numeric ones", async () => {
		const [text] = textsOf(
			await html(
				"<p>a &zzznotanentity; b &#99999999999; c &#xD800; d &#0; e &#x110000; f &</p>",
			),
		);
		expect(text).toContain("&zzznotanentity;");
		expect(text).not.toContain("&#");
		expect(text).not.toMatch(/[\ud800-\udfff]/);
	});

	it("decodes entities in alt text and titles", async () => {
		const result = expectSuccess(
			await html(
				'<title>R&amp;D &eacute;t&eacute;</title><p>x</p><img alt="&lt;&eacute;&gt;">',
			),
		);
		expect(result.title).toBe("R&D été");
		expect(result.document.blocks[1]).toMatchObject({ alt: "<é>" });
	});
});

describe("html: title, language and format", () => {
	it("reports the html format and the utf-8 encoding", async () => {
		const result = expectSuccess(await html("<p>x</p>"));
		expect(result.format).toBe("html");
		expect(result.encoding).toBe("utf-8");
	});

	it("takes the title from <title>, even when it contains a stray <", async () => {
		expect(expectSuccess(await html("<title>One</title><p>x</p>")).title).toBe(
			"One",
		);
		expect(
			expectSuccess(await html("<title>a < b &lt; c</title><p>x</p>")).title,
		).toBe("a < b < c");
	});

	it("falls back to the first h1, then the file name", async () => {
		expect(
			expectSuccess(await html("<h2>Sub</h2><h1>Main  heading</h1><p>x</p>"))
				.title,
		).toBe("Main heading");
		expect(
			expectSuccess(await html("<p>x</p>", "My saved page.html")).title,
		).toBe("My saved page");
	});

	it("prefers the h1 when the title is the h1 plus a site name", async () => {
		const result = expectSuccess(
			await html(
				"<title>Lorenz cipher - Wikipedia</title><h1>Lorenz cipher</h1><p>x</p>",
			),
		);
		expect(result.title).toBe("Lorenz cipher");
	});

	it("reads the language from the html lang attribute, a hint wins", async () => {
		const page = '<html lang="tr-TR"><body><p>merhaba</p></body></html>';
		const detected = expectSuccess(await html(page));
		expect(detected.language).toEqual({ code: "tr", source: "metadata" });
		const hinted = expectSuccess(
			await parse(utf8(page), "a.html", { language: "de" }),
		);
		expect(hinted.language).toEqual({ code: "de", source: "hint" });
	});

	it("detects the language from the text when the page declares none", async () => {
		const result = expectSuccess(
			await html(
				"<p>The quick brown fox jumps over the lazy dog and then it was gone for the rest of the day.</p>",
			),
		);
		expect(result.language.code).toBe("en");
	});

	it("opens .htm and upper-case extensions", async () => {
		expect(textsOf(await html("<p>x</p>", "PAGE.HTM"))).toEqual(["x"]);
		expect(textsOf(await html("<p>x</p>", "dir/page.Html"))).toEqual(["x"]);
	});

	it("is empty when there is no text", async () => {
		expectError(await html("<html><body></body></html>"), "empty");
		expectError(await html("<p>   </p><script>x</script>"), "empty");
		expectError(await html("<!-- never closed <p>text</p>"), "empty");
	});

	it("caps the block count with a lower hint", async () => {
		const page = "<p>a</p>".repeat(50);
		expectError(
			await parse(utf8(page), "a.html", { maxBlocks: 10 }),
			"too-big",
		);
	});
});

describe("html: encodings", () => {
	const latin5 = (...codes: number[]) => Uint8Array.from(codes);

	it("honours <meta charset> (windows-1254)", async () => {
		const bytes = concat(
			utf8('<meta charset="windows-1254"><p>'),
			latin5(0xfd, 0xfe, 0xf0, 0xdd, 0xde, 0xd0),
			utf8("</p>"),
		);
		const result = expectSuccess(await parse(bytes, "tr.html"));
		expect(textsOf(result)).toEqual(["ışğİŞĞ"]);
		expect(result.encoding).toBe("windows-1254");
	});

	it("honours the http-equiv content-type form and the xml declaration", async () => {
		const equiv = concat(
			utf8(
				'<meta http-equiv="Content-Type" content="text/html; charset=windows-1251"><p>',
			),
			latin5(0xef, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2),
			utf8("</p>"),
		);
		expect(textsOf(await parse(equiv, "ru.html"))).toEqual(["привет"]);
		const xml = concat(
			utf8('<?xml version="1.0" encoding="iso-8859-2"?><p>'),
			latin5(0xb1, 0xe6, 0xea),
			utf8("</p>"),
		);
		expect(textsOf(await parse(xml, "pl.html"))).toEqual(["ąćę"]);
	});

	it("lets a BOM beat the meta tag, and the reader's codepage beat both", async () => {
		const withBom = concat(
			bytesOf(0xef, 0xbb, 0xbf),
			utf8('<meta charset="windows-1254"><p>ış</p>'),
		);
		expect(textsOf(await parse(withBom, "a.html"))).toEqual(["ış"]);
		const utf16Page = utf16(
			'<meta charset="windows-1254"><p>ış</p>',
			"le",
			true,
		);
		expect(textsOf(await parse(utf16Page, "a.html"))).toEqual(["ış"]);
		const picked = concat(
			utf8('<meta charset="utf-8"><p>'),
			latin5(0xef, 0xf0, 0xe8),
		);
		const result = expectSuccess(
			await parse(picked, "a.html", { encoding: "windows-1251" }),
		);
		expect(textsOf(result)).toEqual(["при"]);
		expect(result.encoding).toBe("windows-1251");
	});

	it("falls back to UTF-8 for an unknown meta charset", async () => {
		expect(
			textsOf(await html('<meta charset="no-such-charset"><p>café</p>')),
		).toEqual(["café"]);
	});

	it("is encoding-suspect for invalid UTF-8 with no declaration", async () => {
		expectError(
			await parse(
				concat(utf8("<p>"), latin5(0xfd, 0xfe, 0xff), utf8("</p>")),
				"a.html",
			),
			"encoding-suspect",
		);
	});

	it("ignores a charset declared after the first kilobyte", async () => {
		const late = concat(
			utf8(`<p>${"x".repeat(1100)}</p><meta charset="windows-1254"><p>`),
			latin5(0xfd),
		);
		expectError(await parse(late, "a.html"), "encoding-suspect");
	});

	it("refuses a binary file named .html", async () => {
		const noise = Uint8Array.from({ length: 300 }, (_, i) => (i % 7) + 1);
		expectError(await parse(noise, "a.html"), "encoding-suspect");
		expectError(
			await parse(
				Uint8Array.from([60, 112, 62, 0, 0, 0, 0, 0, 0, 1, 2, 3]),
				"a.html",
			),
			"unsupported",
		);
	});
});

const article = (body: string) =>
	`<!doctype html><html lang="en"><head><title>Saved</title><meta property="og:title" content="Saved"><script src="/app.js"></script></head><body>${body}</body></html>`;

const longText = (seed: string) =>
	`${seed} runs long enough to count as a real paragraph of the article text.`;

describe("html: saved web pages keep the article and drop the rest", () => {
	it("drops navigation, header, footer, aside, forms and cookie banners", async () => {
		const page = article(
			`<header><a href="/">Home</a> <a href="/about">About</a></header>
			<nav><ul><li><a href="/a">Alpha section</a></li><li><a href="/b">Beta section</a></li></ul></nav>
			<div class="cookie-banner"><p>We use cookies on this website to improve things for you.</p></div>
			<main><article><h1>Real headline</h1><p>${longText("First paragraph")}</p><p>${longText("Second paragraph")}</p></article></main>
			<aside><p>Related stories and other things you might like to read next.</p></aside>
			<form><label>Email</label><input></form>
			<footer><p>Copyright 2026 Example Corporation. All rights reserved worldwide.</p></footer>`,
		);
		expect(textsOf(await html(page))).toEqual([
			"Real headline",
			longText("First paragraph"),
			longText("Second paragraph"),
		]);
	});

	it("keeps a headline that sits inside a header within the article", async () => {
		const page = article(
			`<nav><a href="/">Home</a></nav><article><header><h1>Headline</h1></header><p>${longText("Body")}</p></article>`,
		);
		expect(textsOf(await html(page))).toEqual(["Headline", longText("Body")]);
	});

	it("drops link-heavy paragraphs and short fragments but keeps real prose", async () => {
		const page = article(
			`<div><p><a href="/x">Read this other story about something else entirely now</a></p>
			<p>Share</p>
			<p>${longText("Real")}</p>
			<p>He did not answer.</p>
			<p>Mixed: ${longText("prose with")} <a href="/y">a link</a>.</p></div>`,
		);
		const out = textsOf(await html(page));
		expect(out).toContain(longText("Real"));
		expect(out).toContain("He did not answer.");
		expect(out.some((t) => t.startsWith("Mixed:"))).toBe(true);
		expect(out).not.toContain("Share");
		expect(out.some((t) => t.startsWith("Read this other"))).toBe(false);
	});

	it("keeps only what is inside main or article when that holds the text", async () => {
		const page = article(
			`<div><p>${longText("Outside")}</p></div><main><p>${longText("Inside one")}</p><p>${longText("Inside two")}</p></main>`,
		);
		expect(textsOf(await html(page))).toEqual([
			longText("Inside one"),
			longText("Inside two"),
		]);
	});

	it("does not filter book-style HTML: short paragraphs and link lists stay", async () => {
		const book = `<html><head><title>A Book</title></head><body>
			<h1>Chapter I</h1>
			<p>Yes.</p>
			<p>"No," said he.</p>
			<ul><li><a href="#c1">Chapter I</a></li><li><a href="#c2">Chapter II</a></li></ul>
			<p>${longText("A long one")}</p></body></html>`;
		expect(textsOf(await html(book))).toEqual([
			"Chapter I",
			"Yes.",
			'"No," said he.',
			"Chapter I",
			"Chapter II",
			longText("A long one"),
		]);
	});

	it("keeps the article when the whole site sits inside one form", async () => {
		const page = article(
			`<form id="aspnetForm"><div><p>${longText("Alpha")}</p><p>${longText("Beta")}</p><p>${longText("Gamma")}</p><p>${longText("Delta")}</p></div></form><nav><a href="/">Home</a></nav>`,
		);
		const out = textsOf(await html(page));
		expect(out).toContain(longText("Alpha"));
		expect(out).toContain(longText("Delta"));
	});

	it("drops citation markers and heading anchors from saved pages", async () => {
		const page = article(
			`<nav><a href="/">Home</a></nav><main><h2>Title<a class="headerlink" href="#t">¶</a></h2><p>${longText("Cited")}<sup class="reference"><a href="#r1">[1]</a></sup> and the sentence goes on.</p></main>`,
		);
		expect(textsOf(await html(page))).toEqual([
			"Title",
			`${longText("Cited")} and the sentence goes on.`,
		]);
	});

	it("filters nothing when only one kind of page furniture is present", async () => {
		const page = `<html><body><footer>tiny</footer><p>Yes.</p><p>${longText("Body")}</p></body></html>`;
		expect(textsOf(await html(page))).toEqual([
			"tiny",
			"Yes.",
			longText("Body"),
		]);
	});

	it("reads a paragraph inside an unclosed heading as a paragraph", async () => {
		const blocks = blocksOf(
			await html("<h1>Title<p>First paragraph<p>Second paragraph"),
		);
		expect(blocks.map((block) => block.kind)).toEqual([
			"heading",
			"paragraph",
			"paragraph",
		]);
	});
});

describe("html: hostile input", () => {
	const finishes = async (
		bytes: Uint8Array,
		name = "evil.html",
	): Promise<void> => {
		const outcome = await parse(bytes, name);
		if (outcome.ok) {
			expect(outcome.document.blocks.length).toBeGreaterThan(0);
		} else {
			expect(outcome.message.length).toBeGreaterThan(0);
		}
	};

	it("reads 400 nested divs", { timeout: 60_000 }, async () => {
		const depth = 400;
		const outcome = await html(
			`${"<div>".repeat(depth)}deep text${"</div>".repeat(depth)}`,
		);
		expect(textsOf(outcome)).toEqual(["deep text"]);
	});

	it("refuses absurd nesting with a typed error, quickly", {
		timeout: 60_000,
	}, async () => {
		const depth = 300_000;
		const started = Date.now();
		expectError(
			await html(`${"<div>".repeat(depth)}deep text${"</div>".repeat(depth)}`),
			"too-big",
		);
		expect(Date.now() - started).toBeLessThan(10_000);
	});

	it("takes millions of stray closing tags at the deepest allowed nesting", {
		timeout: 120_000,
	}, async () => {
		const started = Date.now();
		const outcome = await html(
			`${"<b>".repeat(500)}text${"</i>".repeat(2_000_000)}`,
		);
		expect(textsOf(outcome)).toEqual(["text"]);
		expect(Date.now() - started).toBeLessThan(30_000);
	});

	it("survives a million unclosed inline tags", {
		timeout: 60_000,
	}, async () => {
		const outcome = await html(
			`<p>${"<b>".repeat(1_000_000)}x</p><p>after</p>`,
		);
		if (outcome.ok) {
			expect(textsOf(outcome)).toEqual(["x", "after"]);
		} else {
			expectError(outcome, "too-big");
		}
	});

	it("caps list depth", { timeout: 30_000 }, async () => {
		const depth = 250;
		const outcome = await html(
			`${"<ul><li>".repeat(depth)}leaf${"</li></ul>".repeat(depth)}`,
		);
		const blocks = blocksOf(outcome);
		for (const block of blocks) {
			if (block.kind === "list-item")
				expect(block.depth).toBeLessThanOrEqual(10);
		}
	});

	it("takes ten megabytes of entities in linear time", {
		timeout: 60_000,
	}, async () => {
		const started = Date.now();
		const [text] = textsOf(await html(`<p>${"&amp;".repeat(2_000_000)}</p>`));
		expect(text).toHaveLength(2_000_000);
		expect(Date.now() - started).toBeLessThan(20_000);
	});

	it("takes a huge attribute, many attributes and a long href", {
		timeout: 60_000,
	}, async () => {
		const big = "a".repeat(5_000_000);
		const many = Array.from({ length: 50_000 }, (_, i) => `a${i}="v"`).join(
			" ",
		);
		const outcome = await html(
			`<p data-x="${big}" ${many}>one <a href="https://example.com/${"x".repeat(5000)}">two</a></p>`,
		);
		const [block] = blocksOf(outcome);
		expect(block).toMatchObject({ text: "one two" });
		for (const span of (block as { spans: { kind: string; href?: string }[] })
			.spans) {
			if (span.kind === "link")
				expect(span.href?.length).toBeLessThanOrEqual(2048);
		}
	});

	it("treats odd constructs as markup, never as text", async () => {
		const out = textsOf(
			await html(
				'<?xml version="1.0"?><![CDATA[ hidden ]]><!DOCTYPE html><p>shown &x; &#x26;x; boom</p><!-- <p>no</p> -->',
			),
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toBe("shown &x; &x; boom");
		expect(out[0]).not.toContain("hidden");
		expect(out[0]).not.toContain("no</p>");
	});

	it("handles NULs, lone surrogates and control characters in the text", async () => {
		const out = textsOf(
			await html(
				"<p>a\u0000b\u0001c\u007fd and some more plain text around it</p>",
			),
		);
		expect(out).toEqual(["abcd and some more plain text around it"]);
	});

	it("does not let a closing script tag in a comment or attribute leak the script", async () => {
		const out = textsOf(
			await html(
				'<p title="</script>">one</p><script>var s = "<p>leaked</p>"; // </scr' +
					"ipt>" +
					"<p>two</p>",
			),
		);
		expect(out.join(" ")).not.toContain("leaked");
		expect(out.join(" ")).not.toContain("var s");
	});

	it("survives a megabyte of unclosed comment, tag and attribute openers", {
		timeout: 60_000,
	}, async () => {
		for (const piece of [
			"<!--",
			"<a ",
			"<a href='",
			"<p ",
			"<",
			"</",
			"<!",
			"&#",
		]) {
			await finishes(utf8(piece.repeat(1_000_000 / piece.length)));
		}
	});

	it("never throws on random tag soup", { timeout: 60_000 }, async () => {
		let state = 0x9e3779b9;
		const rand = () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state / 4294967296;
		};
		const pieces = [
			"<p>",
			"</p>",
			"<div>",
			"</div>",
			"<b>",
			"</i>",
			"<ul>",
			"<li>",
			"</ul>",
			"<table>",
			"<tr>",
			"<td>",
			"</table>",
			'<a href="/x">',
			"</a>",
			'<img alt="a">',
			"<h1>",
			"</h3>",
			"<pre>",
			"</pre>",
			"<blockquote>",
			"<script>",
			"</script>",
			"text ",
			"more text here ",
			"&amp;",
			"&bogus;",
			"&#xZZ;",
			"<!--",
			"-->",
			"<nav>",
			"</nav>",
			"<br>",
			"<hr/>",
			"<svg>",
			"</svg>",
			"<em ",
			'"',
			"'",
			">",
		];
		for (let round = 0; round < 400; round++) {
			let page = rand() < 0.5 ? "<html><body>" : "";
			const count = 1 + Math.floor(rand() * 120);
			for (let i = 0; i < count; i++) {
				page += pieces[Math.floor(rand() * pieces.length)] ?? "";
			}
			const outcome = await html(page);
			if (outcome.ok) {
				expect(outcome.document.blocks.length).toBeGreaterThan(0);
				for (const block of outcome.document.blocks) {
					const text =
						block.kind === "image-placeholder" ? block.alt : block.text;
					expect(text).not.toMatch(/<\/?(p|div|b|script|table|li)\b/);
				}
			} else {
				expect(outcome.message.length).toBeGreaterThan(0);
			}
		}
	});
});
