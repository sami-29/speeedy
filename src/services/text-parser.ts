import type { ParsedDocument } from "../models/types.js";
import { countWords, htmlToPlainText } from "../utils/text-utils.js";

export async function parseFile(file: File): Promise<ParsedDocument> {
	const ext = file.name.split(".").pop()?.toLowerCase();

	if (ext === "pdf") return parsePdf(file);
	if (ext === "docx") return parseDocx(file);
	if (ext === "doc") return parseDocLegacy(file);
	if (ext === "txt" || ext === "md") return parsePlainText(file);
	if (ext === "rtf") return parseRtf(file);
	if (ext === "html" || ext === "htm") return parseHtml(file);
	if (ext === "csv") return parseCsv(file);
	if (ext === "odt") return parseOdt(file);

	if (ext === "epub" || ext === "zip") {
		try {
			return await parseEpub(file);
		} catch (e) {
			if (ext === "zip")
				throw new Error(
					"Unsupported ZIP content. Only EPUB books in ZIP format are supported.",
				);
			throw e;
		}
	}

	try {
		const text = await file.text();
		if (text.trim().length > 0) {
			return {
				title: file.name.replace(/\.[^.]+$/, ""),
				text: cleanText(text),
				wordCount: countWords(text),
			};
		}
	} catch {
		/* no-op */
	}

	throw new Error(
		`Unsupported file type: .${ext ?? "unknown"}. Supported formats: PDF, DOCX, DOC, TXT, MD, EPUB, RTF, HTML, ODT, CSV.`,
	);
}

async function parsePlainText(file: File): Promise<ParsedDocument> {
	const text = await file.text();
	return {
		title: file.name.replace(/\.[^.]+$/, ""),
		text: cleanText(text),
		wordCount: countWords(text),
	};
}

async function parsePdf(file: File): Promise<ParsedDocument> {
	const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
	const workerUrl = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
	GlobalWorkerOptions.workerSrc = workerUrl.default;

	const arrayBuffer = await file.arrayBuffer();
	const pdf = await getDocument({ data: arrayBuffer }).promise;
	const pageParts: string[] = [];

	for (let i = 1; i <= pdf.numPages; i++) {
		const page = await pdf.getPage(i);
		const content = await page.getTextContent();

		let lastY: number | null = null;
		let lastX: number | null = null;
		const lineBuffer: string[] = [];
		const lines: string[] = [];

		for (const item of content.items) {
			if (!("str" in item)) continue;
			const str = (item as { str: string }).str;
			if (!str) continue;

			const transform = (item as { transform?: number[] }).transform;
			const x = transform?.[4] ?? 0;
			const y = transform?.[5] ?? 0;
			const fontSize = transform?.[0] ?? 12;

			if (lastY !== null && Math.abs(y - lastY) > fontSize * 0.5) {
				if (lineBuffer.length > 0) {
					lines.push(lineBuffer.join(""));
					lineBuffer.length = 0;
				}
			} else if (
				lastX !== null &&
				x - lastX > fontSize * 0.3 &&
				lineBuffer.length > 0
			) {
				const last = lineBuffer[lineBuffer.length - 1];
				if (last && !last.endsWith(" ")) lineBuffer.push(" ");
			}

			lineBuffer.push(str);
			lastY = y;
			lastX = x + str.length * fontSize * 0.5;
		}

		if (lineBuffer.length > 0) lines.push(lineBuffer.join(""));
		pageParts.push(lines.join("\n"));
	}

	const text = cleanText(pageParts.join("\n\n"));
	return {
		title: file.name.replace(/\.pdf$/i, ""),
		text,
		wordCount: countWords(text),
	};
}

async function parseDocx(file: File): Promise<ParsedDocument> {
	const mammoth = await import("mammoth");
	const arrayBuffer = await file.arrayBuffer();
	const result = await mammoth.extractRawText({ arrayBuffer });
	const text = cleanText(result.value);
	return {
		title: file.name.replace(/\.docx$/i, ""),
		text,
		wordCount: countWords(text),
	};
}

