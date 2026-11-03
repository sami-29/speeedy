import { createHash } from "node:crypto";

/**
 * A tiny PDF writer for tests. It lays text out at exact coordinates with the built-in
 * Helvetica fonts, can draw an image-only (scanned-looking) page, and can encrypt with the
 * standard security handler (RC4, 40 bit). Generating files here keeps every test PDF
 * free of any licence question and lets a test place each line precisely.
 */

export type TextRun = {
	x: number;
	/** Baseline, measured up from the bottom of the page like PDF itself. */
	y: number;
	text: string;
	size?: number;
	bold?: boolean;
	/** Rotate 90 degrees counter-clockwise, like a margin stamp. */
	rotate?: boolean;
};

export type PdfPage = {
	width?: number;
	height?: number;
	runs?: TextRun[];
	/** Draw one full-page image and no text, like a scan. */
	scan?: boolean;
	/** Raw content stream bytes, used instead of `runs` (for hostile content). */
	content?: { data: Uint8Array; filter?: string };
};

export type PdfOptions = {
	pages: PdfPage[];
	encrypt?: { userPassword: string; ownerPassword?: string };
	/** Write this page count into the page tree whatever the real number of pages is. */
	claimedPageCount?: number;
	/** The document title for the Info dictionary (ignored when encrypting). */
	title?: string;
};

const PAD = Uint8Array.from([
	0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
	0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
	0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** The WinAnsi bytes for the few typographic characters the tests use. */
const WIN_ANSI: Record<number, number> = {
	8364: 0x80,
	8230: 0x85,
	8216: 0x91,
	8217: 0x92,
	8220: 0x93,
	8221: 0x94,
	8226: 0x95,
	8211: 0x96,
	8212: 0x97,
};

const latin1 = (text: string): Uint8Array => {
	const out = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		out[i] = WIN_ANSI[code] ?? (code < 256 ? code : 63);
	}
	return out;
};

const md5 = (...parts: Uint8Array[]): Uint8Array => {
	const hash = createHash("md5");
	for (const part of parts) hash.update(part);
	return new Uint8Array(hash.digest());
};

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
	const s = new Uint8Array(256);
	for (let i = 0; i < 256; i++) s[i] = i;
	let j = 0;
	for (let i = 0; i < 256; i++) {
		j = (j + (s[i] ?? 0) + (key[i % key.length] ?? 0)) & 255;
		[s[i], s[j]] = [s[j] ?? 0, s[i] ?? 0];
	}
	const out = new Uint8Array(data.length);
	let a = 0;
	let b = 0;
	for (let k = 0; k < data.length; k++) {
		a = (a + 1) & 255;
		b = (b + (s[a] ?? 0)) & 255;
		[s[a], s[b]] = [s[b] ?? 0, s[a] ?? 0];
		out[k] = (data[k] ?? 0) ^ (s[((s[a] ?? 0) + (s[b] ?? 0)) & 255] ?? 0);
	}
	return out;
}

const padded = (password: string): Uint8Array => {
	const out = new Uint8Array(32);
	const given = latin1(password).slice(0, 32);
	out.set(given);
	out.set(PAD.slice(0, 32 - given.length), given.length);
	return out;
};

const hex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const escapeText = (text: string): string =>
	text.replace(/[\\()]/g, (c) => `\\${c}`);

const concat = (parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
};

type Crypto = { key: Uint8Array; encryptDict: string; id: Uint8Array };

function makeCrypto(user: string, owner: string): Crypto {
	const id = md5(latin1("speeedy-test-id"));
	const ownerKey = md5(padded(owner)).slice(0, 5);
	const o = rc4(ownerKey, padded(user));
	const permissions = -4;
	const p = new Uint8Array(4);
	new DataView(p.buffer).setInt32(0, permissions, true);
	const key = md5(padded(user), o, p, id).slice(0, 5);
	const u = rc4(key, PAD);
	return {
		key,
		id,
		encryptDict: `<< /Filter /Standard /V 1 /R 2 /O <${hex(o)}> /U <${hex(u)}> /P ${permissions} >>`,
	};
}

function objectKey(key: Uint8Array, objectNumber: number): Uint8Array {
	const extra = Uint8Array.from([
		objectNumber & 255,
		(objectNumber >> 8) & 255,
		(objectNumber >> 16) & 255,
		0,
		0,
	]);
	return md5(key, extra).slice(0, Math.min(key.length + 5, 16));
}

export function buildPdf(options: PdfOptions): Uint8Array {
	const crypto = options.encrypt
		? makeCrypto(
				options.encrypt.userPassword,
				options.encrypt.ownerPassword ?? options.encrypt.userPassword,
			)
		: null;
	const objects: Uint8Array[] = [];
	const add = (body: Uint8Array | string): number => {
		objects.push(typeof body === "string" ? latin1(body) : body);
		return objects.length;
	};
	const stream = (dict: string, data: Uint8Array): number => {
		const number = objects.length + 1;
		const payload = crypto ? rc4(objectKey(crypto.key, number), data) : data;
		return add(
			concat([
				latin1(`<< ${dict} /Length ${payload.length} >>\nstream\n`),
				payload,
				latin1("\nendstream"),
			]),
		);
	};

	// 1 catalog, 2 pages, 3 regular font, 4 bold font, 5 image; page objects follow.
	add("<< /Type /Catalog /Pages 2 0 R >>");
	add("PLACEHOLDER");
	add(
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
	);
	add(
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
	);
	stream(
		"/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8",
		Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 255),
	);

	const pageNumbers: number[] = [];
	for (const page of options.pages) {
		const width = page.width ?? 612;
		const height = page.height ?? 792;
		let content = "";
		if (page.scan) {
			content += `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q\n`;
		}
		for (const run of page.runs ?? []) {
			const font = run.bold ? "F2" : "F1";
			const size = run.size ?? 11;
			const matrix = run.rotate
				? `0 1 -1 0 ${run.x} ${run.y} Tm`
				: `1 0 0 1 ${run.x} ${run.y} Tm`;
			content += `BT /${font} ${size} Tf ${matrix} (${escapeText(run.text)}) Tj ET\n`;
		}
		const contentNumber = page.content
			? stream(
					page.content.filter ? `/Filter /${page.content.filter}` : "",
					page.content.data,
				)
			: stream("", latin1(content));
		pageNumbers.push(
			add(
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> >>`,
			),
		);
	}
	objects[1] = latin1(
		`<< /Type /Pages /Count ${options.claimedPageCount ?? pageNumbers.length} /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`,
	);
	let encryptNumber = 0;
	if (crypto) encryptNumber = add(crypto.encryptDict);
	let infoNumber = 0;
	if (options.title !== undefined && !crypto) {
		infoNumber = add(`<< /Title (${escapeText(options.title)}) >>`);
	}

	const chunks: Uint8Array[] = [latin1("%PDF-1.4\n%âãÏÓ\n")];
	const offsets: number[] = [];
	let size = chunks[0]?.length ?? 0;
	objects.forEach((body, index) => {
		offsets.push(size);
		const head = latin1(`${index + 1} 0 obj\n`);
		const tail = latin1("\nendobj\n");
		chunks.push(head, body, tail);
		size += head.length + body.length + tail.length;
	});
	let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	const id = crypto?.id ?? md5(latin1("speeedy-test-id"));
	xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${
		crypto ? `/Encrypt ${encryptNumber} 0 R ` : ""
	}${infoNumber ? `/Info ${infoNumber} 0 R ` : ""}/ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${size}\n%%EOF\n`;
	chunks.push(latin1(xref));
	return concat(chunks);
}
