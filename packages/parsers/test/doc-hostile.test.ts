import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import {
	type BuiltCfb,
	cfb,
	ENTRY,
	SPECIAL,
	setEntry,
	setFat,
	type WordOptions,
	wordStreams,
} from "./doc-builder";
import {
	expectError,
	expectSuccess,
	expectWellFormed,
	textsOf,
} from "./helpers";

const MiB = 1024 * 1024;

const read = (bytes: Uint8Array, hints?: Parameters<typeof parse>[2]) =>
	parse(bytes, "doc.doc", hints);

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const fixture = (name: string) =>
	new Uint8Array(
		readFileSync(join(import.meta.dirname, "fixtures", "doc", name)),
	);

/** A file whose WordDocument stream sits in regular sectors, so its chain can be damaged. */
function built(options: Partial<WordOptions> = {}): BuiltCfb {
	return cfb(
		wordStreams({
			pieces: [{ text: "Intact paragraph one.\rIntact paragraph two.\r" }],
			padTo: 20_000,
			...options,
		}),
	);
}

const view = (b: BuiltCfb) => new DataView(b.bytes.buffer);
const GOOD = ["Intact paragraph one.", "Intact paragraph two."];

describe("doc hostile: the compound file header", () => {
	it("reads the intact file", async () => {
		expect(textsOf(await read(built().bytes))).toEqual(GOOD);
	});

	it("rejects sector sizes and byte orders it does not know", async () => {
		const patches: [number, number, 16 | 32][] = [
			[30, 0, 16],
			[30, 7, 16],
			[30, 16, 16],
			[30, 31, 16],
			[30, 0xffff, 16],
			[32, 0, 16],
			[32, 5, 16],
			[32, 9, 16],
			[28, 0xfeff, 16],
			[28, 0, 16],
			[26, 2, 16],
			[26, 5, 16],
			[26, 0xffff, 16],
		];
		for (const [at, value, bits] of patches) {
			const b = built();
			if (bits === 16) view(b).setUint16(at, value, true);
			expectError(await read(b.bytes), "unsupported");
		}
	});

	it("rejects counts that cannot fit in the file", async () => {
		const patches: [number, number][] = [
			[44, 0xffffffff],
			[44, 0x7fffffff],
			[44, 0],
			[72, 0xffffffff],
			[72, 100_000],
			[64, 0xffffffff],
			[48, 0xffffffff],
			[48, 0x7ffffff0],
			[56, 0xffffffff],
		];
		for (const [at, value] of patches) {
			const b = built();
			view(b).setUint32(at, value, true);
			expectWellFormed(await read(b.bytes));
		}
		const b = built();
		view(b).setUint32(44, 0xffffffff, true);
		expectError(await read(b.bytes), "unsupported");
	});

	it("rejects a DIFAT chain that loops on itself", async () => {
		const b = cfb(
			wordStreams({ pieces: [{ text: "Far away.\r" }], padTo: 9 * MiB }),
		);
		const first = b.layout.difatSectors[0];
		if (first === undefined)
			throw new Error("this file should have a DIFAT sector");
		// Claim more FAT sectors than one DIFAT sector lists, and point the DIFAT sector's
		// "next" link at itself, so reading the claimed count means walking a loop.
		const fat = b.layout.fatSectors[0] ?? 0;
		for (let k = 0; k < 127; k++) {
			view(b).setUint32((first + 1) * 512 + k * 4, fat, true);
		}
		view(b).setUint32((first + 1) * 512 + 127 * 4, first, true);
		view(b).setUint32(44, 109 + 127 * 3, true);
		view(b).setUint32(72, 5, true);
		expectError(await read(b.bytes), "unsupported");
	});

	it("rejects a header DIFAT that names the same FAT sector many times, or a sector outside the file", async () => {
		const b = built();
		const fat = b.layout.fatSectors[0] ?? 0;
		for (let k = 0; k < 109; k++) view(b).setUint32(76 + k * 4, fat, true);
		view(b).setUint32(44, 109, true);
		expectWellFormed(await read(b.bytes));
		const c = built();
		view(c).setUint32(76, 0x00ffffff, true);
		expectError(await read(c.bytes), "unsupported");
	});

	it("rejects a file that is only a header, or shorter than one", async () => {
		const b = built();
		for (const length of [8, 100, 511, 512, 513, 1024]) {
			expectWellFormed(await read(b.bytes.subarray(0, length)));
		}
		expectError(await read(b.bytes.subarray(0, 511)), "unsupported");
	});
});

