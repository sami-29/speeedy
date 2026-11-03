import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { parse } from "../src/index";
import {
	compoundFile,
	docx,
	documentXml,
	listItem,
	numberingXml,
	para,
	run,
	table,
	row,
} from "./docx-builder";
import {
	expectError,
	expectSuccess,
	expectWellFormed,
	textsOf,
	utf8,
} from "./helpers";
import { zip } from "./zip";

const MiB = 1024 * 1024;

const read = (bytes: Uint8Array, name = "doc.docx") => parse(bytes, name);

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

describe("docx: protected files are drm", () => {
	it("recognises an encrypted package inside an OLE compound file", async () => {
		const bytes = compoundFile("EncryptionInfo", "EncryptedPackage");
		expectError(await read(bytes), "drm");
	});

	it("recognises rights-managed (IRM) packages", async () => {
		const bytes = compoundFile("\u0006DataSpaces", "DRMEncryptedTransform");
		expectError(await read(bytes), "drm");
	});

	it("does not call an old .doc renamed to .docx protected", async () => {
		const bytes = compoundFile("WordDocument", "1Table");
		expectError(await read(bytes), "unsupported");
		expectError(await read(compoundFile("Workbook")), "unsupported");
	});

	it("reports an encrypted main part, including WinZip AES, as drm", async () => {
		const flagged = zip([
			{ name: "word/document.xml", data: "x", flags: 0x0001 },
			{ name: "_rels/.rels", data: "x" },
		]);
		expectError(await read(flagged), "drm");
		const aes = zip([
			{ name: "word/document.xml", data: "x", rawMethod: 99, flags: 0x0041 },
		]);
		expectError(await read(aes), "drm");
	});

	it("still reads the document when only an unrelated part is encrypted", async () => {
		const bytes = docx({
			body: para("readable"),
			extra: [{ name: "word/media/secret.bin", data: "x", flags: 0x0001 }],
		});
		expect(textsOf(await read(bytes))).toEqual(["readable"]);
	});
});

describe("docx: ZIP structure that lies", () => {
	const good = () => docx({ body: para("intact text") });

	it("reads stored entries, data-descriptor entries and a trailing comment", async () => {
		expect(textsOf(await read(docx({ body: para("a"), method: 0 })))).toEqual([
			"a",
		]);
		const entries = [
			{ name: "[Content_Types].xml", data: "<Types/>" },
			{
				name: "word/document.xml",
				data: documentXml(para("descriptor")),
				flags: 0x0008,
			},
		];
		expect(textsOf(await read(zip(entries)))).toEqual(["descriptor"]);
		const comment = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, 1, 2, 3, 4, 5, 6]);
		expect(
			textsOf(await read(zip(entries, { comment }))),
		).toEqual(["descriptor"]);
	});

	it("follows the package relationship to the main part", async () => {
		const bytes = zip([
			{
				name: "_rels/.rels",
				data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/main.xml"/></Relationships>',
			},
			{ name: "word/main.xml", data: documentXml(para("elsewhere")) },
		]);
		expect(textsOf(await read(bytes))).toEqual(["elsewhere"]);
	});

	it("matches part names without regard to case", async () => {
		const bytes = zip([
			{ name: "Word/Document.XML", data: documentXml(para("cased")) },
		]);
		expect(textsOf(await read(bytes))).toEqual(["cased"]);
	});

	it("rejects a truncated package, with or without its end record", async () => {
		const bytes = good();
		expectError(await read(bytes.subarray(0, bytes.length >> 1)), "unsupported");
		expectError(await read(bytes.subarray(0, bytes.length - 10)), "unsupported");
		expectError(await read(bytes.subarray(0, 30)), "unsupported");
	});

	it("rejects a directory that claims more entries than it holds", async () => {
		const bytes = docx({ body: para("x") }, { count: 500 });
		expectError(await read(bytes), "unsupported");
	});

	it("rejects a directory offset outside the file and a garbled local header", async () => {
		expectError(
			await read(docx({ body: para("x") }, { directoryOffset: 99_999_999 })),
			"unsupported",
		);
		expectError(
			await read(docx({ body: para("x") }, { garbleLocal: 2 })),
			"unsupported",
		);
	});

	it("rejects two entries with the name of the main part", async () => {
		const bytes = zip([
			{ name: "word/document.xml", data: documentXml(para("first")) },
			{ name: "word/document.xml", data: documentXml(para("second")) },
		]);
		expectError(await read(bytes), "unsupported");
	});

	it("rejects a stored entry whose size does not match its data", async () => {
		const bytes = zip([
			{
				name: "word/document.xml",
				data: documentXml(para("x")),
				method: 0,
				claimedSize: 5,
			},
		]);
		expectError(await read(bytes), "unsupported");
	});

	it("rejects an unknown compression method", async () => {
		const bytes = zip([
			{ name: "word/document.xml", data: "x", rawMethod: 14 },
		]);
		expectError(await read(bytes), "unsupported");
	});

	it("rejects corrupt deflate data", async () => {
		const bytes = zip([
			{
				name: "word/document.xml",
				data: "x",
				deflated: Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x12, 0x34]),
			},
		]);
		expectError(await read(bytes), "unsupported");
	});
});

