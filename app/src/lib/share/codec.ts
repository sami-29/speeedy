/**
 * The Share Link codec. A Share Link is `/s#1.<payload>`: the text, UTF-8 encoded, compressed
 * with raw DEFLATE and written in base64url after a version prefix. The fragment is never
 * sent to a server (RFC 9110 §17.11), so the text stays on the two devices.
 *
 * Everything decoded here comes from a link anyone can craft, so it is treated as hostile:
 * the payload length is capped before decoding, decompression stops at the text cap (a
 * decompression bomb never expands past it), the bytes must be valid UTF-8, and the result is
 * only ever plain text. It never throws.
 */

/** Longest fragment a Share Link may carry, version prefix included. */
export const MAX_PAYLOAD_CHARS = 16_384;

/** Most text a Share Link may hold once decompressed, in UTF-8 bytes. */
export const MAX_TEXT_BYTES = 262_144;

/** Longest 1.x `#/read/` base64 that can hold MAX_TEXT_BYTES. */
const MAX_LEGACY_CHARS = Math.ceil(MAX_TEXT_BYTES / 3) * 4;

const VERSION = "1.";
const LEGACY_PREFIX = "#/read/";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Input is fed to the decompressor in slices this size, so one slice inflates to ~1 MB at most. */
const INFLATE_SLICE = 1024;

export type CreateResult =
	| { ok: true; payload: string; used: number }
	| { ok: false; reason: "empty" }
	| { ok: false; reason: "too-long"; used: number };

export type DecodeResult =
	| { kind: "none" }
	| { kind: "text"; text: string }
	/** A 1.x link. `payload` is its 2.0 form, or null when that would be over the cap. */
	| { kind: "legacy"; text: string; payload: string | null }
	| { kind: "error"; reason: "malformed" | "too-long" };

const MALFORMED = { kind: "error", reason: "malformed" } as const;
const TOO_LONG = { kind: "error", reason: "too-long" } as const;

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Strict base64url: the alphabet only, no padding, no impossible length. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
	if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
	try {
		const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates raw DEFLATE, giving up as soon as the output passes `limit` bytes. */
async function inflate(
	bytes: Uint8Array<ArrayBuffer>,
	limit: number,
): Promise<Uint8Array | "malformed" | "too-long"> {
	const stream = new DecompressionStream("deflate-raw");
	const writer = stream.writable.getWriter();
	const reader = stream.readable.getReader();
	const feed = (async () => {
		for (let i = 0; i < bytes.length; i += INFLATE_SLICE) {
			await writer.write(bytes.subarray(i, i + INFLATE_SLICE));
		}
		await writer.close();
	})();
	// Errors surface on the reader; the writer's copy of them is not news.
	feed.catch(() => {});

	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => {});
				return "too-long";
			}
			chunks.push(value);
		}
		await feed;
	} catch {
		return "malformed";
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
}

function decodeUtf8(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
		);
	} catch {
		return null;
	}
}

/**
 * Turns text into a Share Link payload (what goes after `/s#`). `used` is the share of the
 * size cap the link takes, so the writer can see what fits.
 */
export async function createSharePayload(text: string): Promise<CreateResult> {
	if (text.trim() === "") return { ok: false, reason: "empty" };
	const bytes = new TextEncoder().encode(text);
	const payload = VERSION + toBase64Url(await deflate(bytes));
	const used = Math.max(
		payload.length / MAX_PAYLOAD_CHARS,
		bytes.length / MAX_TEXT_BYTES,
	);
	if (payload.length > MAX_PAYLOAD_CHARS || bytes.length > MAX_TEXT_BYTES) {
		return { ok: false, reason: "too-long", used };
	}
	return { ok: true, payload, used: payload.length / MAX_PAYLOAD_CHARS };
}

async function decodePayload(payload: string): Promise<DecodeResult> {
	if (payload.length > MAX_PAYLOAD_CHARS) return TOO_LONG;
	if (!payload.startsWith(VERSION)) return MALFORMED;
	const compressed = fromBase64Url(payload.slice(VERSION.length));
	if (!compressed) return MALFORMED;
	const bytes = await inflate(compressed, MAX_TEXT_BYTES);
	if (bytes === "too-long") return TOO_LONG;
	if (bytes === "malformed") return MALFORMED;
	const text = decodeUtf8(bytes);
	if (text === null || text.trim() === "") return MALFORMED;
	return { kind: "text", text };
}

async function decodeLegacy(encoded: string): Promise<DecodeResult> {
	if (encoded.length > MAX_LEGACY_CHARS) return TOO_LONG;
	const bytes = fromBase64Url(encoded);
	if (!bytes) return MALFORMED;
	if (bytes.length > MAX_TEXT_BYTES) return TOO_LONG;
	const text = decodeUtf8(bytes);
	if (text === null || text.trim() === "") return MALFORMED;
	const created = await createSharePayload(text);
	return { kind: "legacy", text, payload: created.ok ? created.payload : null };
}

/**
 * Whether a location hash claims to be a Share Link: `#1.` or `#/read/`. Any other fragment,
 * such as the layout's `#main` skip link, is not one and must be left alone.
 */
export function isShareHash(hash: string): boolean {
	return hash.startsWith(`#${VERSION}`) || hash.startsWith(LEGACY_PREFIX);
}

/**
 * Reads a location hash: a 2.0 Share Link (`#1.…`), a 1.x link (`#/read/<b64>`), nothing
 * (any fragment with neither prefix), or an error. The text comes back as plain text and
 * must only ever be rendered as text.
 */
export async function decodeShareHash(hash: string): Promise<DecodeResult> {
	try {
		if (!isShareHash(hash)) return { kind: "none" };
		if (hash.startsWith(LEGACY_PREFIX)) {
			return await decodeLegacy(hash.slice(LEGACY_PREFIX.length));
		}
		return await decodePayload(hash.slice(1));
	} catch {
		return MALFORMED;
	}
}