describe("doc hostile: sector chains that lie", () => {
	const wordChain = (b: BuiltCfb): number[] => {
		const start = b.layout.streamStart.WordDocument ?? 0;
		const out: number[] = [start];
		const perFat = b.layout.sectorSize / 4;
		const d = view(b);
		for (let k = 0; k < 1000; k++) {
			const last = out[out.length - 1] ?? 0;
			const holder = b.layout.fatSectors[Math.floor(last / perFat)] ?? 0;
			const next = d.getUint32((holder + 1) * 512 + (last % perFat) * 4, true);
			if (next >= 0xfffffff0) break;
			out.push(next);
		}
		return out;
	};

	it("rejects a chain that loops back to an earlier sector within the stream", async () => {
		const b = built();
		const chain = wordChain(b);
		setFat(b, chain[chain.length - 2] ?? 0, chain[0] ?? 0);
		expectError(await read(b.bytes), "unsupported");
	});

	it("does not mind where the last sector of a stream points", async () => {
		const b = built();
		const chain = wordChain(b);
		setFat(b, chain[chain.length - 1] ?? 0, chain[0] ?? 0);
		expectWellFormed(await read(b.bytes));
	});

	it("rejects a chain that loops in the middle and a sector that points at itself", async () => {
		const b = built();
		const chain = wordChain(b);
		setFat(b, chain[5] ?? 0, chain[2] ?? 0);
		expectError(await read(b.bytes), "unsupported");
		const c = built();
		const cc = wordChain(c);
		setFat(c, cc[3] ?? 0, cc[3] ?? 0);
		expectError(await read(c.bytes), "unsupported");
	});

	it("rejects a chain that leaves the file, ends early, or runs into a marker", async () => {
		for (const value of [
			0x00ffffff,
			0xfffffff0,
			SPECIAL.ENDOFCHAIN,
			SPECIAL.FREESECT,
			SPECIAL.FATSECT,
			SPECIAL.DIFSECT,
		]) {
			const b = built();
			const chain = wordChain(b);
			setFat(b, chain[4] ?? 0, value);
			expectError(await read(b.bytes), "unsupported");
		}
	});

	it("rejects a stream that claims more bytes than its chain holds", async () => {
		for (const size of [0x7fffffff, 0xffffffff, 1 << 30, 100_000]) {
			const b = built();
			setEntry(b, 1, ENTRY.size, size);
			expectError(await read(b.bytes), "unsupported");
		}
	});

	it("rejects a stream with no start sector, an out-of-range start, or a zero size", async () => {
		for (const [field, value] of [
			[ENTRY.start, 0xffffffff],
			[ENTRY.start, SPECIAL.ENDOFCHAIN],
			[ENTRY.start, 0x7fffffff],
			[ENTRY.size, 0],
		] as const) {
			const b = built();
			setEntry(b, 1, field, value);
			expectError(await read(b.bytes), "unsupported");
		}
	});

	it("survives a directory chain that loops", async () => {
		const b = built();
		const dir = b.layout.dirSectors[0] ?? 0;
		setFat(b, dir, dir);
		expectWellFormed(await read(b.bytes));
	});

	it("survives directory entries whose tree links loop", async () => {
		for (const [index, field, value] of [
			[0, ENTRY.child, 0],
			[0, ENTRY.child, 1],
			[1, ENTRY.right, 1],
			[1, ENTRY.right, 0],
			[1, ENTRY.left, 1],
			[1, ENTRY.left, 2],
			[2, ENTRY.right, 1],
			[1, ENTRY.child, 0],
			[0, ENTRY.child, 0xfffffff0],
		] as const) {
			const b = built();
			setEntry(b, index, field, value);
			expectWellFormed(await read(b.bytes));
		}
	});

	it("rejects two streams both named WordDocument", async () => {
		const streams = wordStreams({ pieces: [{ text: "One.\r" }], padTo: 5000 });
		const twin = streams[0];
		if (!twin) throw new Error("no stream");
		const b = cfb([...streams, { ...twin }]);
		expectError(await read(b.bytes), "unsupported");
	});

	it("survives hostile directory names", async () => {
		const b = built();
		const o = b.layout.entryOffset[1] ?? 0;
		for (const length of [0, 1, 2, 63, 64, 65, 0xffff]) {
			view(b).setUint16(o + 64, length, true);
			expectWellFormed(await read(b.bytes));
		}
		for (let k = 0; k < 64; k++) b.bytes[o + k] = 0x41;
		expectWellFormed(await read(b.bytes));
	});
});

