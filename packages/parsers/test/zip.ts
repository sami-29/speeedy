import { crc32, deflateRawSync } from "node:zlib";

/**
 * A small ZIP writer for tests, with knobs to build files that lie: wrong sizes, wrong
 * counts, encrypted flags and duplicate names. Real archives are used where a real one
 * exists (the corpus); this builds the ones no honest tool would write.
 */
export type ZipEntry = {
	name: string;
	data?: Uint8Array | string;
	/** 8 (default) deflates, 0 stores. */
	method?: 0 | 8;
	/** General-purpose bit flags (bit 0 = encrypted, bit 3 = sizes follow the data). */
	flags?: number;
	/** Written in the method field instead of the real one (for example 99, WinZip AES). */
	rawMethod?: number;
	/** Written as the uncompressed size in the central directory. */
	claimedSize?: number;
	/** Already-deflated bytes to store as is (ignores `data` for the payload). */
	deflated?: Uint8Array;
};

export type ZipOptions = {
	/** Written as the entry count in the end record instead of the real one. */
	count?: number;
	/** Written as the central directory offset instead of the real one. */
	directoryOffset?: number;
	comment?: Uint8Array;
	/** Skip the local header of the entry at this index (the offset then points at garbage). */
	garbleLocal?: number;
};

const bytes = (value: Uint8Array | string): Uint8Array =>
	typeof value === "string" ? new TextEncoder().encode(value) : value;

export function zip(
	entries: ZipEntry[],
	options: ZipOptions = {},
): Uint8Array<ArrayBuffer> {
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	const push = (chunk: Uint8Array): void => {
		chunks.push(chunk);
		offset += chunk.length;
	};
	entries.forEach((entry, index) => {
		const name = new TextEncoder().encode(entry.name);
		const raw = bytes(entry.data ?? "");
		const method = entry.method ?? 8;
		const payload =
			entry.deflated ??
			(method === 0 ? raw : new Uint8Array(deflateRawSync(raw)));
		const crc = crc32(raw);
		const flags = entry.flags ?? 0;
		const rawMethod = entry.rawMethod ?? (entry.deflated ? 8 : method);
		const size = entry.claimedSize ?? raw.length;
		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, flags, true);
		lv.setUint16(8, rawMethod, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, payload.length, true);
		lv.setUint32(22, size, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);
		const localOffset = offset;
		if (options.garbleLocal === index) local.fill(0x41, 0, 4);
		push(local);
		push(payload);
		const head = new Uint8Array(46 + name.length);
		const cv = new DataView(head.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, flags, true);
		cv.setUint16(10, rawMethod, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, payload.length, true);
		cv.setUint32(24, size, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, localOffset, true);
		head.set(name, 46);
		central.push(head);
	});
	const directoryAt = offset;
	let directorySize = 0;
	for (const record of central) {
		push(record);
		directorySize += record.length;
	}
	const comment = options.comment ?? new Uint8Array(0);
	const end = new Uint8Array(22 + comment.length);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, options.count ?? entries.length, true);
	ev.setUint16(10, options.count ?? entries.length, true);
	ev.setUint32(12, directorySize, true);
	ev.setUint32(16, options.directoryOffset ?? directoryAt, true);
	ev.setUint16(20, comment.length, true);
	end.set(comment, 22);
	push(end);
	const out = new Uint8Array(offset);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/**
 * A valid raw deflate stream made only of stored blocks: the size of the data plus a few bytes,
 * built without compressing, so a test can have a huge part that compresses at a ratio near 1.
 */
export function storedDeflate(data: Uint8Array): Uint8Array<ArrayBuffer> {
	const blocks = Math.max(1, Math.ceil(data.length / 65535));
	const out = new Uint8Array(data.length + blocks * 5);
	let at = 0;
	for (let i = 0; i < blocks; i++) {
		const chunk = data.subarray(i * 65535, (i + 1) * 65535);
		out[at++] = i === blocks - 1 ? 1 : 0;
		out[at++] = chunk.length & 0xff;
		out[at++] = chunk.length >> 8;
		out[at++] = ~chunk.length & 0xff;
		out[at++] = (~chunk.length >> 8) & 0xff;
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}
