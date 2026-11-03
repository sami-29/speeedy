import { type ZipEntry, type ZipOptions, zip } from "./zip";

/** Builders for small EPUB packages written in test code (no Calibre, no real book). */

export const esc = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A chapter document. `body` goes inside `<body>`. */
export const xhtml = (body: string, head = ""): string =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title>${head}</head><body>${body}</body></html>`;

export const container = (opfPath = "OEBPS/content.opf"): string =>
	`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${esc(opfPath)}" media-type="application/oebps-package+xml"/></rootfiles></container>`;

export type ManifestItem = {
	id: string;
	href: string;
	type?: string;
	properties?: string;
	fallback?: string;
};

export type SpineItem = { idref: string; linear?: "yes" | "no" };

export type OpfOptions = {
	title?: string | null;
	language?: string | null;
	manifest: ManifestItem[];
	spine: SpineItem[];
	/** Extra markup inside `<metadata>`. */
	metadata?: string;
	/** Written before `<package>`, for example a DOCTYPE. */
	prolog?: string;
};

export function opf(options: OpfOptions): string {
	const manifest = options.manifest
		.map(
			(item) =>
				`<item id="${esc(item.id)}" href="${esc(item.href)}" media-type="${esc(
					item.type ?? "application/xhtml+xml",
				)}"${item.properties ? ` properties="${item.properties}"` : ""}${
					item.fallback ? ` fallback="${item.fallback}"` : ""
				}/>`,
		)
		.join("");
	const spine = options.spine
		.map(
			(item) =>
				`<itemref idref="${esc(item.idref)}"${item.linear ? ` linear="${item.linear}"` : ""}/>`,
		)
		.join("");
	const title =
		options.title === null
			? ""
			: `<dc:title>${esc(options.title ?? "Test Book")}</dc:title>`;
	const language =
		options.language === null || options.language === undefined
			? ""
			: `<dc:language>${options.language}</dc:language>`;
	return `<?xml version="1.0" encoding="UTF-8"?>${options.prolog ?? ""}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${title}${language}<dc:identifier id="uid">urn:test</dc:identifier>${options.metadata ?? ""}</metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`;
}

export type Chapter = {
	/** Defaults to `c1`, `c2`, ... by position. */
	id?: string;
	/** File name inside the OPF folder. Defaults to `<id>.xhtml`. */
	href?: string;
	/** Inside `<body>` unless `raw` is set. */
	body?: string;
	/** The whole file, as bytes or text. */
	raw?: string | Uint8Array;
	linear?: "yes" | "no";
	properties?: string;
	type?: string;
};

export type EpubOptions = {
	chapters?: Chapter[];
	title?: string | null;
	language?: string | null;
	/** Folder of the OPF inside the package; default `OEBPS`. */
	folder?: string;
	/** Replace the generated manifest or spine. */
	manifest?: ManifestItem[];
	spine?: SpineItem[];
	metadata?: string;
	prolog?: string;
	/** Replace the whole OPF or container text. */
	rawOpf?: string | Uint8Array;
	rawContainer?: string | Uint8Array;
	/** The `full-path` in the container; default is the generated OPF path. */
	rootfile?: string;
	/** `META-INF/encryption.xml`, when the book has one. */
	encryption?: string;
	/** Further entries, added as given (media, fonts, rights.xml ...). */
	extra?: ZipEntry[];
	method?: 0 | 8;
	zipOptions?: ZipOptions;
	/** Leave out the `mimetype` entry. */
	noMimetype?: boolean;
};

/** A minimal, valid EPUB 3 package. */
export function epub(options: EpubOptions = {}): Uint8Array<ArrayBuffer> {
	const method = options.method;
	const entry = (name: string, data: string | Uint8Array): ZipEntry =>
		method === undefined ? { name, data } : { name, data, method };
	const chapters = options.chapters ?? [{ body: "<p>Hello EPUB world</p>" }];
	const named = chapters.map((chapter, index) => {
		const id = chapter.id ?? `c${index + 1}`;
		return { ...chapter, id, href: chapter.href ?? `${id}.xhtml` };
	});
	const folder = options.folder ?? "OEBPS";
	const prefix = folder === "" ? "" : `${folder}/`;
	const opfPath = `${prefix}content.opf`;
	const manifest =
		options.manifest ??
		named.map((chapter) => ({
			id: chapter.id,
			href: chapter.href,
			...(chapter.properties ? { properties: chapter.properties } : {}),
			...(chapter.type ? { type: chapter.type } : {}),
		}));
	const spine =
		options.spine ??
		named.map((chapter) => ({
			idref: chapter.id,
			...(chapter.linear ? { linear: chapter.linear } : {}),
		}));
	const entries: ZipEntry[] = [];
	if (!options.noMimetype) {
		entries.push({
			name: "mimetype",
			data: "application/epub+zip",
			method: 0,
		});
	}
	entries.push(
		entry(
			"META-INF/container.xml",
			options.rawContainer ?? container(options.rootfile ?? opfPath),
		),
		entry(
			opfPath,
			options.rawOpf ??
				opf({
					title: options.title === undefined ? "Test Book" : options.title,
					language: options.language ?? null,
					manifest,
					spine,
					...(options.metadata ? { metadata: options.metadata } : {}),
					...(options.prolog ? { prolog: options.prolog } : {}),
				}),
		),
	);
	if (options.encryption !== undefined) {
		entries.push(entry("META-INF/encryption.xml", options.encryption));
	}
	for (const chapter of named) {
		entries.push(
			entry(
				`${prefix}${chapter.href}`,
				chapter.raw ?? xhtml(chapter.body ?? ""),
			),
		);
	}
	if (options.extra) entries.push(...options.extra);
	return zip(entries, options.zipOptions);
}

const ENC_NS = "http://www.w3.org/2001/04/xmlenc#";

/** An `encryption.xml` listing resources with the given algorithms. */
export function encryptionXml(
	items: { uri?: string; algorithm: string }[],
): string {
	const data = items
		.map(
			(item) =>
				`<enc:EncryptedData xmlns:enc="${ENC_NS}"><enc:EncryptionMethod Algorithm="${esc(item.algorithm)}"/>${
					item.uri === undefined
						? ""
						: `<enc:CipherData><enc:CipherReference URI="${esc(item.uri)}"/></enc:CipherData>`
				}</enc:EncryptedData>`,
		)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="${ENC_NS}">${data}</encryption>`;
}

export const IDPF_FONT = "http://www.idpf.org/2008/embedding";
export const ADOBE_FONT = "http://ns.adobe.com/pdf/enc#RC";
export const AES_128 = `${ENC_NS}aes128-cbc`;