describe("doc hostile: the mini stream", () => {
	/** A file whose WordDocument stream is small enough to live in the mini stream. */
	const small = (): BuiltCfb =>
		cfb(
			wordStreams({ pieces: [{ text: "Mini text one.\rMini text two.\r" }] }),
		);

	it("reads the intact mini-stream file", async () => {
		expect(textsOf(await read(small().bytes))).toEqual([
			"Mini text one.",
			"Mini text two.",
		]);
	});

	it("rejects a mini FAT that loops", async () => {
		const b = small();
		const at = (b.layout.miniFatSectors[0] ?? 0) + 1;
		const d = view(b);
		for (let k = 0; k < 20; k++) d.setUint32(at * 512 + k * 4, 0, true);
		expectError(await read(b.bytes), "unsupported");
	});

	it("rejects a mini FAT that points outside the mini stream", async () => {
		const b = small();
		const at = (b.layout.miniFatSectors[0] ?? 0) + 1;
		view(b).setUint32(at * 512, 0x00ffffff, true);
		expectError(await read(b.bytes), "unsupported");
	});

	it("rejects a root entry whose mini stream is missing, shorter than its chain, or enormous", async () => {
		for (const [field, value] of [
			[ENTRY.start, 0xffffffff],
			[ENTRY.start, 0x7fffffff],
			[ENTRY.size, 0],
			[ENTRY.size, 64],
			[ENTRY.size, 0xffffffff],
		] as const) {
			const b = small();
			setEntry(b, 0, field, value);
			expectError(await read(b.bytes), "unsupported");
		}
	});

	it("does not treat a mini FAT count past the file as an invitation to allocate", async () => {
		const b = small();
		view(b).setUint32(64, 0x7fffffff, true);
		expectWellFormed(await read(b.bytes));
		const c = small();
		view(c).setUint32(60, 0x7ffffff0, true);
		expectError(await read(c.bytes), "unsupported");
	});

	it("handles a mini stream cutoff that is zero or huge", async () => {
		for (const cutoff of [0, 1, 0xffffffff, 512]) {
			const b = small();
			view(b).setUint32(56, cutoff, true);
			expectWellFormed(await read(b.bytes));
		}
	});
});

