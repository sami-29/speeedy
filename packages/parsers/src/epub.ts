import { clip, normalizeText, scanControls, tidyLine } from "./clean";
import { htmlToBlocks } from "./html";
import { type BlockSink, ParseFailure } from "./types";
import { decodeXml, readXml } from "./xml";
import { isZip, openZip, type ZipArchive } from "./zip";

/**
 * EPUB to Document blocks, with no DOM, so it runs in a Web Worker.
 *
 * An EPUB is a ZIP of XML and XHTML. `META-INF/container.xml` names the package document (the
 * OPF); the OPF lists every file (the manifest) and the order to read them in (the spine). Both
 * are read as XML, never as HTML, and with no DTD or entity resolution (see `xml.ts`). Each
 * chapter is XHTML and goes through the HTML reader in book mode, so chapter headings come out
 * as heading blocks for the reader to jump between.
 *
 * Choices that the format leaves open:
 * - Only manifest items that are HTML or XHTML are read. Images, SVG cover pages, style sheets,
 *   fonts, the EPUB 3 navigation document and anything else in the spine are skipped.
 * - A spine item marked `linear="no"` (a cover, footnote or answer page that the format lets a
 *   reader skip) is left out, unless every readable item is marked so.
 * - An item named twice in the spine is read once.
 * - A chapter that is a ZIP or looks like binary data is skipped, not read as text.
 * - A name in the manifest is only ever looked up inside the archive. It is never opened as a
 *   file or a URL: anything with a scheme is skipped, and `..` cannot climb above the root.
 * - DRM: `META-INF/encryption.xml` lists encrypted resources. The two font-obfuscation methods
 *   (IDPF and Adobe) are not encryption of the text and are ignored. Any other method on the
 *   package document or a chapter we would read, or one that names no resource at all, is DRM.
 *   Encrypted images or fonts alone do not stop the text from being read.
 */

export type EpubMeta = { title: string | null; language: string | null };

export type EpubOptions = {
	/** The file was named `.zip`, so a ZIP that is not a book gets the ZIP wording. */
	fromZip: boolean;
};

const MAX_CONTAINER = 1024 * 1024;
const MAX_PACKAGE = 16 * 1024 * 1024;
const MAX_ENCRYPTION = 8 * 1024 * 1024;
const MAX_CHAPTER = 32 * 1024 * 1024;
const MAX_ROOTFILES = 1000;
const MAX_MANIFEST = 100_000;
const MAX_SPINE = 100_000;
const MAX_ENCRYPTED = 200_000;
const MAX_TITLE = 200;
const MAX_TITLE_SOURCE = 4000;
const MAX_ALGORITHM = 500;

const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";
const IDPF_OBFUSCATION = "http://www.idpf.org/2008/embedding";
const ADOBE_OBFUSCATION = "http://ns.adobe.com/pdf/enc#RC";

const DRM_MESSAGE =
	"This book is protected by DRM (copy protection), so Speeedy cannot open it. Use a copy of the book without DRM.";

const unsupported = (why: string): ParseFailure =>
	new ParseFailure("unsupported", why);

const tooBig = (why: string): ParseFailure => new ParseFailure("too-big", why);

const local = (name: string): string => name.slice(name.indexOf(":") + 1);

// ---------------------------------------------------------------------------------------
// Paths inside the archive
// ---------------------------------------------------------------------------------------

