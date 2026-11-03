import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { parse } from "../src/index";
import {
	AES_128,
	container,
	encryptionXml,
	epub,
	opf,
	xhtml,
} from "./epub-builder";
import {
	expectError,
	expectSuccess,
	expectWellFormed,
	textsOf,
	utf8,
} from "./helpers";
import { storedDeflate, zip } from "./zip";

const MiB = 1024 * 1024;

const read = (bytes: Uint8Array, name = "book.epub") => parse(bytes, name);

/** A small seeded generator, so a failing case can be replayed exactly. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("epub hostile: ZIP structure that lies", () => {
	const good = () => epub({ chapters: [{ body: "<p>intact text</p>" }] });

	it("rejects a truncated package, with or without its end record", async () => {
		const bytes = good();
		expectError(
			await read(bytes.subarray(0, bytes.length >> 1)),
			"unsupported",
		);
		expectError(
			await read(bytes.subarray(0, bytes.length - 10)),
			"unsupported",
		);
		expectError(await read(bytes.subarray(0, 30)), "unsupported");
	});

	it("rejects a directory that claims more entries than it holds, or points outside the file", async () => {
		expectError(
			await read(epub({ zipOptions: { count: 500 } })),
			"unsupported",
		);
		expectError(
			await read(epub({ zipOptions: { directoryOffset: 99_999_999 } })),
			"unsupported",
		);
		expectError(
			await read(epub({ zipOptions: { directoryOffset: 0xffffffff } })),
			"unsupported",
		);
	});

	it("rejects a garbled local header", async () => {
		expectError(
			await read(epub({ zipOptions: { garbleLocal: 2 } })),
			"unsupported",
		);
	});

	it("rejects two entries with the name of the container or of a chapter", async () => {
		const twiceContainer = zip([
			{ name: "META-INF/container.xml", data: container() },
			{ name: "META-INF/container.xml", data: container("evil.opf") },
		]);
		expectError(await read(twiceContainer), "unsupported");
		const twiceChapter = epub({
			extra: [{ name: "OEBPS/c1.xhtml", data: xhtml("<p>second</p>") }],
		});
		expectError(await read(twiceChapter), "unsupported");
	});

	it("rejects a stored entry whose size lies, an unknown method and corrupt deflate", async () => {
		const lies = zip([
			{
				name: "META-INF/container.xml",
				data: container(),
				method: 0,
				claimedSize: 3,
			},
		]);
		expectError(await read(lies), "unsupported");
		const method = zip([
			{ name: "META-INF/container.xml", data: container(), rawMethod: 14 },
		]);
		expectError(await read(method), "unsupported");
		const corrupt = zip([
			{
				name: "META-INF/container.xml",
				data: "x",
				deflated: Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x12, 0x34]),
			},
		]);
		expectError(await read(corrupt), "unsupported");
	});
});

describe("epub hostile: size limits are typed too-big", {
	timeout: 90_000,
}, () => {
	it("refuses more than 10,000 entries but reads thousands", async () => {
		const filler = (n: number) =>
			Array.from({ length: n }, (_, i) => ({
				name: `OEBPS/media/i${i}.bin`,
				data: "",
				method: 0 as const,
			}));
		expectError(await read(epub({ extra: filler(10_001) })), "too-big");
		expect(textsOf(await read(epub({ extra: filler(9_000) })))).toEqual([
			"Hello EPUB world",
		]);
		expectError(await read(epub({ zipOptions: { count: 0xffff } })), "too-big");
	});

	it("refuses parts that declare more than 1 GiB between them", async () => {
		const huge = (i: number) => ({
			name: `OEBPS/media/h${i}.bin`,
			data: "",
			method: 0 as const,
			claimedSize: 600 * MiB,
		});
		expectError(await read(epub({ extra: [huge(1), huge(2)] })), "too-big");
	});

	it("stops a zip bomb in a chapter, however small the directory says it is", async () => {
		const bomb = deflateRawSync(Buffer.alloc(150 * MiB, 0x20), { level: 9 });
		expect(bomb.length).toBeLessThan(MiB);
		const bytes = zip([
			{ name: "META-INF/container.xml", data: container() },
			{
				name: "OEBPS/content.opf",
				data: opf({
					manifest: [{ id: "c1", href: "c1.xhtml" }],
					spine: [{ idref: "c1" }],
				}),
			},
			{
				name: "OEBPS/c1.xhtml",
				deflated: new Uint8Array(bomb),
				claimedSize: 100,
			},
		]);
		expectError(await read(bytes), "too-big");
	});

	it("stops a zip bomb in the container, the package document and encryption.xml", async () => {
		const bomb = new Uint8Array(
			deflateRawSync(Buffer.alloc(150 * MiB, 0x20), { level: 9 }),
		);
		const container_ = zip([
			{ name: "META-INF/container.xml", deflated: bomb, claimedSize: 10 },
		]);
		expectError(await read(container_), "too-big");
		const opf_ = zip([
			{ name: "META-INF/container.xml", data: container() },
			{ name: "OEBPS/content.opf", deflated: bomb, claimedSize: 10 },
		]);
		expectError(await read(opf_), "too-big");
		const enc = zip([
			{ name: "META-INF/container.xml", data: container() },
			{
				name: "OEBPS/content.opf",
				data: opf({
					manifest: [{ id: "c1", href: "c1.xhtml" }],
					spine: [{ idref: "c1" }],
				}),
			},
			{ name: "META-INF/encryption.xml", deflated: bomb, claimedSize: 10 },
			{ name: "OEBPS/c1.xhtml", data: xhtml("<p>x</p>") },
		]);
		expectError(await read(enc), "too-big");
	});

	it("stops a small, highly compressible chapter by its compression ratio", async () => {
		const bytes = epub({
			chapters: [{ raw: Buffer.alloc(3 * MiB, 0x20) }],
		});
		expectError(await read(bytes), "too-big");
	});

	it("stops a chapter past its ceiling even when it does not compress at all", async () => {
		const head = Buffer.from("<html><body><p>");
		const tail = Buffer.from("</p></body></html>");
		const xml = Buffer.concat([head, Buffer.alloc(40 * MiB, 0x61), tail]);
		const bytes = zip([
			{ name: "META-INF/container.xml", data: container() },
			{
				name: "OEBPS/content.opf",
				data: opf({
					manifest: [{ id: "c1", href: "c1.xhtml" }],
					spine: [{ idref: "c1" }],
				}),
			},
			{ name: "OEBPS/c1.xhtml", deflated: storedDeflate(xml) },
		]);
		expectError(await read(bytes), "too-big");
	});

	it("stops when the chapters together inflate past the package total", async () => {
		const text = "x".repeat(1_000_000);
		const chapters = Array.from({ length: 110 }, (_, i) => ({
			id: `c${i}`,
			body: `<p>${text}</p>`,
		}));
		expectError(await read(epub({ chapters })), "too-big");
	});

	it("reads a large real-looking book with an ordinary ratio", async () => {
		const rand = mulberry32(11);
		const words = Array.from({ length: 2000 }, () =>
			Array.from(
				{ length: 3 + Math.floor(rand() * 8) },
				() => "abcdefghijklmnopqrstuvwxyz"[Math.floor(rand() * 26)],
			).join(""),
		);
		const chapters = Array.from({ length: 40 }, (_, c) => {
			const paragraphs: string[] = [];
			for (let i = 0; i < 300; i++) {
				const parts: string[] = [];
				for (let j = 0; j < 40; j++) {
					parts.push(words[Math.floor(rand() * words.length)] as string);
				}
				paragraphs.push(`<p>${parts.join(" ")}</p>`);
			}
			return {
				id: `c${c}`,
				body: `<h1>Chapter ${c}</h1>${paragraphs.join("")}`,
			};
		});
		const result = expectSuccess(await read(epub({ chapters })));
		expect(result.document.blocks).toHaveLength(40 * 301);
	});

	it("stops with too-big instead of building millions of blocks", async () => {
		const body = "<p>x</p>".repeat(30_000);
		expectError(
			await parse(epub({ chapters: [{ body }] }), "a.epub", {
				maxBlocks: 1000,
			}),
			"too-big",
		);
	});

	it("refuses markup nested deeper than the HTML reader allows, in a chapter or the package document", async () => {
		const deep = (n: number) =>
			`${"<div>".repeat(n)}<p>core</p>${"</div>".repeat(n)}`;
		expect(
			textsOf(await read(epub({ chapters: [{ body: deep(400) }] }))),
		).toEqual(["core"]);
		expectError(
			await read(epub({ chapters: [{ body: deep(700) }] })),
			"too-big",
		);
		const nested = `<?xml version="1.0"?><package>${"<x>".repeat(400)}${"</x>".repeat(400)}</package>`;
		expectError(await read(epub({ rawOpf: nested })), "too-big");
	});
});

describe("epub hostile: paths cannot leave the book or reach out", () => {
	const hostilePaths = [
		"../../../../etc/passwd",
		"/etc/passwd",
		"file:///etc/passwd",
		"C:\\Windows\\win.ini",
		"..\\..\\secret.txt",
		"%2e%2e/%2e%2e/etc/passwd",
		"http://127.0.0.1:9/evil.xhtml",
		"\\\\server\\share\\x.xhtml",
		"OEBPS/c1.xhtml/../../../../etc/shadow",
		`${"../".repeat(5000)}x.xhtml`,
	];

	it("treats hostile rootfile paths as missing and answers with a typed error", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		for (const rootfile of hostilePaths) {
			const outcome = await read(epub({ rootfile }));
			expectWellFormed(outcome);
			expect(outcome.ok).toBe(false);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("never reads or fetches what a hostile manifest href names", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		for (const href of hostilePaths) {
			const outcome = await read(
				epub({
					chapters: [{ id: "ok", body: "<p>legitimate</p>" }],
					manifest: [
						{ id: "ok", href: "ok.xhtml" },
						{ id: "bad", href },
					],
					spine: [{ idref: "bad" }, { idref: "ok" }],
				}),
			);
			expect(textsOf(outcome)).toEqual(["legitimate"]);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("keeps a ../ path inside the archive: it can only find what the book holds", async () => {
		const bytes = zip([
			{ name: "META-INF/container.xml", data: container() },
			{
				name: "OEBPS/content.opf",
				data: opf({
					manifest: [{ id: "c1", href: "../../../../c1.xhtml" }],
					spine: [{ idref: "c1" }],
				}),
			},
			{ name: "c1.xhtml", data: xhtml("<p>Clamped to the book root</p>") },
		]);
		expect(textsOf(await read(bytes))).toEqual(["Clamped to the book root"]);
	});

	it("does not take entry names that try to climb out as anything but names", async () => {
		const bytes = epub({
			extra: [
				{ name: "../../etc/passwd", data: "root:x:0:0:root:/root:/bin/bash" },
				{ name: "/abs/evil.xhtml", data: xhtml("<p>root:x:0:0</p>") },
				{ name: "OEBPS/../../../x.xhtml", data: xhtml("<p>root:x:0:0</p>") },
			],
		});
		const outcome = await read(bytes);
		expect(textsOf(outcome)).toEqual(["Hello EPUB world"]);
		expect(JSON.stringify(outcome)).not.toContain("root:x");
	});

	it("does not load a nested package or an image named as a chapter", async () => {
		const inner = epub({ chapters: [{ body: "<p>INNER BOOK</p>" }] });
		const bytes = epub({
			chapters: [
				{
					id: "png",
					href: "a.xhtml",
					raw: Uint8Array.from([
						0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 1,
						2, 3,
					]),
				},
				{ id: "inner", href: "b.xhtml", raw: inner },
				{ id: "ok", body: "<p>The real chapter</p>" },
			],
		});
		const outcome = await read(bytes);
		expect(textsOf(outcome)).toEqual(["The real chapter"]);
		expect(JSON.stringify(outcome)).not.toContain("INNER BOOK");
	});

	it("says a book whose only chapter is binary has nothing to read", async () => {
		const bytes = epub({
			chapters: [{ raw: Uint8Array.from({ length: 400 }, (_, i) => i % 7) }],
		});
		expectError(await read(bytes), "unsupported");
	});
});

describe("epub hostile: a malicious package document", () => {
	const doctype = (decls: string) => `<!DOCTYPE package [${decls}]>`;

	it("does not read files or the network for SYSTEM entities in the OPF, container or chapter", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const decls =
			'<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY remote SYSTEM "http://127.0.0.1:9/evil"><!ENTITY % param SYSTEM "http://127.0.0.1:9/evil.dtd">%param;';
		const title = `<?xml version="1.0"?>${doctype(decls)}<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>&xxe;&remote;</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
		const outcome = await read(
			epub({
				rawOpf: title,
				rawContainer: `<?xml version="1.0"?>${doctype(decls)}${container()}`,
				chapters: [
					{
						raw: `<!DOCTYPE html [${decls}]><html><body><p>&xxe;&remote; visible</p></body></html>`,
					},
				],
			}),
		);
		expectWellFormed(outcome);
		expect(JSON.stringify(outcome)).not.toMatch(/root:|\/bin\/|nologin/);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("does not expand entities declared in the OPF or a chapter (billion laughs)", async () => {
		let decls = '<!ENTITY lol0 "lollollollollollollollollollol">';
		for (let i = 1; i <= 9; i++) {
			decls += `<!ENTITY lol${i} "${`&lol${i - 1};`.repeat(10)}">`;
		}
		const rawOpf = `<?xml version="1.0"?>${doctype(decls)}<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>&lol9;</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
		const chapter = `<!DOCTYPE html [${decls}]><html><body><p>&lol9;</p><p>fine</p></body></html>`;
		const outcome = await read(epub({ rawOpf, chapters: [{ raw: chapter }] }));
		expectWellFormed(outcome);
		const text = JSON.stringify(outcome);
		expect(text.length).toBeLessThan(10_000);
		expect(text).not.toContain("lollollol");
	});

	it("survives a spine that names one item 5,000 times, and refuses an absurd spine", async () => {
		const once = epub({
			chapters: [{ id: "a", body: "<p>Once</p>" }],
			spine: Array.from({ length: 5_000 }, () => ({ idref: "a" })),
		});
		expect(textsOf(await read(once))).toEqual(["Once"]);
		const huge = epub({
			chapters: [{ id: "a", body: "<p>Once</p>" }],
			spine: Array.from({ length: 150_000 }, () => ({ idref: "a" })),
		});
		expectError(await read(huge), "too-big");
	});

	it("survives a manifest whose fallbacks point at each other and at themselves", async () => {
		const bytes = epub({
			chapters: [
				{ id: "a", body: "<p>A text</p>" },
				{ id: "b", body: "<p>B text</p>" },
			],
			manifest: [
				{ id: "a", href: "a.xhtml", fallback: "b" },
				{ id: "b", href: "b.xhtml", fallback: "a" },
				{ id: "self", href: "a.xhtml", fallback: "self" },
			],
			spine: [{ idref: "self" }, { idref: "a" }, { idref: "b" }],
		});
		expectWellFormed(await read(bytes));
	});

	it("survives a container whose rootfile is the container itself, a chapter, or missing", async () => {
		expectError(
			await read(epub({ rootfile: "META-INF/container.xml" })),
			"unsupported",
		);
		expectError(
			await read(epub({ rootfile: "OEBPS/c1.xhtml" })),
			"unsupported",
		);
		expectError(await read(epub({ rootfile: "" })), "unsupported");
		expectError(
			await read(epub({ rawContainer: "<container><rootfiles/></container>" })),
			"unsupported",
		);
	});

	it("survives a flood of stray closing tags in the OPF and in a chapter", async () => {
		const stray = "</nothing>".repeat(60_000);
		const opfXml = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine>${stray}</package>`;
		expect(textsOf(await read(epub({ rawOpf: opfXml })))).toEqual([
			"Hello EPUB world",
		]);
		const body = `<p>still here</p>${stray}`;
		expect(textsOf(await read(epub({ chapters: [{ body }] })))).toEqual([
			"still here",
		]);
	});
});

describe("epub hostile: scripts, styles and active content in chapters", () => {
	it("keeps only the text and drops every active element and unsafe target", async () => {
		const body =
			"<script>window.SECRET_SCRIPT=1</script>" +
			"<style>.x{background:url(javascript:SECRET_STYLE)}</style>" +
			'<p onclick="SECRET_HANDLER()">Visible <a href="javascript:SECRET_JS()">link text</a> and <a href="  JaVa\tScRiPt:SECRET_JS2()">spaced</a> end.</p>' +
			'<iframe src="https://evil.example/SECRET_FRAME">SECRET_IFRAME</iframe>' +
			'<object data="x.swf">SECRET_OBJECT</object><embed src="x.swf"/>' +
			'<svg xmlns="http://www.w3.org/2000/svg"><script>SECRET_SVG()</script><text>SECRET_SVGTEXT</text></svg>' +
			"<math><mi>SECRET_MATH</mi></math>" +
			'<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==" alt="pic"/>' +
			'<form action="https://evil.example"><input value="SECRET_INPUT"/><button>SECRET_BUTTON</button></form>' +
			'<p style="display:none">SECRET_HIDDEN</p>' +
			"<p>Last.</p>";
		const outcome = await read(
			epub({
				chapters: [
					{
						raw: `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><script src="evil.js"/><link rel="stylesheet" href="https://evil.example/x.css"/></head><body>${body}</body></html>`,
					},
				],
			}),
		);
		const json = JSON.stringify(outcome);
		expect(json).not.toMatch(/SECRET|javascript:|data:|evil\.example|base64/i);
		const texts = textsOf(outcome);
		expect(texts).toContain("Visible link text and spaced end.");
		expect(texts).toContain("Last.");
	});

	it("never expands entities that are not predefined and keeps invalid references out", async () => {
		const outcome = await read(
			epub({
				chapters: [
					{
						body: "<p>&undefined; &#x110000; &#0; &#xD800; &amp;lt; ok</p>",
					},
				],
			}),
		);
		expectWellFormed(outcome);
		expect(JSON.stringify(outcome)).not.toMatch(/\\u0000/);
	});
});

describe("epub hostile: DRM detection is not fooled or crashed", () => {
	const chapters = [{ body: "<p>readable</p>" }];

	it("does not read entities or files named in encryption.xml", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const xml = `<?xml version="1.0"?><!DOCTYPE e [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="&xxe;"/><enc:CipherData><enc:CipherReference URI="OEBPS/c1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`;
		const outcome = await read(epub({ chapters, encryption: xml }));
		expectWellFormed(outcome);
		expect(JSON.stringify(outcome)).not.toMatch(/root:|nologin/);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("treats an encryption.xml that is not XML as saying nothing", async () => {
		expect(
			textsOf(
				await read(epub({ chapters, encryption: "\u0000\u0001 not xml <<<" })),
			),
		).toEqual(["readable"]);
	});

	it("handles an encryption.xml with 50,000 entries without trouble", async () => {
		const items = Array.from({ length: 50_000 }, (_, i) => ({
			uri: `OEBPS/f/${i}.otf`,
			algorithm: AES_128,
		}));
		expect(
			textsOf(await read(epub({ chapters, encryption: encryptionXml(items) }))),
		).toEqual(["readable"]);
		const withChapter = [
			...items,
			{ uri: "OEBPS/c1.xhtml", algorithm: AES_128 },
		];
		expectError(
			await read(epub({ chapters, encryption: encryptionXml(withChapter) })),
			"drm",
		);
	});
});

/**
 * Wall-clock budgets are flaky when suites share a machine. Each hostile case is timed
 * against a plain book of the same text size, parsed in the same run. A blowup misses the
 * ratio by orders of magnitude; load slows both sides alike.
 */
