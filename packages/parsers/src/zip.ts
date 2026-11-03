import { ParseFailure } from "./types";

/**
 * A small, defensive ZIP reader for office packages. It reads the central directory, checks it
 * against the file, and inflates only the parts a parser asks for, each with a hard ceiling on
 * the bytes it may produce. The sizes in the archive are never trusted: a hostile file can claim
 * 100 bytes and inflate to gigabytes, so the ceiling counts the bytes actually produced and
 * stops the stream when it is crossed.
 *
 * Not supported, and refused with a typed error: ZIP64, multi-disk archives, and any method but
 * stored and deflate. Encrypted entries are `drm`.
 */

export const ZIP_LIMITS = {
	/** Entries in the central directory. Real packages have tens to a few hundred. */
	entries: 10_000,
	/** Sum of the uncompressed sizes the directory declares, for all entries. */
	declaredTotal: 1024 * 1024 * 1024,
	/** A part may expand at most this many times its compressed size ... */
	ratio: 250,
	/** ... once it is larger than this (small parts cannot do harm). */
	ratioFloor: 1024 * 1024,
	/** Bytes inflated across every part read from one package. */
	inflatedTotal: 96 * 1024 * 1024,
} as const;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_MARK = 0xffffffff;
const INPUT_SLICE = 16 * 1024;

export const isZip = (bytes: Uint8Array): boolean =>
	bytes.length >= 4 &&
	bytes[0] === 0x50 &&
	bytes[1] === 0x4b &&
	((bytes[2] === 0x03 && bytes[3] === 0x04) ||
		(bytes[2] === 0x05 && bytes[3] === 0x06));

type Entry = {
	flags: number;
	method: number;
	compressed: number;
	size: number;
	offset: number;
};

export type ZipArchive = {
	/**
	 * The inflated bytes of a part, or null when there is no such part. Throws a
	 * `ParseFailure` when the part is encrypted, unreadable or over `maxBytes`.
	 */
	read(name: string, maxBytes: number): Promise<Uint8Array | null>;
};

const unsupported = (why = "Speeedy could not read this file."): ParseFailure =>
	new ParseFailure("unsupported", why);

const tooBig = (): ParseFailure =>
	new ParseFailure("too-big", "This file is too large for Speeedy to open.");

const key = (name: string): string => name.toLowerCase();

export function openZip(bytes: Uint8Array): ZipArchive {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const length = bytes.length;
	if (length < EOCD_SIZE) throw unsupported();

	let eocd = -1;
	const lowest = Math.max(0, length - EOCD_SIZE - MAX_COMMENT);
	for (let at = length - EOCD_SIZE; at >= lowest; at--) {
		if (
			view.getUint32(at, true) === SIG_EOCD &&
			at + EOCD_SIZE + view.getUint16(at + 20, true) <= length
		) {
			eocd = at;
			break;
		}
	}
	if (eocd < 0) throw unsupported();
	if (
		view.getUint16(eocd + 4, true) !== 0 ||
		view.getUint16(eocd + 6, true) !== 0
	) {
		throw unsupported("Speeedy cannot open split ZIP files.");
	}
	const count = view.getUint16(eocd + 10, true);
	const directorySize = view.getUint32(eocd + 12, true);
	const directoryAt = view.getUint32(eocd + 16, true);
	if (count >= ZIP_LIMITS.entries + 1) throw tooBig();
	if (directorySize === ZIP64_MARK || directoryAt === ZIP64_MARK) {
		throw unsupported();
	}
	if (directoryAt > eocd || directorySize > eocd - directoryAt) {
		throw unsupported();
	}

	const entries = new Map<string, Entry | "duplicate">();
	let declared = 0;
	let at = directoryAt;
	const directoryEnd = directoryAt + directorySize;
	for (let index = 0; index < count; index++) {
		if (at + 46 > directoryEnd || view.getUint32(at, true) !== SIG_CENTRAL) {
			throw unsupported();
		}
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		const next = at + 46 + nameLength + extraLength + commentLength;
		if (next > directoryEnd) throw unsupported();
		const size = view.getUint32(at + 24, true);
		if (size !== ZIP64_MARK) {
			declared += size;
			if (declared > ZIP_LIMITS.declaredTotal) throw tooBig();
		}
		const name = new TextDecoder().decode(
			bytes.subarray(at + 46, at + 46 + nameLength),
		);
		if (!name.endsWith("/")) {
			const id = key(name);
			entries.set(
				id,
				entries.has(id)
					? "duplicate"
					: {
							flags: view.getUint16(at + 8, true),
							method: view.getUint16(at + 10, true),
							compressed: view.getUint32(at + 20, true),
							size,
							offset: view.getUint32(at + 42, true),
						},
			);
		}
		at = next;
	}

	let inflated = 0;

	return {
		async read(name, maxBytes) {
			const entry = entries.get(key(name));
			if (entry === undefined) return null;
			if (entry === "duplicate") throw unsupported();
			if (entry.flags & 0x0001 || entry.method === 99) {
				throw new ParseFailure(
					"drm",
					"This file is encrypted. Remove the password in Word and open it again.",
				);
			}
			if (
				entry.compressed === ZIP64_MARK ||
				entry.size === ZIP64_MARK ||
				entry.offset === ZIP64_MARK
			) {
				throw unsupported();
			}
			const local = entry.offset;
			if (local + 30 > length || view.getUint32(local, true) !== SIG_LOCAL) {
				throw unsupported();
			}
			const start =
				local +
				30 +
				view.getUint16(local + 26, true) +
				view.getUint16(local + 28, true);
			if (start > length || entry.compressed > length - start)
				throw unsupported();
			const data = bytes.subarray(start, start + entry.compressed);
			if (entry.method === 0) {
				if (entry.compressed !== entry.size) throw unsupported();
				if (entry.size > maxBytes) throw tooBig();
				inflated += entry.size;
				if (inflated > ZIP_LIMITS.inflatedTotal) throw tooBig();
				return data;
			}
			if (entry.method !== 8) throw unsupported();
			const bySize = Math.max(
				ZIP_LIMITS.ratioFloor,
				entry.compressed * ZIP_LIMITS.ratio,
			);
			const limit = Math.min(
				maxBytes,
				bySize,
				ZIP_LIMITS.inflatedTotal - inflated,
			);
			const out = await inflateRaw(data, limit);
			inflated += out.length;
			return out;
		},
	};
}

/** Inflate a raw deflate stream, stopping as soon as the output passes `limit` bytes. */
async function inflateRaw(
	data: Uint8Array,
	limit: number,
): Promise<Uint8Array> {
	if (typeof DecompressionStream === "undefined") {
		throw unsupported("This browser cannot open Word files. Try a newer one.");
	}
	const stream = new DecompressionStream("deflate-raw");
	const writer = stream.writable.getWriter();
	const reader = stream.readable.getReader();
	const feed = (async () => {
		try {
			for (let at = 0; at < data.length; at += INPUT_SLICE) {
				await writer.write(
					data.subarray(at, at + INPUT_SLICE) as Uint8Array<ArrayBuffer>,
				);
			}
			await writer.close();
		} catch {
			// The reader sees the failure; this side only has to stop quietly.
		}
	})();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > limit) {
				await reader.cancel().catch(() => undefined);
				await writer.abort().catch(() => undefined);
				throw tooBig();
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof ParseFailure) throw error;
		throw unsupported();
	} finally {
		await feed;
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}
