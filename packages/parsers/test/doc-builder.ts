/**
 * Builds legacy Word (`.doc`) files in test code: an OLE compound file (CFB) holding a
 * `WordDocument` stream, a `0Table` or `1Table` stream with the piece table, and whatever else
 * a test wants. Every size, chain and offset can be set to a lie, so hostile files are made
 * here and never stored.
 */

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;
const MINI_SECTOR = 64;
const MINI_CUTOFF = 4096;

export type Stream = { name: string; data: Uint8Array };

export type CfbOptions = {
	/** 3 gives 512-byte sectors (the usual), 4 gives 4096-byte sectors. */
	version?: 3 | 4;
};

export type CfbLayout = {
	sectorSize: number;
	fatSectors: number[];
	difatSectors: number[];
	dirSectors: number[];
	miniFatSectors: number[];
	miniStreamSectors: number[];
	/** First sector of each stream kept in regular sectors. */
	streamStart: Record<string, number>;
	/** Byte offset of each 128-byte directory entry (root first, then the streams in order). */
	entryOffset: number[];
};

export type BuiltCfb = { bytes: Uint8Array; layout: CfbLayout };

const u32 = (view: DataView, at: number, value: number) =>
	view.setUint32(at, value >>> 0, true);

/** Build a compound file. The tree is a plain right-leaning chain, which readers accept. */
export function cfb(streams: Stream[], options: CfbOptions = {}): BuiltCfb {
	const version = options.version ?? 3;
	const S = version === 3 ? 512 : 4096;
	const perFat = S / 4;
	const small = streams.filter(
		(s) => s.data.length > 0 && s.data.length < MINI_CUTOFF,
	);
	const big = streams.filter((s) => !small.includes(s) && s.data.length > 0);

	// Mini stream: every small stream padded to whole 64-byte mini sectors.
	const miniStart = new Map<Stream, number>();
	const miniFat: number[] = [];
	const miniParts: Uint8Array[] = [];
	for (const s of small) {
		const count = Math.ceil(s.data.length / MINI_SECTOR);
		miniStart.set(s, miniFat.length);
		for (let k = 0; k < count; k++) {
			miniFat.push(k === count - 1 ? ENDOFCHAIN : miniFat.length + 1);
		}
		const padded = new Uint8Array(count * MINI_SECTOR);
		padded.set(s.data);
		miniParts.push(padded);
	}
	const miniLength = miniFat.length * MINI_SECTOR;

	// Plan the regular sectors.
	let next = 0;
	const take = (count: number): number[] => {
		const list: number[] = [];
		for (let k = 0; k < count; k++) list.push(next++);
		return list;
	};
	const bigSectors = new Map<Stream, number[]>();
	for (const s of big) bigSectors.set(s, take(Math.ceil(s.data.length / S)));
	const miniStreamSectors = take(Math.ceil(miniLength / S));
	const miniFatSectors = take(Math.ceil((miniFat.length * 4) / S));
	const dirSectors = take(Math.ceil(((streams.length + 1) * 128) / S));
	let nFat = 1;
	let nDifat = 0;
	for (;;) {
		const need = Math.ceil((next + nFat + nDifat) / perFat);
		const difat = need > 109 ? Math.ceil((need - 109) / (perFat - 1)) : 0;
		if (need === nFat && difat === nDifat) break;
		nFat = need;
		nDifat = difat;
	}
	const fatSectors = take(nFat);
	const difatSectors = take(nDifat);
	const total = next;

	const bytes = new Uint8Array((total + 1) * S);
	const view = new DataView(bytes.buffer);
	const sectorAt = (n: number) => (n + 1) * S;

	// FAT.
	const fat = new Array<number>(nFat * perFat).fill(FREESECT);
	const chain = (sectors: number[]) => {
		sectors.forEach((sector, k) => {
			fat[sector] =
				k === sectors.length - 1 ? ENDOFCHAIN : (sectors[k + 1] ?? 0);
		});
	};
	for (const sectors of bigSectors.values()) chain(sectors);
	chain(miniStreamSectors);
	chain(miniFatSectors);
	chain(dirSectors);
	for (const sector of fatSectors) fat[sector] = FATSECT;
	for (const sector of difatSectors) fat[sector] = DIFSECT;
	fat.forEach((value, k) => {
		const sector = fatSectors[Math.floor(k / perFat)];
		if (sector !== undefined)
			u32(view, sectorAt(sector) + (k % perFat) * 4, value);
	});

	// Data.
	for (const [s, sectors] of bigSectors) {
		for (let k = 0; k < sectors.length; k++) {
			bytes.set(s.data.subarray(k * S, (k + 1) * S), sectorAt(sectors[k] ?? 0));
		}
	}
	let at = 0;
	const miniAll = new Uint8Array(miniLength);
	for (const part of miniParts) {
		miniAll.set(part, at);
		at += part.length;
	}
	miniStreamSectors.forEach((sector, k) => {
		bytes.set(miniAll.subarray(k * S, (k + 1) * S), sectorAt(sector));
	});
	miniFat.forEach((value, k) => {
		const sector = miniFatSectors[Math.floor(k / perFat)];
		if (sector !== undefined)
			u32(view, sectorAt(sector) + (k % perFat) * 4, value);
	});

	// Directory.
	const entryOffset: number[] = [];
	const entryAt = (index: number) => {
		const sector = dirSectors[Math.floor((index * 128) / S)] ?? 0;
		const offset = sectorAt(sector) + ((index * 128) % S);
		entryOffset[index] = offset;
		return offset;
	};
	const writeEntry = (
		index: number,
		name: string,
		type: number,
		start: number,
		size: number,
		child: number,
		right: number,
	) => {
		const o = entryAt(index);
		for (let k = 0; k < name.length && k < 31; k++) {
			view.setUint16(o + k * 2, name.charCodeAt(k), true);
		}
		view.setUint16(o + 64, Math.min(name.length + 1, 32) * 2, true);
		bytes[o + 66] = type;
		bytes[o + 67] = 1;
		u32(view, o + 68, NOSTREAM);
		u32(view, o + 72, right);
		u32(view, o + 76, child);
		u32(view, o + 116, start);
		u32(view, o + 120, size);
	};
	const streamIndexes = streams.map((_, k) => k + 1);
	writeEntry(
		0,
		"Root Entry",
		5,
		miniStreamSectors[0] ?? ENDOFCHAIN,
		miniLength,
		streams.length > 0 ? 1 : NOSTREAM,
		NOSTREAM,
	);
	streams.forEach((s, k) => {
		const start = small.includes(s)
			? (miniStart.get(s) ?? ENDOFCHAIN)
			: (bigSectors.get(s)?.[0] ?? ENDOFCHAIN);
		const right =
			k + 1 < streams.length ? (streamIndexes[k + 1] ?? NOSTREAM) : NOSTREAM;
		writeEntry(k + 1, s.name, 2, start, s.data.length, NOSTREAM, right);
	});
	for (let k = streams.length + 1; k < (dirSectors.length * S) / 128; k++) {
		const o = entryAt(k);
		u32(view, o + 68, NOSTREAM);
		u32(view, o + 72, NOSTREAM);
		u32(view, o + 76, NOSTREAM);
	}

	// Header.
	bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
	view.setUint16(24, 0x003e, true);
	view.setUint16(26, version, true);
	view.setUint16(28, 0xfffe, true);
	view.setUint16(30, version === 3 ? 9 : 12, true);
	view.setUint16(32, 6, true);
	u32(view, 40, version === 4 ? dirSectors.length : 0);
	u32(view, 44, nFat);
	u32(view, 48, dirSectors[0] ?? ENDOFCHAIN);
	u32(view, 56, MINI_CUTOFF);
	u32(view, 60, miniFatSectors[0] ?? ENDOFCHAIN);
	u32(view, 64, miniFatSectors.length);
	u32(view, 68, difatSectors[0] ?? ENDOFCHAIN);
	u32(view, 72, nDifat);
	for (let k = 0; k < 109; k++) {
		u32(view, 76 + k * 4, fatSectors[k] ?? FREESECT);
	}
	// DIFAT sectors list the FAT sectors past the 109th.
	difatSectors.forEach((sector, d) => {
		const base = sectorAt(sector);
		for (let k = 0; k < perFat - 1; k++) {
			u32(
				view,
				base + k * 4,
				fatSectors[109 + d * (perFat - 1) + k] ?? FREESECT,
			);
		}
		u32(view, base + (perFat - 1) * 4, difatSectors[d + 1] ?? ENDOFCHAIN);
	});

	const streamStart: Record<string, number> = {};
	for (const [s, sectors] of bigSectors) streamStart[s.name] = sectors[0] ?? 0;
	return {
		bytes,
		layout: {
			sectorSize: S,
			fatSectors,
			difatSectors,
			dirSectors,
			miniFatSectors,
			miniStreamSectors,
			streamStart,
			entryOffset,
		},
	};
}