describe("epub hostile: no superlinear blowup", { timeout: 60_000 }, () => {
	const SLOWDOWN_LIMIT = 50;

	async function timed(bytes: Uint8Array): Promise<number> {
		const started = performance.now();
		await read(bytes);
		return performance.now() - started;
	}

	async function expectNoBlowup(body: string): Promise<void> {
		const unit = "<p>lorem ipsum dolor sit amet</p>";
		const plain = epub({
			chapters: [{ body: unit.repeat(Math.ceil(body.length / unit.length)) }],
		});
		const first = await timed(plain);
		const baseline = Math.max(first, await timed(plain));
		const elapsed = await timed(epub({ chapters: [{ body }] }));
		expect(
			elapsed,
			`${elapsed.toFixed(0)} ms against a ${baseline.toFixed(0)} ms linear baseline`,
		).toBeLessThan(Math.max(baseline, 20) * SLOWDOWN_LIMIT);
	}

	it("stray closers, unclosed openers and long attribute values", async () => {
		await expectNoBlowup("</b>".repeat(500_000));
		await expectNoBlowup("<b>".repeat(100_000));
		await expectNoBlowup(`<p class="${"a ".repeat(500_000)}">x</p>`);
		await expectNoBlowup("<a href='x'>".repeat(100_000));
	});

	it("a million entities and a single huge word", async () => {
		await expectNoBlowup("&amp;".repeat(1_000_000));
		await expectNoBlowup(`<p>${"w".repeat(2_000_000)}</p>`);
	});
});

