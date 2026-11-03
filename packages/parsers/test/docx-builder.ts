import { type ZipEntry, type ZipOptions, zip } from "./zip";

/** Builders for small DOCX packages written in test code (no Word, no LibreOffice). */

export const NS = [
	'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
	'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
	'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
	'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
	'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
	'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
	'xmlns:v="urn:schemas-microsoft-com:vml"',
	'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
].join(" ");

export const esc = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A run holding `text`, with optional run properties (`<w:b/>` and so on). */
export const run = (text: string, props = ""): string =>
	`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

/** A paragraph. A plain string becomes one run. */
export const para = (content: string, props = ""): string =>
	`<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content.startsWith("<") ? content : run(content)}</w:p>`;

export const styled = (styleId: string, content: string): string =>
	para(content, `<w:pStyle w:val="${styleId}"/>`);

export const listItem = (
	numId: number,
	level: number,
	content: string,
): string =>
	para(
		content,
		`<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`,
	);

export const cell = (content: string): string =>
	`<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>${content.startsWith("<") ? content : para(content)}</w:tc>`;

export const row = (...cells: string[]): string =>
	`<w:tr>${cells.map((c) => (c.startsWith("<w:tc>") ? c : cell(c))).join("")}</w:tr>`;

export const table = (...rows: string[]): string =>
	`<w:tbl><w:tblPr/><w:tblGrid/>${rows.join("")}</w:tbl>`;

export const documentXml = (body: string, doctype = ""): string =>
	`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${doctype}<w:document ${NS}><w:body>${body}</w:body></w:document>`;

export type StyleDef = {
	id: string;
	name: string;
	type?: "paragraph" | "character";
	basedOn?: string;
	outline?: number;
	numId?: number;
	level?: number;
	props?: string;
};

export function stylesXml(styles: StyleDef[]): string {
	const body = styles
		.map((s) => {
			const ppr = [
				s.outline === undefined ? "" : `<w:outlineLvl w:val="${s.outline}"/>`,
				s.numId === undefined
					? ""
					: `<w:numPr><w:ilvl w:val="${s.level ?? 0}"/><w:numId w:val="${s.numId}"/></w:numPr>`,
			].join("");
			return `<w:style w:type="${s.type ?? "paragraph"}" w:styleId="${s.id}"><w:name w:val="${s.name}"/>${
				s.basedOn ? `<w:basedOn w:val="${s.basedOn}"/>` : ""
			}${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${s.props ? `<w:rPr>${s.props}</w:rPr>` : ""}</w:style>`;
		})
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?><w:styles ${NS}>${body}</w:styles>`;
}

/** `abstract[i]` is the number format of each level of abstract list i; `nums` maps numId to i. */
export function numberingXml(
	abstract: Record<number, string[]>,
	nums: Record<number, number>,
): string {
	const abstracts = Object.entries(abstract)
		.map(
			([id, formats]) =>
				`<w:abstractNum w:abstractNumId="${id}">${formats
					.map(
						(fmt, level) =>
							`<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/></w:lvl>`,
					)
					.join("")}</w:abstractNum>`,
		)
		.join("");
	const numbers = Object.entries(nums)
		.map(
			([id, abstractId]) =>
				`<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/></w:num>`,
		)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>${abstracts}${numbers}</w:numbering>`;
}

export const relationships = (
	rels: { id: string; type: string; target: string; external?: boolean }[],
): string =>
	`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
		.map(
			(r) =>
				`<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${esc(r.target)}"${
					r.external ? ' TargetMode="External"' : ""
				}/>`,
		)
		.join("")}</Relationships>`;

export const link = (id: string, target: string) => ({
	id,
	type: "hyperlink",
	target,
	external: true,
});

export const coreXml = (title: string, language?: string): string =>
	`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title>${
		language ? `<dc:language>${language}</dc:language>` : ""
	}</cp:coreProperties>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

export type DocxParts = {
	/** The XML inside `<w:body>`, or a whole `document.xml` when `rawDocument` is set. */
	body?: string;
	rawDocument?: string | Uint8Array;
	styles?: string;
	numbering?: string;
	rels?: string;
	core?: string;
	/** Further entries (media, footnotes, macros), added as given. */
	extra?: ZipEntry[];
	method?: 0 | 8;
};

/** A minimal but valid DOCX package. */
export function docx(
	parts: DocxParts,
	options?: ZipOptions,
): Uint8Array<ArrayBuffer> {
	const method = parts.method;
	const entry = (name: string, data: string | Uint8Array): ZipEntry =>
		method === undefined ? { name, data } : { name, data, method };
	const entries: ZipEntry[] = [
		entry("[Content_Types].xml", CONTENT_TYPES),
		entry("_rels/.rels", ROOT_RELS),
		entry(
			"word/document.xml",
			parts.rawDocument ?? documentXml(parts.body ?? ""),
		),
	];
	if (parts.styles) entries.push(entry("word/styles.xml", parts.styles));
	if (parts.numbering) {
		entries.push(entry("word/numbering.xml", parts.numbering));
	}
	if (parts.rels) {
		entries.push(entry("word/_rels/document.xml.rels", parts.rels));
	}
	if (parts.core) entries.push(entry("docProps/core.xml", parts.core));
	if (parts.extra) entries.push(...parts.extra);
	return zip(entries, options);
}

/** A OLE compound file header followed by directory names, enough to name its streams. */
export function compoundFile(...streamNames: string[]): Uint8Array {
	const header = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
	const out: number[] = [...header, ...new Array(504).fill(0)];
	for (const name of streamNames) {
		for (const ch of name) {
			out.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8);
		}
		out.push(0, 0, ...new Array(62).fill(0));
	}
	return Uint8Array.from(out);
}