/** Overwrite one FAT entry in a built file. */
export function setFat(
	built: BuiltCfb,
	sector: number,
	value: number,
): Uint8Array {
	const { layout } = built;
	const perFat = layout.sectorSize / 4;
	const holder = layout.fatSectors[Math.floor(sector / perFat)];
	if (holder === undefined) throw new Error("no such FAT slot");
	new DataView(built.bytes.buffer).setUint32(
		(holder + 1) * layout.sectorSize + (sector % perFat) * 4,
		value >>> 0,
		true,
	);
	return built.bytes;
}

/** Overwrite one field of a directory entry (`start` at 116, `size` at 120, `child` at 76 ...). */
export function setEntry(
	built: BuiltCfb,
	index: number,
	field: number,
	value: number,
): Uint8Array {
	const at = built.layout.entryOffset[index];
	if (at === undefined) throw new Error("no such entry");
	new DataView(built.bytes.buffer).setUint32(at + field, value >>> 0, true);
	return built.bytes;
}

export const ENTRY = { left: 68, right: 72, child: 76, start: 116, size: 120 };
export const SPECIAL = { ENDOFCHAIN, FREESECT, FATSECT, DIFSECT };

/** The bytes a Word 97 file stores for text kept in 8 bits (Windows-1252). */
const CP1252_HIGH: Record<string, number> = {
	"€": 0x80,
	"‚": 0x82,
	ƒ: 0x83,
	"„": 0x84,
	"…": 0x85,
	"†": 0x86,
	"‡": 0x87,
	ˆ: 0x88,
	"‰": 0x89,
	Š: 0x8a,
	"‹": 0x8b,
	Œ: 0x8c,
	Ž: 0x8e,
	"‘": 0x91,
	"’": 0x92,
	"“": 0x93,
	"”": 0x94,
	"•": 0x95,
	"–": 0x96,
	"—": 0x97,
	"˜": 0x98,
	"™": 0x99,
	š: 0x9a,
	"›": 0x9b,
	œ: 0x9c,
	ž: 0x9e,
	Ÿ: 0x9f,
};