async function parseDocLegacy(file: File): Promise<ParsedDocument> {
	try {
		const mammoth = await import("mammoth");
		const arrayBuffer = await file.arrayBuffer();
		const result = await mammoth.extractRawText({ arrayBuffer });
		if (result.value.trim().length > 0) {
			const text = cleanText(result.value);
			return {
				title: file.name.replace(/\.doc$/i, ""),
				text,
				wordCount: countWords(text),
			};
		}
	} catch {
		/* mammoth failed */
	}
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const chars: string[] = [];
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i];
		if (b >= 0x20 && b < 0x7f) chars.push(String.fromCharCode(b));
		else if (b === 0x0a || b === 0x0d) chars.push("\n");
	}
	const raw = chars.join("").replace(/[^\x20-\x7e\n]{3,}/g, " ");
	const text = cleanText(raw);
	if (text.trim().length < 50) {
		throw new Error(
			"Could not extract text from this .doc file. Try saving it as .docx or .txt first.",
		);
	}
	return {
		title: file.name.replace(/\.doc$/i, ""),
		text,
		wordCount: countWords(text),
	};
}

async function parseRtf(file: File): Promise<ParsedDocument> {
	const raw = await file.text();
	let text = raw
		.replace(/\{[^{}]*\}/g, " ")
		.replace(/\\[a-z]+\d*\s?/gi, "")
		.replace(/\\\*/g, "")
		.replace(/[{}\\]/g, "")
		.replace(/\r\n|\r/g, "\n");
	text = cleanText(text);
	if (text.trim().length < 10) {
		throw new Error(
			"Could not extract text from this RTF file. Try saving it as .txt or .docx.",
		);
	}
	return {
		title: file.name.replace(/\.rtf$/i, ""),
		text,
		wordCount: countWords(text),
	};
}

async function parseHtml(file: File): Promise<ParsedDocument> {
	const raw = await file.text();
	const text = cleanText(htmlToPlainText(raw));
	const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
	return {
		title: titleMatch?.[1]?.trim() ?? file.name.replace(/\.html?$/i, ""),
		text,
		wordCount: countWords(text),
	};
}