describe("docx: limits are typed too-big", () => {
	it("refuses a package with more than 10,000 entries but reads one with thousands", async () => {
		const filler = (n: number) =>
			Array.from({ length: n }, (_, i) => ({
				name: `word/media/i${i}.bin`,
				data: "",
				method: 0 as const,
			}));
		const many = zip([
			{ name: "word/document.xml", data: documentXml(para("hi")) },
			...filler(10_001),
		]);
		expectError(await read(many), "too-big");
		const some = zip([
			{ name: "word/document.xml", data: documentXml(para("hi")) },
			...filler(9_000),
		]);
		expect(textsOf(await read(some))).toEqual(["hi"]);
		const flagged = docx({ body: para("x") }, { count: 0xffff });
		expectError(await read(flagged), "too-big");
	});

	it("refuses a package whose parts declare more than 1 GiB uncompressed", async () => {
		const huge = (i: number) => ({
			name: `word/media/h${i}.bin`,
			data: "",
			method: 0 as const,
			claimedSize: 600 * MiB,
		});
		const bytes = zip([
			{ name: "word/document.xml", data: documentXml(para("hi")) },
			huge(1),
			huge(2),
		]);
		expectError(await read(bytes), "too-big");
	});

	it("stops a zip bomb however small the sizes in the directory claim to be", async () => {
		const bomb = deflateRawSync(Buffer.alloc(150 * MiB, 0x20), { level: 9 });
		expect(bomb.length).toBeLessThan(MiB);
		const bytes = zip([
			{
				name: "word/document.xml",
				deflated: new Uint8Array(bomb),
				claimedSize: 100,
			},
		]);
		expectError(await read(bytes), "too-big");
	});

	it("stops a small, highly compressible part by its compression ratio", async () => {
		const bytes = zip([
			{ name: "word/document.xml", data: Buffer.alloc(3 * MiB, 0x20) },
		]);
		expectError(await read(bytes), "too-big");
	});

	it("stops a part past 64 MiB even when it compresses normally", async () => {
		const rand = mulberry32(7);
		const chunk = Buffer.alloc(MiB);
		for (let i = 0; i < chunk.length; i++) {
			chunk[i] = 97 + Math.floor(rand() * 26);
		}
		const text = Buffer.concat(Array.from({ length: 66 }, () => chunk));
		const xml = Buffer.concat([
			Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body><!--`),
			text,
			Buffer.from("--></w:body></w:document>"),
		]);
		const bytes = zip([
			{
				name: "word/document.xml",
				deflated: new Uint8Array(deflateRawSync(xml, { level: 1 })),
			},
		]);
		expectError(await read(bytes), "too-big");
	});

	it("reads a large real-looking document with an ordinary ratio", async () => {
		const rand = mulberry32(11);
		const words = Array.from({ length: 2000 }, () =>
			Array.from(
				{ length: 3 + Math.floor(rand() * 8) },
				() => "abcdefghijklmnopqrstuvwxyz"[Math.floor(rand() * 26)],
			).join(""),
		);
		const paragraphs: string[] = [];
		for (let i = 0; i < 12_000; i++) {
			const parts: string[] = [];
			for (let j = 0; j < 40; j++) {
				parts.push(words[Math.floor(rand() * words.length)] as string);
			}
			paragraphs.push(para(parts.join(" ")));
		}
		const outcome = expectSuccess(
			await read(docx({ body: paragraphs.join("") })),
		);
		expect(outcome.document.blocks).toHaveLength(12_000);
	});

	it("allows nesting to 200 levels and refuses 300", async () => {
		const nest = (depth: number) =>
			'<w:smartTag w:element="x">'.repeat(depth) +
			run("deep") +
			"</w:smartTag>".repeat(depth);
		expect(
			textsOf(await read(docx({ body: para(nest(200)) }))),
		).toEqual(["deep"]);
		expectError(await read(docx({ body: para(nest(300)) })), "too-big");
		const tables = (depth: number): string =>
			depth === 0
				? para("core")
				: table(row(`<w:tc>${tables(depth - 1)}</w:tc>`));
		expectError(await read(docx({ body: tables(150) })), "too-big");
	});

	it("survives a flood of stray closing tags", async () => {
		const stray = "</w:nothing>".repeat(100_000);
		const outcome = await read(
			docx({ rawDocument: documentXml(para("still here") + stray) }),
		);
		expect(textsOf(outcome)).toEqual(["still here"]);
	});

	it("stops with too-big instead of building millions of blocks", async () => {
		const body = "<w:p><w:r><w:t>x</w:t></w:r></w:p>".repeat(30_000);
		expectError(
			await parse(docx({ body }), "a.docx", { maxBlocks: 1000 }),
			"too-big",
		);
	});

	it("caps absurd list levels and numbering tables", async () => {
		const outcome = await read(
			docx({
				numbering: numberingXml({ 0: ["bullet"] }, { 1: 0 }),
				body: listItem(1, 4_000_000, "x") + listItem(1, -3, "y"),
			}),
		);
		expectWellFormed(outcome);
	});
});

describe("docx: external entities and DTDs are never resolved", () => {
	const doctype = (decls: string) => `<!DOCTYPE w:document [${decls}]>`;

	it("does not read files or the network for SYSTEM entities", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const xml = documentXml(
			para("<w:r><w:t>&xxe;|&remote;|%param;</w:t></w:r>") +
				para("visible"),
			doctype(
				'<!ENTITY xxe SYSTEM "file:///etc/passwd">' +
					'<!ENTITY remote SYSTEM "http://127.0.0.1:9/evil">' +
					'<!ENTITY % param SYSTEM "http://127.0.0.1:9/evil.dtd">%param;',
			),
		);
		const outcome = await read(docx({ rawDocument: xml }));
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
		const xml = documentXml(
			`<w:p><w:r><w:t>&lol9;</w:t></w:r></w:p>${para("fine")}`,
			doctype(decls),
		);
		const outcome = await read(docx({ rawDocument: xml }));
		expectWellFormed(outcome);
		const text = JSON.stringify(outcome);
		expect(text.length).toBeLessThan(10_000);
		expect(text).not.toContain("lollollol");
	});

	it("ignores a DOCTYPE in the other parts as well", async () => {
		const bomb = `<?xml version="1.0"?><!DOCTYPE w:styles [<!ENTITY x SYSTEM "file:///etc/hostname">]><w:styles xmlns:w="x"><w:style w:type="paragraph" w:styleId="A"><w:name w:val="&x;"/></w:style></w:styles>`;
		const outcome = await read(docx({ body: para("ok"), styles: bomb }));
		expect(textsOf(outcome)).toEqual(["ok"]);
	});
});

describe("docx: macros and embedded objects are ignored", () => {
	it("reads the text and never the macro project or OLE objects", async () => {
		const secret = utf8("SECRET MACRO Sub AutoOpen() Shell(\"calc\") End Sub");
		const object =
			'<w:p><w:r><w:object><v:shape><v:imagedata r:id="rId9"/></v:shape><o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" r:id="rId8" xmlns:o="urn:schemas-microsoft-com:office:office"/></w:object></w:r></w:p>';
		const outcome = await read(
			docx({
				body: para("visible text") + object,
				extra: [
					{ name: "word/vbaProject.bin", data: secret },
					{ name: "word/embeddings/oleObject1.bin", data: secret },
					{ name: "word/activeX/activeX1.xml", data: "<ax SECRET/>" },
				],
			}),
		);
		expect(textsOf(outcome)[0]).toBe("visible text");
		expect(JSON.stringify(outcome)).not.toMatch(/SECRET|calc|Shell/);
	});
});

describe("docx: fuzz", () => {
	it("never breaks the contract for mutated and truncated real files", async () => {
		const original = new Uint8Array(
			readFileSync(
				join(import.meta.dirname, "fixtures", "docx", "structure.docx"),
			),
		);
		const rand = mulberry32(0xd0c);
		for (let i = 0; i < 250; i++) {
			const bytes = original.slice();
			const flips = 1 + Math.floor(rand() * 8);
			for (let j = 0; j < flips; j++) {
				bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
			}
			const cut = rand() < 0.2 ? Math.floor(rand() * bytes.length) : bytes.length;
			expectWellFormed(await read(bytes.subarray(0, cut)));
		}
	});

	it("never breaks the contract for mutated XML inside a stored package", async () => {
		const body =
			para("Heading", '<w:pStyle w:val="Heading1"/>') +
			para(run("bold", "<w:b/>") + run(" text")) +
			table(row("a", "b")) +
			listItem(1, 1, "item");
		const original = docx({
			method: 0,
			body,
			numbering: numberingXml({ 0: ["bullet", "decimal"] }, { 1: 0 }),
		});
		const rand = mulberry32(0xfeed);
		for (let i = 0; i < 400; i++) {
			const bytes = original.slice();
			const flips = 1 + Math.floor(rand() * 6);
			for (let j = 0; j < flips; j++) {
				const at = Math.floor(rand() * bytes.length);
				bytes[at] = rand() < 0.5 ? 0x3c + Math.floor(rand() * 4) : Math.floor(rand() * 256);
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
			expectWellFormed(await read(bytes));
		}
	});
});
