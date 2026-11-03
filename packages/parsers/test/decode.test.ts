import { describe, expect, it } from "vitest";
import { decodeBytes, sniffMetaCharset } from "../src/index";
import { bytesOf, concat, utf8, utf16 } from "./helpers";

const ascii = (text: string) => utf8(text);

describe("sniffMetaCharset", () => {
	it("reads the charset from the common meta forms", () => {
		expect(
			sniffMetaCharset(ascii('<html><head><meta charset="windows-1254">')),
		).toBe("windows-1254");
		expect(sniffMetaCharset(ascii("<meta charset=utf-8>"))).toBe("utf-8");
		expect(
			sniffMetaCharset(
				ascii(
					'<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-2">',
				),
			),
		).toBe("ISO-8859-2");
		expect(
			sniffMetaCharset(
				ascii('<?xml version="1.0" encoding="windows-1251"?><fb2/>'),
			),
		).toBe("windows-1251");
	});

	it("finds nothing when there is no declaration or it lies past the first kilobyte", () => {
		expect(
			sniffMetaCharset(ascii("<html><body>hello</body></html>")),
		).toBeNull();
		expect(
			sniffMetaCharset(ascii(`${" ".repeat(2000)}<meta charset="utf-8">`)),
		).toBeNull();
		expect(sniffMetaCharset(new Uint8Array(0))).toBeNull();
	});

	it("stays quick on pathological heads", () => {
		const started = performance.now();
		sniffMetaCharset(ascii(`<meta ${'a="'.repeat(400)}`));
		sniffMetaCharset(ascii("<meta ".repeat(200)));
		sniffMetaCharset(ascii(`<?xml ${"encoding".repeat(100)}`));
		expect(performance.now() - started).toBeLessThan(200);
	});
});

describe("decodeBytes", () => {
	it("uses a meta declaration for markup, a codepage hint before it, a BOM before both", () => {
		const page = concat(
			ascii('<meta charset="windows-1254"><p>'),
			bytesOf(0xfd, 0xfe),
		);
		expect(decodeBytes(page, { sniffMeta: true })).toMatchObject({
			encoding: "windows-1254",
			text: '<meta charset="windows-1254"><p>ış',
		});
		expect(
			decodeBytes(page, { sniffMeta: true, encoding: "windows-1252" }).encoding,
		).toBe("windows-1252");
		const withBom = concat(
			bytesOf(0xef, 0xbb, 0xbf),
			ascii('<meta charset="windows-1254">é'),
		);
		expect(decodeBytes(withBom, { sniffMeta: true }).encoding).toBe("utf-8");
	});

	it("ignores a meta declaration for plain text unless asked", () => {
		const text = concat(ascii('<meta charset="windows-1254">'), bytesOf(0x61));
		expect(decodeBytes(text).encoding).toBe("utf-8");
	});

	it("falls back to UTF-8 when the declared charset is not one TextDecoder knows", () => {
		const page = ascii('<meta charset="klingon"><p>plain</p>');
		expect(decodeBytes(page, { sniffMeta: true }).encoding).toBe("utf-8");
	});

	it("throws a typed failure instead of a bare error", () => {
		const bad = (fn: () => unknown) => {
			try {
				fn();
			} catch (error) {
				return (error as { reason?: string }).reason;
			}
			return undefined;
		};
		expect(bad(() => decodeBytes(bytesOf(0xff, 0x41), {}))).toBe(
			"encoding-suspect",
		);
		expect(bad(() => decodeBytes(ascii("x"), { encoding: "nope" }))).toBe(
			"unsupported",
		);
		expect(bad(() => decodeBytes(bytesOf(0xff, 0xfe, 0, 0, 1, 0, 0, 0)))).toBe(
			"unsupported",
		);
	});

	it("decodes a SharedArrayBuffer-backed view that TextDecoder would refuse", () => {
		const shared = new SharedArrayBuffer(5);
		new Uint8Array(shared).set(ascii("hello"));
		expect(decodeBytes(new Uint8Array(shared)).text).toBe("hello");
	});

	it("strips the BOM from UTF-16 and keeps odd trailing bytes from throwing", () => {
		const odd = concat(utf16("hi", "le", true), bytesOf(0x41));
		expect(decodeBytes(odd).text.startsWith("hi")).toBe(true);
	});
});