export function cp1252(text: string): Uint8Array {
	const out = new Uint8Array(text.length);
	for (let k = 0; k < text.length; k++) {
		const ch = text.charAt(k);
		const code = ch.charCodeAt(0);
		const high = CP1252_HIGH[ch];
		if (high !== undefined) out[k] = high;
		else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out[k] = code;
		else throw new Error(`not in Windows-1252: ${ch}`);
	}
	return out;
}

export function utf16le(text: string): Uint8Array {
	const out = new Uint8Array(text.length * 2);
	const view = new DataView(out.buffer);
	for (let k = 0; k < text.length; k++) {
		view.setUint16(k * 2, text.charCodeAt(k), true);
	}
	return out;
}

export type Piece = {
	text: string;
	/** Keep the piece in 8 bits (a "compressed" piece). The default is UTF-16. */
	compressed?: boolean;
	/** Use these bytes for the piece instead of encoding `text` (it still counts `text.length`). */
	raw?: Uint8Array;
};

export type WordOptions = {
	pieces: Piece[];
	/** The main-document character count. Defaults to the pieces' total. */
	ccpText?: number;
	nFib?: number;
	encrypted?: boolean;
	obfuscated?: boolean;
	/** Which table stream holds the piece table. */
	table?: "0Table" | "1Table";
	/** Write the table stream under this name regardless of the flag. */
	tableName?: string;
	/** Set the flag bits apart from the stream's real name (to lie about it). */
	whichTable?: 0 | 1;
	/** Pad the WordDocument stream to at least this many bytes (to leave the mini stream). */
	padTo?: number;
	/** Replace the CLX bytes entirely. */
	clx?: Uint8Array;
	/** Override the lcbClx the FIB declares. */
	lcbClx?: number;
	/** Override the fcClx the FIB declares. */
	fcClx?: number;
	/** Bytes of junk before the CLX in the table stream. */
	tableLead?: number;
	/** Override the piece table's character positions. */
	cps?: number[];
	/** Override each piece's file offset in the WordDocument stream. */
	offsets?: number[];
	/** The order the pieces' bytes are stored in (a permutation of the piece indexes). */
	storage?: number[];
	csw?: number;
	cslw?: number;
	cbRgFcLcb?: number;
};