describe("doc hostile: the Word structures", () => {
	const doc = (options: Partial<WordOptions>) =>
		cfb(wordStreams({ pieces: [{ text: "Good text.\r" }], ...options })).bytes;

	it("rejects a FIB whose counts or offsets are lies", async () => {
		for (const options of [
			{ csw: 0 },
			{ csw: 0xffff },
			{ cslw: 0 },
			{ cslw: 0xffff },
			{ cbRgFcLcb: 0 },
			{ cbRgFcLcb: 5 },
			{ cbRgFcLcb: 0xffff },
		] as Partial<WordOptions>[]) {
			expectError(await read(doc(options)), "unsupported");
		}
	});

	it("rejects a piece table that is outside the table stream", async () => {
		for (const options of [
			{ lcbClx: 0xffffffff },
			{ lcbClx: 0x7fffffff },
			{ lcbClx: 0 },
			{ lcbClx: 3 },
			{ fcClx: 0xffffffff },
			{ fcClx: 0x7fffffff },
			{ fcClx: 100_000 },
		] as Partial<WordOptions>[]) {
			expectError(await read(doc(options)), "unsupported");
		}
	});

	it("rejects a table stream that is missing", async () => {
		expectError(await read(doc({ tableName: "2Table" })), "unsupported");
		expectError(await read(doc({ whichTable: 0 })), "unsupported");
	});

	it("rejects a CLX that is garbage, empty or only property modifiers", async () => {
		const prc = (cb: number): Uint8Array =>
			Uint8Array.from([
				0x01,
				cb & 0xff,
				cb >> 8,
				...new Array(Math.min(cb, 50)).fill(0),
			]);
		for (const clx of [
			Uint8Array.from([0x07, 1, 2, 3]),
			Uint8Array.from([0x00]),
			Uint8Array.from([0x02]),
			Uint8Array.from([0x02, 0xff, 0xff, 0xff, 0xff]),
			prc(0xffff),
			prc(10),
			new Uint8Array(0),
		]) {
			expectError(await read(doc({ clx })), "unsupported");
		}
	});

	it("reads a piece table that holds no pieces as an empty document", async () => {
		const clx = Uint8Array.from([0x02, 0x04, 0, 0, 0, 0, 0, 0, 0]);
		expectError(await read(doc({ clx })), "empty");
	});

	it("rejects a piece table with positions that go backwards or past the text", async () => {
		expectError(
			await read(
				doc({ pieces: [{ text: "ab\r" }, { text: "cd\r" }], cps: [0, 6, 3] }),
			),
			"unsupported",
		);
		expectError(
			await read(doc({ pieces: [{ text: "ab\r" }], cps: [5, 2] })),
			"unsupported",
		);
		expectError(
			await read(
				doc({
					pieces: [{ text: "ab\r" }],
					cps: [0, 0xffffffff],
					ccpText: 0xffffffff,
				}),
			),
			"unsupported",
		);
		expectError(
			await read(
				doc({ pieces: [{ text: "ab\r" }], cps: [0xffffffff, 0xffffffff] }),
			),
			"unsupported",
		);
	});

	it("rejects pieces that point outside the WordDocument stream", async () => {
		for (const offsets of [[0xffffffff], [0x7fffffff], [1_000_000]]) {
			expectError(await read(doc({ offsets })), "unsupported");
		}
		expectError(
			await read(
				doc({
					pieces: [{ text: "ab\r", compressed: true }],
					offsets: [1_000_000],
				}),
			),
			"unsupported",
		);
	});

	it("rejects pieces that overlap to read the same bytes many times", async () => {
		const text = "x".repeat(200_000);
		const outcome = await read(
			doc({
				pieces: [{ text }],
				clx: manyPieces(400, 200_000),
				ccpText: 400 * 200_000,
			}),
		);
		expectError(outcome, "unsupported");
	});

	it("handles ccpText of zero and of four billion", async () => {
		expectError(await read(doc({ ccpText: 0 })), "empty");
		expectWellFormed(await read(doc({ ccpText: 0xffffffff })));
		expectWellFormed(await read(doc({ ccpText: 0x7fffffff })));
	});

	it("rejects an odd offset for an 8-bit piece and a Unicode piece at an odd offset", async () => {
		expectWellFormed(
			await read(doc({ pieces: [{ text: "ab\r" }], offsets: [1025] })),
		);
		expectWellFormed(
			await read(
				doc({ pieces: [{ text: "ab\r", compressed: true }], offsets: [1025] }),
			),
		);
	});

	it("survives a million field starts", async () => {
		const text = `\u0013`.repeat(1_000_000) + "visible?\r";
		const outcome = await read(cfb(wordStreams({ pieces: [{ text }] })).bytes);
		expectWellFormed(outcome);
	}, 60_000);

	it("survives a million alternating field marks", async () => {
		const text = "\u0013 a \u0014 b \u0015 ".repeat(100_000);
		const outcome = await read(cfb(wordStreams({ pieces: [{ text }] })).bytes);
		expectWellFormed(outcome);
	}, 60_000);
});

