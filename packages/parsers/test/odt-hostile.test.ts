import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { parse } from "../src/index";
import {
	expectError,
	expectSuccess,
	expectWellFormed,
	textsOf,
	utf8,
} from "./helpers";
import {
	contentXml,
	h,
	link,
	list,
	odt,
	p,
	row,
	span,
	table,
	textStyle,
} from "./odt-builder";
import { storedDeflate, zip } from "./zip";

const MiB = 1024 * 1024;

const read = (bytes: Uint8Array, name = "doc.odt") => parse(bytes, name);

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

describe("odt hostile: ZIP structure that lies", () => {
	const good = () => odt({ body: p("intact text") });

	it("rejects truncated packages, bad counts, bad offsets and garbled headers", async () => {
		const bytes = good();
		expectError(
			await read(bytes.subarray(0, bytes.length >> 1)),
			"unsupported",
		);
		expectError(
			await read(bytes.subarray(0, bytes.length - 10)),
			"unsupported",
		);
		expectError(
			await read(odt({ body: p("x") }, { count: 500 })),
			"unsupported",
		);
		expectError(
			await read(odt({ body: p("x") }, { directoryOffset: 99_999_999 })),
			"unsupported",
		);
		expectError(
			await read(odt({ body: p("x") }, { garbleLocal: 2 })),
			"unsupported",
		);
	});

	it("rejects two entries named content.xml", async () => {
		const bytes = zip([
			{ name: "content.xml", data: contentXml(p("first")) },
			{ name: "content.xml", data: contentXml(p("second")) },
		]);
		expectError(await read(bytes), "unsupported");
	});

	it("rejects a lying stored size, an unknown method and corrupt deflate", async () => {
		expectError(
			await read(
				zip([
					{
						name: "content.xml",
						data: contentXml(p("x")),
						method: 0,
						claimedSize: 4,
					},
				]),
			),
			"unsupported",
		);
		expectError(
			await read(zip([{ name: "content.xml", data: "x", rawMethod: 14 }])),
			"unsupported",
		);
		expectError(
			await read(
				zip([
					{
						name: "content.xml",
						data: "x",
						deflated: Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x12]),
					},
				]),
			),
			"unsupported",
		);
	});

	it("reports an entry encrypted at the ZIP level as drm", async () => {
		expectError(
			await read(zip([{ name: "content.xml", data: "x", flags: 0x0001 }])),
			"drm",
		);
	});
});

