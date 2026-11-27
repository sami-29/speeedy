import { ParseFailure } from "./types";

/**
 * A small, defensive reader for OLE compound files (the "CFB" container of `.doc`, `.xls`
 * and `.ppt`). It finds root-level streams by name and nothing else.
 *
 * A compound file is a tiny file system: a header, a table (the FAT) that links 512-byte
 * (or 4096-byte) sectors into chains, a directory of streams, and a "mini stream" that packs
 * streams under 4096 bytes into 64-byte pieces. Every number in it is under the control of
 * whoever wrote the file, so nothing here trusts one:
 * - A chain is followed for exactly as many sectors as the stream needs, never past the end
 *   of the file, and a sector seen twice is a cycle and a failure.
 * - A stream's declared size is checked against the number of sectors the container has
 *   before any memory is allocated, so a size of four billion costs nothing.
 * - Counts in the header (FAT sectors, DIFAT sectors) are checked against the file's own
 *   sector count; the mini FAT count is not used at all, the chain decides.
 * - The directory tree is walked with a visited set, so loops in its links end.
 * Memory is bounded by the file's own size: each table or stream is at most the bytes the
 * file holds, and one read allocates one such copy.
 */

const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const NOSTREAM = 0xffffffff;
const MINI_SECTOR = 64;
const MINI_CUTOFF = 4096;
const HEADER_DIFAT = 109;
const ENTRY = 128;
const NAME_MAX = 64;

const unsupported = (why = "Speeedy could not read this file."): ParseFailure =>
	new ParseFailure("unsupported", why);

export function isCompoundFile(bytes: Uint8Array): boolean {
	return bytes.length >= 8 && MAGIC.every((value, k) => bytes[k] === value);
}

export type Compound = {
	/** The bytes of a root-level stream, null when there is none. Throws on a broken file. */
	stream(name: string): Uint8Array | null;
	has(name: string): boolean;
};

type Entry = { start: number; size: number };