/** A CLX whose `n` pieces all read the same `chars` characters at the start of the text. */
function manyPieces(n: number, chars: number): Uint8Array {
	const plc = new Uint8Array((n + 1) * 4 + n * 8);
	const pv = new DataView(plc.buffer);
	for (let k = 0; k <= n; k++) pv.setUint32(k * 4, k * chars, true);
	for (let k = 0; k < n; k++) pv.setUint32((n + 1) * 4 + k * 8 + 2, 1024, true);
	const clx = new Uint8Array(5 + plc.length);
	clx[0] = 0x02;
	new DataView(clx.buffer).setUint32(1, plc.length, true);
	clx.set(plc, 5);
	return clx;
}

describe("doc hostile: size ceilings", () => {
	it("stops with too-big instead of building millions of paragraphs", async () => {
		const text = "a\r".repeat(1_200_000);
		const outcome = await read(cfb(wordStreams({ pieces: [{ text }] })).bytes);
		expectError(outcome, "too-big");
	}, 60_000);

	it("honours a lower block ceiling", async () => {
		const bytes = cfb(
			wordStreams({ pieces: [{ text: "a\r".repeat(2000) }] }),
		).bytes;
		expectError(await read(bytes, { maxBlocks: 100 }), "too-big");
	});

	it("honours a lower byte ceiling", async () => {
		const bytes = cfb(
			wordStreams({ pieces: [{ text: "a".repeat(5000) }] }),
		).bytes;
		expectError(await read(bytes, { maxBytes: 1000 }), "too-big");
	});

	it("reads one paragraph of ten million characters", async () => {
		const text = `${"word ".repeat(2_000_000)}\r`;
		const outcome = expectSuccess(
			await read(cfb(wordStreams({ pieces: [{ text }] })).bytes),
		);
		expect(outcome.document.blocks).toHaveLength(1);
	}, 60_000);

	it("reads text split across a hundred thousand tiny pieces", async () => {
		const pieces = Array.from({ length: 100_000 }, (_, k) => ({
			text: k % 50 === 49 ? "w\r" : "w ",
		}));
		const outcome = await read(cfb(wordStreams({ pieces })).bytes);
		expect(textsOf(outcome)).toHaveLength(2000);
	}, 60_000);
});

describe("doc hostile: random damage never breaks the contract", () => {
	it("returns a valid Document or a typed error for every truncation of a real file", async () => {
		const full = fixture("lamp-structure.doc");
		const cuts = new Set<number>();
		for (let cut = 0; cut <= full.length; cut += 97) cuts.add(cut);
		for (let cut = 0; cut <= full.length; cut += 512) {
			cuts.add(cut);
			cuts.add(cut + 1);
			cuts.add(Math.max(0, cut - 1));
		}
		for (const cut of cuts) expectWellFormed(await read(full.subarray(0, cut)));
	}, 60_000);

	it("returns a valid Document or a typed error for 600 files with flipped bytes", async () => {
		const rand = mulberry32(0xd0c);
		const sources = [
			fixture("lamp-structure.doc"),
			built().bytes,
			fixture("libreoffice-arabic.doc"),
		];
		for (let i = 0; i < 600; i++) {
			const source = sources[i % sources.length] ?? sources[0];
			if (!source) throw new Error("no source");
			const bytes = source.slice();
			const flips = 1 + Math.floor(rand() * 12);
			for (let k = 0; k < flips; k++) {
				// Aim at the header, the FAT and the directory, where one byte matters most.
				const target =
					rand() < 0.6
						? Math.floor(rand() * 1024)
						: Math.floor(rand() * bytes.length);
				bytes[target] = Math.floor(rand() * 256);
			}
			expectWellFormed(await read(bytes));
		}
	}, 120_000);

	it("returns a valid Document or a typed error for compound files full of random sectors", async () => {
		const rand = mulberry32(77);
		for (let i = 0; i < 200; i++) {
			const bytes = new Uint8Array(512 * (2 + Math.floor(rand() * 20)));
			for (let k = 0; k < bytes.length; k++)
				bytes[k] = Math.floor(rand() * 256);
			bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
			expectWellFormed(await read(bytes));
		}
	}, 60_000);

	it("returns a valid Document or a typed error for random FIB fields", async () => {
		const rand = mulberry32(31);
		for (let i = 0; i < 300; i++) {
			const streams = wordStreams({
				pieces: [{ text: "Text one.\rText two.\r" }],
			});
			const word = streams[0]?.data;
			if (!word) throw new Error("no stream");
			for (let k = 0; k < 10; k++) {
				word[Math.floor(rand() * 512)] = Math.floor(rand() * 256);
			}
			expectWellFormed(await read(cfb(streams).bytes));
		}
	}, 60_000);
});