describe("odt hostile: size limits are typed too-big", {
	timeout: 90_000,
}, () => {
	it("stops a zip bomb in content.xml, styles.xml and the manifest", async () => {
		const bomb = new Uint8Array(
			deflateRawSync(Buffer.alloc(150 * MiB, 0x20), { level: 9 }),
		);
		expect(bomb.length).toBeLessThan(MiB);
		expectError(
			await read(
				zip([{ name: "content.xml", deflated: bomb, claimedSize: 10 }]),
			),
			"too-big",
		);
		expectError(
			await read(
				zip([
					{ name: "content.xml", data: contentXml(p("x")) },
					{ name: "styles.xml", deflated: bomb, claimedSize: 10 },
				]),
			),
			"too-big",
		);
		expectError(
			await read(
				zip([
					{ name: "content.xml", data: contentXml(p("x")) },
					{ name: "META-INF/manifest.xml", deflated: bomb, claimedSize: 10 },
				]),
			),
			"too-big",
		);
	});

	it("stops a small, highly compressible content.xml by its compression ratio", async () => {
		expectError(
			await read(
				zip([{ name: "content.xml", data: Buffer.alloc(3 * MiB, 0x20) }]),
			),
			"too-big",
		);
	});

	it("stops a content.xml past 64 MiB even when it does not compress", async () => {
		const xml = Buffer.concat([
			Buffer.from(
				'<?xml version="1.0"?><office:document-content><office:body><office:text><text:p>',
			),
			Buffer.alloc(66 * MiB, 0x61),
		]);
		expectError(
			await read(zip([{ name: "content.xml", deflated: storedDeflate(xml) }])),
			"too-big",
		);
	});

	it("refuses more than 10,000 entries and parts declaring over 1 GiB", async () => {
		const filler = Array.from({ length: 10_001 }, (_, i) => ({
			name: `Pictures/i${i}.bin`,
			data: "",
			method: 0 as const,
		}));
		expectError(await read(odt({ body: p("x"), extra: filler })), "too-big");
		const huge = (i: number) => ({
			name: `Pictures/h${i}.bin`,
			data: "",
			method: 0 as const,
			claimedSize: 600 * MiB,
		});
		expectError(
			await read(odt({ body: p("x"), extra: [huge(1), huge(2)] })),
			"too-big",
		);
	});

	it("allows nesting to 200 levels and refuses 300", async () => {
		const nest = (depth: number) =>
			`${'<text:span text:style-name="x">'.repeat(depth)}deep${"</text:span>".repeat(depth)}`;
		expect(
			textsOf(await read(odt({ body: `<text:p>${nest(200)}</text:p>` }))),
		).toEqual(["deep"]);
		expectError(
			await read(odt({ body: `<text:p>${nest(300)}</text:p>` })),
			"too-big",
		);
		const lists = (depth: number): string =>
			depth === 0 ? p("core") : list(null, lists(depth - 1));
		expectError(await read(odt({ body: lists(150) })), "too-big");
		const tables = (depth: number): string =>
			depth === 0
				? p("core")
				: table(
						row(`<table:table-cell>${tables(depth - 1)}</table:table-cell>`),
					);
		expectError(await read(odt({ body: tables(100) })), "too-big");
	});

	it("stops with too-big instead of building millions of blocks", async () => {
		const body = "<text:p>x</text:p>".repeat(30_000);
		expectError(
			await parse(odt({ body }), "a.odt", { maxBlocks: 1000 }),
			"too-big",
		);
	});

	it("reads a large document with an ordinary ratio", async () => {
		const rand = mulberry32(5);
		const words = Array.from({ length: 1000 }, () =>
			Array.from(
				{ length: 3 + Math.floor(rand() * 8) },
				() => "abcdefghijklmnopqrstuvwxyz"[Math.floor(rand() * 26)],
			).join(""),
		);
		const paragraphs: string[] = [];
		for (let i = 0; i < 12_000; i++) {
			const parts: string[] = [];
			for (let j = 0; j < 40; j++)
				parts.push(words[Math.floor(rand() * words.length)] as string);
			paragraphs.push(p(parts.join(" ")));
		}
		const result = expectSuccess(
			await read(odt({ body: paragraphs.join("") })),
		);
		expect(result.document.blocks).toHaveLength(12_000);
	});

	it("caps a flood of styles, spans, repeat counts and absurd repetition attributes", async () => {
		const styles = Array.from({ length: 60_000 }, (_, i) =>
			textStyle(`S${i}`, 'fo:font-weight="bold"'),
		).join("");
		expectWellFormed(
			await read(odt({ automatic: styles, body: p(`x ${span("S1", "y")}`) })),
		);
		const spans = Array.from({ length: 80_000 }, () => span("S1", "a")).join(
			" ",
		);
		expectWellFormed(
			await read(
				odt({
					automatic: textStyle("S1", 'fo:font-weight="bold"'),
					body: `<text:p>${spans}</text:p>`,
				}),
			),
		);
		const repeat = `<table:table table:name="T"><table:table-column table:number-columns-repeated="999999999"/><table:table-row table:number-rows-repeated="999999999"><table:table-cell table:number-columns-repeated="999999999"><text:p>cell</text:p></table:table-cell></table:table-row></table:table>`;
		const result = expectSuccess(await read(odt({ body: repeat })));
		expect(textsOf(result)).toEqual(["cell"]);
	});
});

