import { type Handler, Parser } from "htmlparser2";
import { ParseFailure } from "./types";

/**
 * A guarded XML reader for office packages. It never resolves entities, DTDs or external
 * references: `htmlparser2` knows only the five predefined entities and numeric references,
 * ignores `<!ENTITY>` declarations and `<!DOCTYPE>` altogether, and never fetches anything. On
 * top of that this wrapper bounds nesting depth and element count, and drops closing tags for
 * elements that are not open, because the parser looks each closing tag up by walking its whole
 * open-element list (depth times file size for a flood of stray closers).
 */

export const MAX_XML_DEPTH = 256;
export const MAX_XML_ELEMENTS = 5_000_000;

/**
 * Namespaces whose prefixes are renamed to the conventional one, so a package that binds
 * Word's namespace to `ns0:` or to the default namespace reads the same as one that uses `w:`.
 * Both the transitional and the strict URIs are listed.
 */
const CANONICAL_PREFIXES: Record<string, string> = {
	"http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
	"http://purl.oclc.org/ooxml/wordprocessingml/main": "w",
	"http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
	"http://purl.oclc.org/ooxml/officeDocument/relationships": "r",
	"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing":
		"wp",
	"http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing": "wp",
	"http://schemas.openxmlformats.org/drawingml/2006/main": "a",
	"http://purl.oclc.org/ooxml/drawingml/main": "a",
	"http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",
	"http://purl.oclc.org/ooxml/drawingml/picture": "pic",
	"http://schemas.openxmlformats.org/markup-compatibility/2006": "mc",
	"urn:schemas-microsoft-com:vml": "v",
	"http://purl.org/dc/elements/1.1/": "dc",
};

type Renamer = (name: string, isAttribute: boolean) => string;

/** A renaming function for the root element's namespace declarations, or null if none is needed. */
function prefixRenamer(attribs: Record<string, string>): Renamer | null {
	const renames = new Map<string, string>();
	let fallback: string | null = null;
	for (const [key, uri] of Object.entries(attribs)) {
		const canonical = CANONICAL_PREFIXES[uri];
		if (canonical === undefined) continue;
		if (key === "xmlns") {
			fallback = canonical;
		} else if (key.startsWith("xmlns:")) {
			const prefix = key.slice(6);
			if (prefix !== canonical) renames.set(prefix, canonical);
		}
	}
	if (renames.size === 0 && fallback === null) return null;
	return (name, isAttribute) => {
		const colon = name.indexOf(":");
		if (colon < 0) {
			return isAttribute || fallback === null ? name : `${fallback}:${name}`;
		}
		const renamed = renames.get(name.slice(0, colon));
		return renamed === undefined ? name : `${renamed}${name.slice(colon)}`;
	};
}

export type XmlHandlers = {
	open?: (name: string, attribs: Record<string, string>) => void;
	close?: (name: string) => void;
	text?: (data: string) => void;
};

class GuardedXmlParser extends Parser {
	private readonly source: string;
	private readonly open: ReadonlyMap<string, number>;

	constructor(
		handlers: Partial<Handler>,
		source: string,
		open: ReadonlyMap<string, number>,
	) {
		super(handlers, {
			xmlMode: true,
			decodeEntities: true,
			lowerCaseTags: false,
			lowerCaseAttributeNames: false,
		});
		this.source = source;
		this.open = open;
	}

	override onclosetag(start: number, endIndex: number): void {
		const name = this.source.slice(start, endIndex);
		if (!this.open.has(name)) {
			this.endIndex = endIndex;
			this.startIndex = endIndex + 1;
			return;
		}
		super.onclosetag(start, endIndex);
	}
}

/**
 * Read `xml` in one pass and call the handlers. Element and attribute names arrive with the
 * conventional prefixes (`w:`, `r:`, `wp:`, ...) however the file spelled them. Throws
 * `ParseFailure("too-big")` past a limit.
 */
export function readXml(xml: string, handlers: XmlHandlers): void {
	const open = new Map<string, number>();
	let depth = 0;
	let elements = 0;
	let rename: Renamer | null = null;
	const parser = new GuardedXmlParser(
		{
			onopentag(name, attribs) {
				open.set(name, (open.get(name) ?? 0) + 1);
				if (++elements > MAX_XML_ELEMENTS) {
					throw new ParseFailure(
						"too-big",
						"This file has more markup than Speeedy can open.",
					);
				}
				if (++depth > MAX_XML_DEPTH) {
					throw new ParseFailure(
						"too-big",
						"This file is nested too deeply for Speeedy to open.",
					);
				}
				if (elements === 1) rename = prefixRenamer(attribs);
				if (rename === null) {
					handlers.open?.(name, attribs);
					return;
				}
				const renamed = Object.create(null) as Record<string, string>;
				for (const [key, value] of Object.entries(attribs)) {
					renamed[rename(key, true)] = value;
				}
				handlers.open?.(rename(name, false), renamed);
			},
			onclosetag(name) {
				const count = open.get(name) ?? 0;
				if (count <= 1) open.delete(name);
				else open.set(name, count - 1);
				depth--;
				handlers.close?.(rename === null ? name : rename(name, false));
			},
			ontext(data) {
				handlers.text?.(data);
			},
		},
		xml,
		open,
	);
	parser.end(xml);
}

/** Decode a package part: UTF-8 (BOM stripped) or UTF-16 when a BOM says so. */
export function decodeXml(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return new TextDecoder("utf-16le").decode(bytes);
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return new TextDecoder("utf-16be").decode(bytes);
	}
	return new TextDecoder("utf-8").decode(bytes);
}