/** `a/./b/../c` to `a/c`. A `..` at the root is dropped, so nothing climbs out of the book. */
function normalizePath(path: string): string {
	const out: string[] = [];
	for (const part of path.replace(/\\/g, "/").split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
}

function decodePercent(path: string): string | null {
	try {
		const decoded = decodeURIComponent(path);
		return decoded === path ? null : decoded;
	} catch {
		return null;
	}
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The names an href could mean inside the archive, best first: the percent-decoded path, then
 * the path as written. A relative href is taken from `folder`; one that starts with a slash is
 * taken from the root. A name with a scheme (`http:`, `file:`, `C:`) is not in the archive.
 * Fragments and queries are cut off, and `..` stops at the root.
 */
function candidates(href: string, folder = ""): string[] {
	if (HAS_SCHEME.test(href.slice(0, 40).trim())) return [];
	let path = href;
	const cut = path.search(/[#?]/);
	if (cut >= 0) path = path.slice(0, cut);
	const decoded = decodePercent(path);
	const names: string[] = [];
	for (const option of decoded === null ? [path] : [decoded, path]) {
		const root = option.startsWith("/") || option.startsWith("\\");
		const name = normalizePath(
			root || folder === "" ? option : `${folder}/${option}`,
		);
		if (name !== "" && !names.includes(name)) names.push(name);
	}
	return names;
}

const folderOf = (path: string): string => {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
};

// ---------------------------------------------------------------------------------------
// Reading parts
// ---------------------------------------------------------------------------------------

/** Read a part, and say "DRM" rather than "Word" when the ZIP itself marks it encrypted. */
async function readPart(
	zip: ZipArchive,
	name: string,
	max: number,
): Promise<Uint8Array | null> {
	try {
		return await zip.read(name, max);
	} catch (error) {
		if (error instanceof ParseFailure && error.reason === "drm") {
			throw new ParseFailure("drm", DRM_MESSAGE);
		}
		throw error;
	}
}

async function readFirst(
	zip: ZipArchive,
	names: string[],
	max: number,
): Promise<{ name: string; bytes: Uint8Array } | null> {
	for (const name of names) {
		const bytes = await readPart(zip, name, max);
		if (bytes !== null) return { name, bytes };
	}
	return null;
}

// ---------------------------------------------------------------------------------------
// Container, package document and encryption
// ---------------------------------------------------------------------------------------

function findRootfile(xml: string): string | null {
	const files: { path: string; type: string }[] = [];
	readXml(xml, {
		open(name, attribs) {
			if (local(name) !== "rootfile" || files.length >= MAX_ROOTFILES) return;
			const path = attribs["full-path"];
			if (path !== undefined) {
				files.push({ path, type: attribs["media-type"] ?? "" });
			}
		},
	});
	const packaged = files.find(
		(file) =>
			file.type === "" ||
			file.type.toLowerCase() === "application/oebps-package+xml",
	);
	return (packaged ?? files[0])?.path ?? null;
}

type ManifestItem = { href: string; type: string; properties: string };
type SpineItem = { idref: string; linear: boolean };

type Opf = {
	title: string | null;
	language: string | null;
	manifest: Map<string, ManifestItem>;
	spine: SpineItem[];
};

function readPackage(xml: string): Opf {
	const opf: Opf = {
		title: null,
		language: null,
		manifest: new Map(),
		spine: [],
	};
	const dcPrefixes = new Set<string>(["dc"]);
	let manifest = 0;
	let spine = 0;
	let capture: "title" | "language" | null = null;
	let captured = "";
	readXml(xml, {
		open(name, attribs) {
			for (const [key, value] of Object.entries(attribs)) {
				if (key.startsWith("xmlns:") && value === DC_NAMESPACE) {
					dcPrefixes.add(key.slice(6));
				}
			}
			const colon = name.indexOf(":");
			const tag = name.slice(colon + 1);
			const dc = colon > 0 && dcPrefixes.has(name.slice(0, colon));
			if (tag === "manifest") manifest++;
			else if (tag === "spine") spine++;
			else if (dc && tag === "title" && opf.title === null) {
				capture = "title";
				captured = "";
			} else if (dc && tag === "language" && opf.language === null) {
				capture = "language";
				captured = "";
			} else if (tag === "item" && manifest > 0) {
				const id = attribs.id;
				const href = attribs.href;
				if (id === undefined || href === undefined || opf.manifest.has(id)) {
					return;
				}
				if (opf.manifest.size >= MAX_MANIFEST) {
					throw tooBig("This book lists more files than Speeedy can open.");
				}
				opf.manifest.set(id, {
					href,
					type: (attribs["media-type"] ?? "").toLowerCase(),
					properties: attribs.properties ?? "",
				});
			} else if (tag === "itemref" && spine > 0) {
				const idref = attribs.idref;
				if (idref === undefined) return;
				if (opf.spine.length >= MAX_SPINE) {
					throw tooBig("This book has more chapters than Speeedy can open.");
				}
				opf.spine.push({
					idref,
					linear: (attribs.linear ?? "yes").toLowerCase() !== "no",
				});
			}
		},
		close(name) {
			const tag = local(name);
			if (tag === "manifest") manifest--;
			else if (tag === "spine") spine--;
			else if (capture !== null && tag === capture) {
				const value = clip(tidyLine(normalizeText(captured)), MAX_TITLE);
				if (value !== "") opf[capture] = value;
				capture = null;
			}
		},
		text(data) {
			if (capture !== null && captured.length < MAX_TITLE_SOURCE) {
				captured += data;
			}
		},
	});
	return opf;
}

type Encryption = {
	/** Lower-case archive paths of resources with real (non-obfuscation) encryption. */
	paths: Set<string>;
	/** Real encryption that names no resource we could match: the whole book is suspect. */
	unnamed: boolean;
};

function readEncryption(xml: string): Encryption {
	const found: Encryption = { paths: new Set(), unnamed: false };
	let algorithm: string | null = null;
	let uri: string | null = null;
	let open = false;
	let count = 0;
	readXml(xml, {
		open(name, attribs) {
			const tag = local(name);
			if (tag === "EncryptedData") {
				open = true;
				algorithm = null;
				uri = null;
				if (++count > MAX_ENCRYPTED) {
					throw tooBig(
						"This book lists more encrypted files than Speeedy can open.",
					);
				}
			} else if (open && tag === "EncryptionMethod") {
				algorithm = clip(attribs.Algorithm ?? "", MAX_ALGORITHM);
			} else if (open && tag === "CipherReference") {
				uri = attribs.URI ?? null;
			}
		},
		close(name) {
			if (local(name) !== "EncryptedData" || !open) return;
			open = false;
			if (algorithm === IDPF_OBFUSCATION || algorithm === ADOBE_OBFUSCATION) {
				return;
			}
			const names = uri === null ? [] : candidates(uri);
			if (names.length === 0) found.unnamed = true;
			for (const name of names) found.paths.add(name.toLowerCase());
		},
	});
	return found;
}

const HTML_TYPE = /html|oeb1-document|dtbook/;
const HTML_EXTENSION = /\.(?:x?html?|xml)$/i;

function isChapter(item: ManifestItem): boolean {
	if (item.properties.split(/\s+/).includes("nav")) return false;
	if (item.type === "")
		return HTML_EXTENSION.test(item.href.split(/[#?]/)[0] ?? "");
	return HTML_TYPE.test(item.type);
}

const looksBinary = (bytes: Uint8Array, text: string): boolean => {
	if (isZip(bytes)) return true;
	const { controls } = scanControls(text);
	return controls >= 4 && controls / Math.max(text.length, 1) > 0.1;
};

/**
 * Turn EPUB bytes into blocks. Throws `ParseFailure` for a protected, corrupt or oversized
 * book; the caller turns that into a typed `ParseError`.
 */
export async function epubToBlocks(
	bytes: Uint8Array,
	sink: BlockSink,
	options: EpubOptions,
): Promise<EpubMeta> {
	const notABook = unsupported(
		options.fromZip
			? "Unsupported ZIP content. Only EPUB books in ZIP format are supported."
			: "This file is not a valid EPUB book.",
	);
	if (!isZip(bytes)) throw notABook;
	const zip = openZip(bytes);

	const containerPart = await readFirst(
		zip,
		["META-INF/container.xml"],
		MAX_CONTAINER,
	);
	if (containerPart === null) throw notABook;
	const rootfile = findRootfile(decodeXml(containerPart.bytes));
	const opfNames = rootfile === null ? [] : candidates(rootfile);
	if (opfNames.length === 0) throw notABook;

	const encryptionPart = await readPart(
		zip,
		"META-INF/encryption.xml",
		MAX_ENCRYPTION,
	);
	const encryption =
		encryptionPart === null ? null : readEncryption(decodeXml(encryptionPart));
	if (encryption?.unnamed) throw new ParseFailure("drm", DRM_MESSAGE);
	const isEncrypted = (names: string[]): boolean =>
		encryption !== null &&
		names.some((name) => encryption.paths.has(name.toLowerCase()));

	if (isEncrypted(opfNames)) throw new ParseFailure("drm", DRM_MESSAGE);
	const opfPart = await readFirst(zip, opfNames, MAX_PACKAGE);
	if (opfPart === null) throw notABook;
	const opf = readPackage(decodeXml(opfPart.bytes));
	const folder = folderOf(opfPart.name);

	const eligible: { item: SpineItem; names: string[] }[] = [];
	const seenIds = new Set<string>();
	for (const item of opf.spine) {
		if (seenIds.has(item.idref)) continue;
		seenIds.add(item.idref);
		const entry = opf.manifest.get(item.idref);
		if (entry === undefined || !isChapter(entry)) continue;
		const names = candidates(entry.href, folder);
		if (names.length > 0) eligible.push({ item, names });
	}
	const linear = eligible.filter((entry) => entry.item.linear);
	const reading = linear.length > 0 ? linear : eligible;

	let readable = 0;
	const seenPaths = new Set<string>();
	for (const { names } of reading) {
		if (names.every((name) => seenPaths.has(name))) continue;
		for (const name of names) seenPaths.add(name);
		if (isEncrypted(names)) throw new ParseFailure("drm", DRM_MESSAGE);
		const part = await readFirst(zip, names, MAX_CHAPTER);
		if (part === null) continue;
		const text = decodeXml(part.bytes);
		if (looksBinary(part.bytes, text)) continue;
		readable++;
		htmlToBlocks(text, sink, { book: true });
	}
	if (readable === 0) {
		throw unsupported("This EPUB has no chapters Speeedy can read.");
	}
	const hasText = sink.blocks.some(
		(block) => block.kind !== "image-placeholder" && block.text !== "",
	);
	if (!hasText) {
		throw new ParseFailure("empty", "There is no text in this file.");
	}
	return { title: opf.title, language: opf.language };
}