describe("odt hostile: external entities and DTDs are never resolved", () => {
	const doctype = (decls: string) =>
		`<!DOCTYPE office:document-content [${decls}]>`;

	it("does not read files or the network for SYSTEM entities", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const raw = contentXml(
			`<text:p>&xxe;|&remote;|%param;</text:p>${p("visible")}`,
			"",
			doctype(
				'<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY remote SYSTEM "http://127.0.0.1:9/evil"><!ENTITY % param SYSTEM "http://127.0.0.1:9/evil.dtd">%param;',
			),
		);
		const outcome = await read(odt({ rawContent: raw }));
		expectWellFormed(outcome);
		expect(JSON.stringify(outcome)).not.toMatch(/root:|\/bin\/|nologin/);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
		if (outcome.ok) expect(textsOf(outcome)).toContain("visible");
	});

	it("does not expand entities declared in the document (billion laughs)", async () => {
		let decls = '<!ENTITY lol0 "lollollollollollollollollollol">';
		for (let i = 1; i <= 9; i++) {
			decls += `<!ENTITY lol${i} "${`&lol${i - 1};`.repeat(10)}">`;
		}
		const raw = contentXml(
			`<text:p>&lol9;</text:p>${p("fine")}`,
			"",
			doctype(decls),
		);
		const outcome = await read(odt({ rawContent: raw }));
		expectWellFormed(outcome);
		const text = JSON.stringify(outcome);
		expect(text.length).toBeLessThan(10_000);
		expect(text).not.toContain("lollollol");
	});

	it("ignores a DOCTYPE in styles.xml, meta.xml and the manifest as well", async () => {
		const bomb =
			'<?xml version="1.0"?><!DOCTYPE s [<!ENTITY x SYSTEM "file:///etc/hostname">]><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:styles><style:style style:name="&x;" style:family="text"/></office:styles></office:document-styles>';
		const bytes = zip([
			{ name: "content.xml", data: contentXml(p("ok")) },
			{ name: "styles.xml", data: bomb },
			{
				name: "meta.xml",
				data: bomb.replace("document-styles", "document-meta"),
			},
			{ name: "META-INF/manifest.xml", data: bomb },
		]);
		expect(textsOf(await read(bytes))).toEqual(["ok"]);
	});
});

describe("odt hostile: active content and odd structure", () => {
	it("ignores macros, scripts, embedded objects and form controls, and drops unsafe links", async () => {
		const secret = utf8('SECRET MACRO Sub AutoOpen() Shell("calc") End Sub');
		const body =
			p("visible text") +
			'<text:p><draw:frame><draw:object-ole xlink:href="Object 1"/></draw:frame><draw:frame><draw:object xlink:href="./Object 2"/></draw:frame></text:p>' +
			`<text:p>${link("javascript:SECRET_JS()", "click")} ${link("vbscript:SECRET()", "vb")} ${link("file:///etc/passwd", "local")} ${link("data:text/html,SECRET_DATA", "data")}</text:p>` +
			'<office:event-listeners><script:event-listener script:event-name="dom:click" xlink:href="vnd.sun.star.script:SECRET_SCRIPT"/></office:event-listeners>';
		const outcome = await read(
			odt({
				body,
				extra: [
					{ name: "Basic/Standard/Module1.xml", data: secret },
					{ name: "Scripts/python/evil.py", data: secret },
					{ name: "Object 1/content.xml", data: contentXml(p("SECRET OLE")) },
				],
			}),
		);
		expect(textsOf(outcome)[0]).toBe("visible text");
		expect(JSON.stringify(outcome)).not.toMatch(
			/SECRET|calc|Shell|javascript|vbscript|file:|data:/,
		);
	});

	it("survives odd attribute values and unknown elements", async () => {
		const body =
			'<text:h text:outline-level="-5">neg</text:h><text:h text:outline-level="1e9">huge</text:h><text:h text:outline-level="abc">word</text:h>' +
			'<text:p text:style-name="">empty style</text:p><text:p text:style-name="__proto__">proto</text:p><text:p text:style-name="constructor">ctor</text:p>' +
			'<weird:thing xmlns:weird="urn:x"><text:p>inside unknown</text:p></weird:thing>' +
			'<text:list text:style-name="nope"><text:list-item><text:p>l</text:p></text:list-item></text:list>';
		const outcome = await read(odt({ body }));
		expectWellFormed(outcome);
	});

	it("survives a flood of stray closing tags", async () => {
		const stray = "</text:nothing>".repeat(60_000);
		const outcome = await read(odt({ body: `${p("still here")}${stray}` }));
		expect(textsOf(outcome)).toEqual(["still here"]);
	});

	it("never gives a heading level or list depth outside what the model allows", async () => {
		const deepList = (depth: number): string =>
			depth === 0
				? p("leaf")
				: list(null, p(`d${depth}`) + deepList(depth - 1));
		const result = expectSuccess(
			await read(odt({ body: deepList(100) + h("h", 99) })),
		);
		for (const block of result.document.blocks) {
			if (block.kind === "list-item")
				expect(block.depth).toBeLessThanOrEqual(10);
			if (block.kind === "heading") expect(block.level).toBeLessThanOrEqual(6);
		}
	});
});

