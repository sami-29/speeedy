import { type ZipEntry, type ZipOptions, zip } from "./zip";

/** Builders for small ODT packages written in test code (no LibreOffice). */

export const NS = [
	'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
	'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
	'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
	'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
	'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
	'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
	'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
	'xmlns:xlink="http://www.w3.org/1999/xlink"',
	'xmlns:dc="http://purl.org/dc/elements/1.1/"',
	'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
	'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"',
].join(" ");

export const esc = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MARKUP = /<[a-z]+:/;

export const p = (text: string, style = "Text_20_body"): string =>
	`<text:p text:style-name="${style}">${MARKUP.test(text) ? text : esc(text)}</text:p>`;

export const h = (
	text: string,
	level: number | null,
	style = "Heading",
): string =>
	`<text:h text:style-name="${style}"${
		level === null ? "" : ` text:outline-level="${level}"`
	}>${MARKUP.test(text) ? text : esc(text)}</text:h>`;

export const span = (style: string, text: string): string =>
	`<text:span text:style-name="${style}">${esc(text)}</text:span>`;

export const link = (href: string, text: string): string =>
	`<text:a xlink:type="simple" xlink:href="${esc(href)}">${esc(text)}</text:a>`;

export const list = (style: string | null, ...items: string[]): string =>
	`<text:list${style ? ` text:style-name="${style}"` : ""}>${items
		.map((item) => `<text:list-item>${item}</text:list-item>`)
		.join("")}</text:list>`;

export const cell = (content: string): string =>
	`<table:table-cell office:value-type="string">${content.startsWith("<") ? content : p(content, "Table_20_Contents")}</table:table-cell>`;

export const row = (...cells: string[]): string =>
	`<table:table-row>${cells.map((c) => (c.startsWith("<table:") ? c : cell(c))).join("")}</table:table-row>`;

export const table = (...rows: string[]): string =>
	`<table:table table:name="T1"><table:table-column/>${rows.join("")}</table:table>`;

export const image = (alt: string, href = "Pictures/a.png"): string =>
	`<draw:frame draw:name="Image1" text:anchor-type="as-char" svg:width="2in" svg:height="1in"><draw:image xlink:href="${href}" xlink:type="simple"/>${
		alt ? `<svg:title>${esc(alt)}</svg:title>` : ""
	}</draw:frame>`;

/** A paragraph style with text properties (bold, italic) for automatic or named styles. */
export const textStyle = (
	name: string,
	props: string,
	options: { family?: string; parent?: string; display?: string } = {},
): string =>
	`<style:style style:name="${name}" style:family="${options.family ?? "text"}"${
		options.parent ? ` style:parent-style-name="${options.parent}"` : ""
	}${options.display ? ` style:display-name="${options.display}"` : ""}><style:text-properties ${props}/></style:style>`;

export const BOLD = 'fo:font-weight="bold"';
export const ITALIC = 'fo:font-style="italic"';

export const listStyle = (
	name: string,
	kinds: ("number" | "bullet")[],
): string =>
	`<text:list-style style:name="${name}">${kinds
		.map((kind, index) =>
			kind === "number"
				? `<text:list-level-style-number text:level="${index + 1}" style:num-format="1"/>`
				: `<text:list-level-style-bullet text:level="${index + 1}" text:bullet-char="•"/>`,
		)
		.join("")}</text:list-style>`;

export const contentXml = (body: string, automatic = "", prolog = ""): string =>
	`<?xml version="1.0" encoding="UTF-8"?>${prolog}<office:document-content ${NS} office:version="1.3"><office:automatic-styles>${automatic}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;

export const stylesXml = (named = "", automatic = ""): string =>
	`<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS} office:version="1.3"><office:styles>${named}</office:styles><office:automatic-styles>${automatic}</office:automatic-styles><office:master-styles><style:master-page style:name="Standard"><style:header><text:p>PAGE HEADER TEXT</text:p></style:header></style:master-page></office:master-styles></office:document-styles>`;

export const metaXml = (title: string | null, language?: string): string =>
	`<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} office:version="1.3"><office:meta>${
		title === null ? "" : `<dc:title>${esc(title)}</dc:title>`
	}${language ? `<dc:language>${language}</dc:language>` : ""}</office:meta></office:document-meta>`;

export const MIME = "application/vnd.oasis.opendocument.text";

export const manifestXml = (
	entries: { path: string; encrypted?: boolean }[] = [],
): string =>
	`<?xml version="1.0" encoding="UTF-8"?><manifest:manifest ${NS} manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME}"/>${entries
		.map(
			(entry) =>
				`<manifest:file-entry manifest:full-path="${esc(entry.path)}" manifest:media-type="text/xml">${
					entry.encrypted
						? '<manifest:encryption-data manifest:checksum-type="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#sha256-1k" manifest:checksum="AAAA"><manifest:algorithm manifest:algorithm-name="http://www.w3.org/2001/04/xmlenc#aes256-cbc" manifest:initialisation-vector="AAAA"/><manifest:key-derivation manifest:key-derivation-name="PBKDF2" manifest:iteration-count="100000" manifest:salt="AAAA" manifest:key-size="32"/></manifest:encryption-data>'
						: ""
				}</manifest:file-entry>`,
		)
		.join("")}</manifest:manifest>`;

export type OdtParts = {
	/** Inside `<office:text>`. */
	body?: string;
	automatic?: string;
	named?: string;
	stylesAutomatic?: string;
	title?: string | null;
	language?: string;
	mimetype?: string | null;
	rawContent?: string | Uint8Array;
	/** Lists these paths in the manifest, `encrypted` ones with encryption data. */
	manifest?: { path: string; encrypted?: boolean }[];
	noContent?: boolean;
	extra?: ZipEntry[];
	method?: 0 | 8;
};

/** A minimal but valid ODT package. */
export function odt(
	parts: OdtParts,
	options?: ZipOptions,
): Uint8Array<ArrayBuffer> {
	const method = parts.method;
	const entry = (name: string, data: string | Uint8Array): ZipEntry =>
		method === undefined ? { name, data } : { name, data, method };
	const entries: ZipEntry[] = [];
	if (parts.mimetype !== null) {
		entries.push({
			name: "mimetype",
			data: parts.mimetype ?? MIME,
			method: 0,
		});
	}
	if (!parts.noContent) {
		entries.push(
			entry(
				"content.xml",
				parts.rawContent ?? contentXml(parts.body ?? "", parts.automatic ?? ""),
			),
		);
	}
	entries.push(
		entry(
			"styles.xml",
			stylesXml(parts.named ?? "", parts.stylesAutomatic ?? ""),
		),
		entry(
			"META-INF/manifest.xml",
			manifestXml(parts.manifest ?? [{ path: "content.xml" }]),
		),
	);
	if (parts.title !== undefined) {
		entries.push(entry("meta.xml", metaXml(parts.title, parts.language)));
	}
	if (parts.extra) entries.push(...parts.extra);
	return zip(entries, options);
}