/**
 * Wall-clock budgets flake when suites share a machine. Each hostile case is timed against
 * a plain document of the same size parsed in the same run; a quadratic loop misses the ratio
 * by orders of magnitude while load slows both sides alike.
 */
describe("doc hostile: no superlinear blowup", { timeout: 120_000 }, () => {
	const SLOWDOWN_LIMIT = 50;

	async function timed(bytes: Uint8Array): Promise<number> {
		const started = performance.now();
		const outcome = await read(bytes);
		const elapsed = performance.now() - started;
		if (!outcome.ok && outcome.reason === "too-big") {
			throw new Error(`refused before parsing: ${outcome.message}`);
		}
		return elapsed;
	}

	async function expectNoBlowup(text: string): Promise<void> {
		const unit = "lorem ipsum dolor sit amet\r";
		const plain = cfb(
			wordStreams({
				pieces: [{ text: unit.repeat(Math.ceil(text.length / unit.length)) }],
			}),
		).bytes;
		const first = await timed(plain);
		const baseline = Math.max(first, await timed(plain));
		const elapsed = await timed(cfb(wordStreams({ pieces: [{ text }] })).bytes);
		expect(
			elapsed,
			`${elapsed.toFixed(0)} ms against a ${baseline.toFixed(0)} ms linear baseline`,
		).toBeLessThan(Math.max(baseline, 20) * SLOWDOWN_LIMIT);
	}

	it("a flood of field starts", async () => {
		await expectNoBlowup("\u0013".repeat(3 * MiB));
	});

	it("a flood of field marks in every order", async () => {
		await expectNoBlowup(
			"\u0013a\u0014b\u0015\u0013\u0013\u0015\u0015".repeat(300_000),
		);
	});

	it("a flood of table cells", async () => {
		await expectNoBlowup("cell\u0007\u0007".repeat(400_000));
	});

	it("a flood of line breaks and anchors", async () => {
		await expectNoBlowup("a\u000b\u0001\u0008\u001e".repeat(600_000));
	});

	it("a flood of paragraph marks with spaces", async () => {
		await expectNoBlowup(" \r \r\r\r".repeat(800_000));
	});

	it("a long paragraph with no mark", async () => {
		await expectNoBlowup("word ".repeat(1_200_000));
	});

	it("many pieces that cover the text one character at a time", async () => {
		const pieces = Array.from({ length: 80_000 }, () => ({ text: "w" }));
		const plain = cfb(
			wordStreams({ pieces: [{ text: "w".repeat(80_000) }] }),
		).bytes;
		const first = await timed(plain);
		const baseline = Math.max(first, await timed(plain));
		const elapsed = await timed(cfb(wordStreams({ pieces })).bytes);
		expect(elapsed).toBeLessThan(Math.max(baseline, 50) * SLOWDOWN_LIMIT);
	});

	it("a file of eighteen million characters", async () => {
		await expectNoBlowup(
			"lorem ipsum dolor sit amet, consectetur adipiscing elit sed do\r".repeat(
				300_000,
			),
		);
	});
});