describe("odt hostile: fuzz", { timeout: 90_000 }, () => {
	const fixture = (name: string) =>
		new Uint8Array(
			readFileSync(join(import.meta.dirname, "fixtures", "odt", name)),
		);

	it("never breaks the contract for mutated and truncated real files", async () => {
		const originals = [
			"structure.odt",
			"turkish.odt",
			"password-protected.odt",
		].map(fixture);
		const rand = mulberry32(0x0d7);
		for (let i = 0; i < 300; i++) {
			const bytes = (originals[i % originals.length] as Uint8Array).slice();
			const flips = 1 + Math.floor(rand() * 8);
			for (let j = 0; j < flips; j++) {
				bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
			}
			const cut =
				rand() < 0.2 ? Math.floor(rand() * bytes.length) : bytes.length;
			expectWellFormed(await read(bytes.subarray(0, cut)));
		}
	});

	it("never breaks the contract for mutated XML inside a stored package", async () => {
		const original = odt({
			method: 0,
			title: "Fuzz",
			automatic: textStyle("T1", 'fo:font-weight="bold"'),
			body:
				h("Head", 1) +
				p(
					`Some ${span("T1", "bold")} text ${link("https://example.org", "link")}.`,
				) +
				list(null, p("item")) +
				table(row("a", "b")),
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
		const rand = mulberry32(77);
		for (let i = 0; i < 200; i++) {
			const bytes = new Uint8Array(40 + Math.floor(rand() * 400));
			for (let j = 0; j < bytes.length; j++)
				bytes[j] = Math.floor(rand() * 256);
			bytes.set([0x50, 0x4b, 0x03, 0x04]);
			expectWellFormed(await read(bytes));
		}
	});
});

/**
 * Wall-clock budgets are flaky when suites share a machine. Each hostile case is timed
 * against a plain document of the same size, parsed in the same run; a blowup misses the
 * ratio by orders of magnitude while load slows both sides alike.
 */
describe("odt hostile: no superlinear blowup", { timeout: 90_000 }, () => {
	const SLOWDOWN_LIMIT = 50;

	async function timed(bytes: Uint8Array): Promise<number> {
		const started = performance.now();
		await read(bytes);
		return performance.now() - started;
	}

	async function expectNoBlowup(body: string): Promise<void> {
		const unit = "<text:p>lorem ipsum dolor sit amet</text:p>";
		const plain = odt({
			body: unit.repeat(Math.ceil(body.length / unit.length)),
		});
		const first = await timed(plain);
		const baseline = Math.max(first, await timed(plain));
		const elapsed = await timed(odt({ body }));
		expect(
			elapsed,
			`${elapsed.toFixed(0)} ms against a ${baseline.toFixed(0)} ms linear baseline`,
		).toBeLessThan(Math.max(baseline, 20) * SLOWDOWN_LIMIT);
	}

	it("text nodes at the deepest allowed span nesting", async () => {
		const open = '<text:span text:style-name="S">'.repeat(240);
		await expectNoBlowup(
			`<text:p>${open}${"a<text:s/>".repeat(400_000)}${"</text:span>".repeat(240)}</text:p>`,
		);
	});

	it("many spans with made-up style names", async () => {
		await expectNoBlowup(
			`<text:p>${Array.from({ length: 150_000 }, (_, i) => `<text:span text:style-name="N${i}">a</text:span>`).join("")}</text:p>`,
		);
	});

	it("stray closers, unclosed openers and huge repeat counts", async () => {
		await expectNoBlowup("</text:x>".repeat(400_000));
		await expectNoBlowup("<text:p>".repeat(100_000));
		await expectNoBlowup(
			`<text:p>${'a<text:s text:c="999999999"/>'.repeat(100_000)}</text:p>`,
		);
	});
});