function parseCsvRow(row: string): string[] {
	const cells: string[] = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < row.length; i++) {
		const ch = row[i];
		if (ch === '"') {
			if (inQuotes && row[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === "," && !inQuotes) {
			cells.push(current.trim());
			current = "";
		} else {
			current += ch;
		}
	}
	cells.push(current.trim());
	return cells;
}

async function parseCsv(file: File): Promise<ParsedDocument> {
	const raw = await file.text();
	const text = cleanText(
		raw
			.split(/\r?\n/)
			.map((row) => parseCsvRow(row).filter(Boolean).join(" "))
			.filter(Boolean)
			.join("\n"),
	);
	return {
		title: file.name.replace(/\.csv$/i, ""),
		text,
		wordCount: countWords(text),
	};
}

async function parseOdt(file: File): Promise<ParsedDocument> {
	const { default: JSZip } = await import("jszip");
	let zip: import("jszip");
	try {
		zip = await JSZip.loadAsync(await file.arrayBuffer());
	} catch {
		throw new Error("Could not open ODT file as a valid archive.");
	}
	const contentFile = zip.file("content.xml");
	if (!contentFile) {
		throw new Error("Invalid ODT: content.xml not found.");
	}
	const xmlStr = await contentFile.async("string");
	const text = cleanText(htmlToPlainText(xmlStr));
	return {
		title: file.name.replace(/\.odt$/i, ""),
		text,
		wordCount: countWords(text),
	};
}

async function parseEpub(file: File): Promise<ParsedDocument> {
	const { default: JSZip } = await import("jszip");
	let zip: import("jszip");
	try {
		zip = await JSZip.loadAsync(await file.arrayBuffer());
	} catch {
		throw new Error("Could not open file as a valid archive.");
	}

	const opfFile = await findOpfFile(zip);
	if (!opfFile)
		throw new Error("Invalid EPUB: No content manifest (OPF) found.");

	const opfContent = await opfFile.async("string");
	const parser = new DOMParser();
	const opfDoc = parser.parseFromString(opfContent, "text/xml");

	const spineItems = extractSpineFromDoc(opfDoc);
	const manifestMap = extractManifestFromDoc(opfDoc);

	const basePath = opfFile.name.includes("/")
		? opfFile.name.substring(0, opfFile.name.lastIndexOf("/") + 1)
		: "";

	const parts: string[] = [];
	for (const idref of spineItems) {
		const href = manifestMap[idref];
		if (!href) continue;

		const fullPath = basePath + href;
		const normalizedPath = normalizeEpubPath(fullPath);

		const entry = zip.file(normalizedPath) ?? zip.file(href);
		if (!entry) continue;

		const html = await entry.async("string");
		parts.push(htmlToPlainText(html));
	}

	if (parts.length === 0) {
		throw new Error("EPUB appears to be empty or encrypted (DRM protected).");
	}

	const text = cleanText(parts.join("\n\n"));
	const title =
		extractEpubTitleFromDoc(opfDoc) ?? file.name.replace(/\.(epub|zip)$/i, "");

	return { title, text, wordCount: countWords(text) };
}

async function findOpfFile(zip: import("jszip")) {
	const containerFile = zip.file("META-INF/container.xml");
	if (!containerFile) return null;

	const containerContent = await containerFile.async("string");
	const parser = new DOMParser();
	const containerDoc = parser.parseFromString(containerContent, "text/xml");
	const rootFile = containerDoc.querySelector("rootfile");
	const fullPath = rootFile?.getAttribute("full-path");

	return fullPath ? zip.file(fullPath) : null;
}

function extractManifestFromDoc(doc: Document): Record<string, string> {
	const manifestItems: Record<string, string> = {};
	const items = doc.getElementsByTagName("item");
	for (let i = 0; i < items.length; i++) {
		const id = items[i].getAttribute("id");
		const href = items[i].getAttribute("href");
		if (id && href) manifestItems[id] = href;
	}
	return manifestItems;
}

function extractSpineFromDoc(doc: Document): string[] {
	const spineItems: string[] = [];
	const itemrefs = doc.getElementsByTagName("itemref");
	for (let i = 0; i < itemrefs.length; i++) {
		const idref = itemrefs[i].getAttribute("idref");
		if (idref) spineItems.push(idref);
	}
	return spineItems;
}

function extractEpubTitleFromDoc(doc: Document): string | null {
	const titleEl =
		doc.getElementsByTagName("dc:title")[0] ??
		doc.getElementsByTagName("title")[0];
	return titleEl?.textContent?.trim() ?? null;
}

function normalizeEpubPath(path: string): string {
	const parts = path.split("/");
	const stack: string[] = [];
	for (const part of parts) {
		if (part === "." || !part) continue;
		if (part === "..") {
			stack.pop();
		} else {
			stack.push(part);
		}
	}
	return stack.join("/");
}

function cleanText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function applyBionicReading(text: string): string {
	return text
		.split(" ")
		.map((word) => {
			const clean = word.replace(/[^\p{L}\p{N}]/gu, "");
			if (clean.length === 0) return escapeHtml(word);
			const leadingPunct = word.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? "";
			const boldLen =
				leadingPunct.length + Math.max(1, Math.ceil(clean.length * 0.4));
			return `<b>${escapeHtml(word.slice(0, boldLen))}</b>${escapeHtml(word.slice(boldLen))}`;
		})
		.join(" ");
}

export function createDocFromText(
	text: string,
	title = "Untitled",
): ParsedDocument {
	const cleaned = cleanText(text);
	return {
		title,
		text: cleaned,
		wordCount: countWords(cleaned),
	};
}