export const FIB_SIZE = 1024;

/** The `WordDocument` and table streams of a Word 97 file. */
export function wordStreams(options: WordOptions): Stream[] {
	const datas = options.pieces.map(
		(piece) =>
			piece.raw ??
			(piece.compressed ? cp1252(piece.text) : utf16le(piece.text)),
	);
	const order = options.storage ?? datas.map((_, k) => k);
	const offsets: number[] = [];
	let at = FIB_SIZE;
	for (const index of order) {
		offsets[index] = at;
		at += datas[index]?.length ?? 0;
	}
	const wordLength = Math.max(at, options.padTo ?? 0);
	const word = new Uint8Array(wordLength);
	for (const index of order) {
		word.set(datas[index] ?? new Uint8Array(0), offsets[index] ?? 0);
	}

	const total = options.pieces.reduce((n, p) => n + p.text.length, 0);
	let running = 0;
	const cps = options.cps ?? [
		0,
		...options.pieces.map((p) => {
			running += p.text.length;
			return running;
		}),
	];
	const n = options.pieces.length;
	let clx = options.clx;
	if (!clx) {
		const plc = new Uint8Array((n + 1) * 4 + n * 8);
		const pv = new DataView(plc.buffer);
		cps.forEach((cp, k) => {
			pv.setUint32(k * 4, cp, true);
		});
		options.pieces.forEach((piece, k) => {
			const base = (n + 1) * 4 + k * 8;
			const offset = options.offsets?.[k] ?? offsets[k] ?? 0;
			pv.setUint16(base, 0, true);
			pv.setUint32(
				base + 2,
				piece.compressed ? ((offset * 2) | 0x40000000) >>> 0 : offset,
				true,
			);
			pv.setUint16(base + 6, 0, true);
		});
		clx = new Uint8Array(1 + 4 + plc.length);
		clx[0] = 0x02;
		new DataView(clx.buffer).setUint32(1, plc.length, true);
		clx.set(plc, 5);
	}
	const lead = options.tableLead ?? 0;
	const table = new Uint8Array(lead + clx.length + 16);
	for (let k = 0; k < lead; k++) table[k] = 0xaa;
	table.set(clx, lead);

	const fv = new DataView(word.buffer);
	const nFib = options.nFib ?? 0x00c1;
	const tableName = options.table ?? "1Table";
	const which = options.whichTable ?? (tableName === "1Table" ? 1 : 0);
	fv.setUint16(0, nFib < 0x00c1 ? 0xa5dc : 0xa5ec, true);
	fv.setUint16(2, nFib, true);
	fv.setUint16(6, 0x0409, true);
	fv.setUint16(
		10,
		(which ? 0x0200 : 0) |
			(options.encrypted ? 0x0100 : 0) |
			(options.obfuscated ? 0x8000 : 0),
		true,
	);
	fv.setUint16(32, options.csw ?? 14, true);
	fv.setUint16(62, options.cslw ?? 22, true);
	fv.setUint32(76, options.ccpText ?? total, true);
	fv.setUint16(152, options.cbRgFcLcb ?? 93, true);
	fv.setUint32(418, options.fcClx ?? lead, true);
	fv.setUint32(422, options.lcbClx ?? clx.length, true);

	return [
		{ name: "WordDocument", data: word },
		{ name: options.tableName ?? tableName, data: table },
	];
}

/** A whole `.doc` file. */
export function docFile(
	options: WordOptions,
	cfbOptions: CfbOptions = {},
): Uint8Array {
	return cfb(wordStreams(options), cfbOptions).bytes;
}

/** A `.doc` with one UTF-16 piece. */
export const simpleDoc = (text: string): Uint8Array =>
	docFile({ pieces: [{ text }] });