describe("epub hostile: fuzz", { timeout: 90_000 }, () => {
	const fixture = (name: string) =>
		new Uint8Array(
			readFileSync(join(import.meta.dirname, "fixtures", "epub", name)),
		);

	it("never breaks the contract for mutated and truncated real files", async () => {
		const originals = [
			"calibre-epub3.epub",
			"calibre-epub2.epub",
			"sample.epub",
		].map(fixture);
		const rand = mulberry32(0xe0b);
		for (let i = 0; i < 300; i++) {
			const original = originals[i % originals.length] as Uint8Array;
			const bytes = original.slice();
			const flips = 1 + Math.floor(rand() * 8);
			for (let j = 0; j < flips; j++) {
				bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
			}
			const cut =
				rand() < 0.2 ? Math.floor(rand() * bytes.length) : bytes.length;
			expectWellFormed(
				await read(bytes.subarray(0, cut), i % 2 ? "a.epub" : "a.zip"),
			);
		}
	});

	it("never breaks the contract for mutated XML inside a stored package", async () => {
		const original = epub({
			method: 0,
			title: "Fuzz",
			language: "en",
			chapters: [
				{
					body: '<h1>Head</h1><p>Some <em>text</em> and <a href="https://example.org">link</a>.</p><ul><li>item</li></ul>',
				},
				{ body: "<p>Second</p>" },
			],
			encryption: encryptionXml([
				{ uri: "OEBPS/f.otf", algorithm: "http://www.idpf.org/2008/embedding" },
			]),
		});
		const rand = mulberry32(0xfeed);
		for (let i = 0; i < 500; i++) {
			const bytes = original.slice();
			const flips = 1 + Math.floor(rand() * 6);
			for (let j = 0; j < flips; j++) {
				const at = Math.floor(rand() * bytes.length);
				bytes[at] =
					rand() < 0.5
						? 0x3c + Math.floor(rand() * 4)
						: Math.floor(rand() * 256);
			}
			expectWellFormed(await read(bytes));
		}
	});

	it("never breaks the contract for random bytes behind a ZIP signature", async () => {
		const rand = mulberry32(99);
		for (let i = 0; i < 200; i++) {
			const bytes = new Uint8Array(40 + Math.floor(rand() * 400));
			for (let j = 0; j < bytes.length; j++) {
				bytes[j] = Math.floor(rand() * 256);
			}
			bytes.set([0x50, 0x4b, 0x03, 0x04]);
			expectWellFormed(await read(bytes, i % 2 ? "a.epub" : "a.zip"));
		}
		expectWellFormed(await read(utf8("PK"), "a.epub"));
	});
});