export function openCompound(bytes: Uint8Array): Compound {
	if (bytes.length < 512 || !isCompoundFile(bytes)) throw unsupported();
	const length = bytes.length;
	const view = new DataView(bytes.buffer, bytes.byteOffset, length);
	const major = view.getUint16(26, true);
	const shift = view.getUint16(30, true);
	if (view.getUint16(28, true) !== 0xfffe) throw unsupported();
	if (!((major === 3 && shift === 9) || (major === 4 && shift === 12))) {
		throw unsupported();
	}
	if (view.getUint16(32, true) !== 6) throw unsupported();
	if (view.getUint32(56, true) !== MINI_CUTOFF) throw unsupported();
	const S = 1 << shift;
	if (length < S) throw unsupported();
	const perSector = S / 4;
	// A short last sector still counts: some writers leave the final padding off.
	const sectorCount = Math.ceil((length - S) / S);
	const sectorAt = (n: number): number => (n + 1) * S;

	/** The bytes of one sector, shorter than `S` only for a truncated last sector. */
	const sector = (n: number): Uint8Array =>
		bytes.subarray(sectorAt(n), Math.min(sectorAt(n) + S, length));

	/** Sector numbers of a chain, up to the end marker. A loop or a stray number throws. */
	const walk = (start: number, table: Uint32Array, limit: number): number[] => {
		const seen = new Uint8Array(limit);
		const out: number[] = [];
		let n = start;
		while (n !== ENDOFCHAIN) {
			if (n >= limit || n >= table.length || seen[n]) throw unsupported();
			seen[n] = 1;
			out.push(n);
			n = table[n] ?? ENDOFCHAIN;
		}
		return out;
	};

	// The FAT.
	const fatCount = view.getUint32(44, true);
	if (fatCount === 0 || fatCount > sectorCount) throw unsupported();
	const fatSectors: number[] = [];
	const inHeader = Math.min(fatCount, HEADER_DIFAT);
	for (let k = 0; k < inHeader; k++) {
		const n = view.getUint32(76 + k * 4, true);
		if (n >= sectorCount) throw unsupported();
		fatSectors.push(n);
	}
	if (fatCount > HEADER_DIFAT) {
		const difatCount = view.getUint32(72, true);
		if (difatCount === 0 || difatCount > sectorCount) throw unsupported();
		const seen = new Uint8Array(sectorCount);
		let n = view.getUint32(68, true);
		for (let d = 0; d < difatCount && fatSectors.length < fatCount; d++) {
			if (n >= sectorCount || seen[n]) throw unsupported();
			seen[n] = 1;
			const part = sector(n);
			const pv = new DataView(part.buffer, part.byteOffset, part.byteLength);
			for (
				let k = 0;
				k < perSector - 1 &&
				(k + 1) * 4 <= part.byteLength &&
				fatSectors.length < fatCount;
				k++
			) {
				const target = pv.getUint32(k * 4, true);
				if (target >= sectorCount) throw unsupported();
				fatSectors.push(target);
			}
			n =
				perSector * 4 <= part.byteLength
					? pv.getUint32((perSector - 1) * 4, true)
					: ENDOFCHAIN;
		}
		if (fatSectors.length < fatCount) throw unsupported();
	}
	const fat = new Uint32Array(fatCount * perSector);
	fatSectors.forEach((n, index) => {
		const part = sector(n);
		const pv = new DataView(part.buffer, part.byteOffset, part.byteLength);
		const entries = Math.floor(part.byteLength / 4);
		for (let k = 0; k < entries; k++) {
			fat[index * perSector + k] = pv.getUint32(k * 4, true);
		}
	});

	/** Bytes of a stream held in regular sectors. */
	const regular = (start: number, size: number): Uint8Array => {
		if (size === 0) return new Uint8Array(0);
		const need = Math.ceil(size / S);
		if (need > sectorCount) throw unsupported();
		const out = new Uint8Array(size);
		const seen = new Uint8Array(sectorCount);
		let n = start;
		for (let k = 0; k < need; k++) {
			if (n >= sectorCount || n >= fat.length || seen[n]) throw unsupported();
			seen[n] = 1;
			out.set(sector(n).subarray(0, Math.min(S, size - k * S)), k * S);
			n = fat[n] ?? ENDOFCHAIN;
		}
		return out;
	};

	// The directory.
	const dirChain = walk(view.getUint32(48, true), fat, sectorCount);
	if (dirChain.length === 0) throw unsupported();
	const directory = new Uint8Array(dirChain.length * S);
	dirChain.forEach((n, k) => {
		directory.set(sector(n), k * S);
	});
	const dv = new DataView(directory.buffer);
	const entryCount = Math.floor(directory.length / ENTRY);
	const sizeOf = (index: number): number => {
		const at = index * ENTRY;
		const low = dv.getUint32(at + 120, true);
		const high = major === 4 ? dv.getUint32(at + 124, true) : 0;
		if (high !== 0) throw unsupported();
		return low;
	};
	if (directory[66] !== 5) throw unsupported();

	// Root-level streams by name. Storages are not entered.
	const names = new Map<string, number[]>();
	const decoder = new TextDecoder("utf-16le");
	const seenEntries = new Uint8Array(entryCount);
	const stack: number[] = [];
	const first = dv.getUint32(76, true);
	if (first !== NOSTREAM) stack.push(first);
	while (stack.length > 0) {
		const index = stack.pop() ?? 0;
		if (index >= entryCount || seenEntries[index]) continue;
		seenEntries[index] = 1;
		const at = index * ENTRY;
		const nameBytes = dv.getUint16(at + 64, true);
		if (directory[at + 66] === 2 && nameBytes >= 2 && nameBytes <= NAME_MAX) {
			const name = decoder.decode(directory.subarray(at, at + nameBytes - 2));
			const list = names.get(name);
			if (list) list.push(index);
			else names.set(name, [index]);
		}
		for (const link of [
			dv.getUint32(at + 68, true),
			dv.getUint32(at + 72, true),
		]) {
			if (link !== NOSTREAM) stack.push(link);
		}
	}

	// The mini stream, read the first time a small stream needs it.
	let mini: { fat: Uint32Array; data: Uint8Array } | undefined;
	const miniStream = () => {
		if (mini) return mini;
		const chain = walk(view.getUint32(60, true), fat, sectorCount);
		const table = new Uint32Array(chain.length * perSector);
		chain.forEach((n, index) => {
			const part = sector(n);
			const pv = new DataView(part.buffer, part.byteOffset, part.byteLength);
			for (let k = 0; k < Math.floor(part.byteLength / 4); k++) {
				table[index * perSector + k] = pv.getUint32(k * 4, true);
			}
		});
		mini = {
			fat: table,
			data: regular(dv.getUint32(116, true), sizeOf(0)),
		};
		return mini;
	};

	const small = (start: number, size: number): Uint8Array => {
		const { fat: table, data } = miniStream();
		const limit = Math.floor(data.length / MINI_SECTOR);
		const need = Math.ceil(size / MINI_SECTOR);
		if (need > limit) throw unsupported();
		const out = new Uint8Array(size);
		const seen = new Uint8Array(limit);
		let n = start;
		for (let k = 0; k < need; k++) {
			if (n >= limit || n >= table.length || seen[n]) throw unsupported();
			seen[n] = 1;
			const from = n * MINI_SECTOR;
			out.set(
				data
					.subarray(from, from + MINI_SECTOR)
					.subarray(0, Math.min(MINI_SECTOR, size - k * MINI_SECTOR)),
				k * MINI_SECTOR,
			);
			n = table[n] ?? ENDOFCHAIN;
		}
		return out;
	};

	const find = (name: string): Entry | null => {
		const list = names.get(name);
		if (!list) return null;
		if (list.length > 1) throw unsupported();
		const index = list[0] ?? 0;
		return {
			start: dv.getUint32(index * ENTRY + 116, true),
			size: sizeOf(index),
		};
	};

	return {
		has: (name) => names.has(name),
		stream(name) {
			const entry = find(name);
			if (!entry) return null;
			if (entry.size === 0) return new Uint8Array(0);
			return entry.size < MINI_CUTOFF
				? small(entry.start, entry.size)
				: regular(entry.start, entry.size);
		},
	};
}
