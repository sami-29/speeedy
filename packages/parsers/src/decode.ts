import { ParseFailure } from "./types";

export type Decoded = { text: string; encoding: string };

export type DecodeOptions = {
	/** A TextDecoder label the reader picked. It wins over meta tags, never over a BOM. */
	encoding?: string;
	/** Look for `<meta charset>` and `<?xml encoding?>` in the first bytes (markup formats). */
	sniffMeta?: boolean;
};

const META_WINDOW = 1024;

function startsWith(bytes: Uint8Array, ...prefix: number[]): boolean {
	return prefix.every((value, index) => bytes[index] === value);
}

type Bom = { label: string; length: number } | "utf-32";

function readBom(bytes: Uint8Array): Bom | null {
	if (startsWith(bytes, 0xef, 0xbb, 0xbf)) return { label: "utf-8", length: 3 };
	if (startsWith(bytes, 0xff, 0xfe, 0x00, 0x00)) return "utf-32";
	if (startsWith(bytes, 0x00, 0x00, 0xfe, 0xff)) return "utf-32";
	if (startsWith(bytes, 0xff, 0xfe)) return { label: "utf-16le", length: 2 };
	if (startsWith(bytes, 0xfe, 0xff)) return { label: "utf-16be", length: 2 };
	return null;
}

/**
 * Latin-script UTF-16 without a BOM has a zero in every other byte. Look at a bounded
 * sample and call it only when one parity is mostly zeros and the other has none.
 */
function sniffBomlessUtf16(bytes: Uint8Array): string | null {
	const pairs = Math.min(bytes.length >> 1, 2048);
	if (pairs === 0) return null;
	let evenZeros = 0;
	let oddZeros = 0;
	for (let i = 0; i < pairs; i++) {
		if (bytes[i * 2] === 0) evenZeros++;
		if (bytes[i * 2 + 1] === 0) oddZeros++;
	}
	// Non-Latin UTF-16 still has zero high bytes at spaces and punctuation, but never a
	// zero in the other byte, which separates it from binary data.
	if (oddZeros / pairs >= 0.05 && evenZeros === 0) return "utf-16le";
	if (evenZeros / pairs >= 0.05 && oddZeros === 0) return "utf-16be";
	return null;
}

/** Read a declared charset from the start of an HTML or XML file. */
export function sniffMetaCharset(bytes: Uint8Array): string | null {
	const head = bytes.subarray(0, META_WINDOW);
	let ascii = "";
	for (let i = 0; i < head.length; i++) {
		const code = head[i] ?? 0;
		ascii += code < 128 ? String.fromCharCode(code) : " ";
	}
	const xml =
		/^\s*<\?xml[^>]{0,200}?encoding\s*=\s*["']([A-Za-z0-9_.:-]{1,40})["']/.exec(
			ascii,
		);
	if (xml?.[1]) return xml[1];
	const meta =
		/<meta\s[^>]{0,300}?charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]{1,40})/i.exec(
			ascii,
		);
	return meta?.[1] ?? null;
}

function makeDecoder(label: string): TextDecoder {
	let probe: TextDecoder;
	try {
		probe = new TextDecoder(label);
	} catch {
		throw new ParseFailure(
			"unsupported",
			"Speeedy does not know that text encoding.",
		);
	}
	// Any label that resolves to UTF-8 is decoded strictly.
	return probe.encoding === "utf-8"
		? new TextDecoder("utf-8", { fatal: true })
		: probe;
}

/** A SharedArrayBuffer-backed view is rejected by TextDecoder, so copy it first. */
function ownedView(bytes: Uint8Array): Uint8Array {
	if (
		typeof SharedArrayBuffer !== "undefined" &&
		bytes.buffer instanceof SharedArrayBuffer
	) {
		return bytes.slice();
	}
	return bytes;
}

/**
 * Turn bytes into text. The encoding comes from, in order: a byte order mark, the reader's
 * codepage, a meta/XML declaration (markup only), a BOM-less UTF-16 pattern, then UTF-8.
 * UTF-8 is decoded strictly. Bytes that are not valid UTF-8 are `encoding-suspect`, because
 * there is no detector: the reader picks the codepage.
 */
export function decodeBytes(
	input: Uint8Array,
	options: DecodeOptions = {},
): Decoded {
	const bytes = ownedView(input);
	const bom = readBom(bytes);
	if (bom === "utf-32") {
		throw new ParseFailure(
			"unsupported",
			"UTF-32 text files are not supported. Save the file as UTF-8 and open it again.",
		);
	}

	let label: string;
	let body = bytes;
	if (bom) {
		label = bom.label;
		body = bytes.subarray(bom.length);
	} else if (options.encoding !== undefined) {
		label = options.encoding;
	} else {
		const declared = options.sniffMeta ? sniffMetaCharset(bytes) : null;
		label = declared ?? sniffBomlessUtf16(bytes) ?? "utf-8";
		if (declared) {
			try {
				new TextDecoder(declared);
			} catch {
				label = sniffBomlessUtf16(bytes) ?? "utf-8";
			}
		}
	}

	const decoder = makeDecoder(label);
	try {
		return { text: decoder.decode(body), encoding: decoder.encoding };
	} catch (error) {
		if (decoder.fatal && error instanceof TypeError) {
			throw new ParseFailure(
				"encoding-suspect",
				"The text does not look like UTF-8. Pick the file's encoding and open it again.",
			);
		}
		throw new ParseFailure("unsupported", "The text could not be decoded.");
	}
}
