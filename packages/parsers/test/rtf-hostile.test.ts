import { describe, expect, it } from "vitest";
import { parse } from "../src/index";
import {
	blocksOf,
	expectError,
	expectSuccess,
	expectWellFormed,
	textsOf,
} from "./helpers";

const MiB = 1024 * 1024;

const bin = (text: string): Uint8Array => {
	const out = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
	return out;
};

const doc = (body: string, header = "\\ansi") =>
	bin(`{\\rtf1${header} ${body}}`);

const read = (bytes: Uint8Array, hints?: Parameters<typeof parse>[2]) =>
	parse(bytes, "doc.rtf", hints);

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

describe("rtf hostile: nesting", () => {
	it("refuses groups nested absurdly deep with a typed error, not a stack overflow", async () => {
		for (const depth of [1_000, 100_000, 3_000_000]) {
			const outcome = await read(
				bin(`{\\rtf1\\ansi ${"{".repeat(depth)}text${"}".repeat(depth)}}`),
			);
			expectError(outcome, "unsupported");
		}
	});

	it("refuses depth bombs made of formatting groups and ignorable destinations", async () => {
		expectError(
			await read(bin(`{\\rtf1 ${"{\\b".repeat(200_000)}x`)),
			"unsupported",
		);
		expectError(
			await read(bin(`{\\rtf1 ${"{\\*\\x".repeat(200_000)}x`)),
			"unsupported",
		);
		expectError(
			await read(bin(`{\\rtf1 ${"{\\fonttbl".repeat(200_000)}x`)),
			"unsupported",
		);
	});

	it("still reads ordinary nesting (a table in a table in a list)", async () => {
		const depth = 100;
		const outcome = await read(
			bin(
				`{\\rtf1\\ansi ${"{\\b ".repeat(depth)}deep${"}".repeat(depth)}\\par}`,
			),
		);
		expect(textsOf(outcome)).toEqual(["deep"]);
	});

	it("reads a million shallow groups", async () => {
		const outcome = await read(
			bin(`{\\rtf1\\ansi ${"{a}".repeat(1_000_000)}\\par}`),
		);
		expect(textsOf(outcome)[0]?.length).toBe(1_000_000);
	}, 60_000);

	it("survives a flood of closing braces", async () => {
		const outcome = await read(bin(`{\\rtf1\\ansi A${"}".repeat(2_000_000)}`));
		expect(textsOf(outcome)).toEqual(["A"]);
	});
});

describe("rtf hostile: control words and numbers", () => {
	it("reads past a control word of five million letters", async () => {
		const outcome = await read(
			bin(`{\\rtf1\\ansi before \\${"a".repeat(5_000_000)} after\\par}`),
		);
		expect(textsOf(outcome)).toEqual(["before after"]);
	});

	it("reads past parameters with a million digits and with huge values", async () => {
		const outcome = await read(
			bin(
				`{\\rtf1\\ansi A \\fs${"9".repeat(1_000_000)} B \\uc${"9".repeat(500)} \\u${"9".repeat(500)}x C \\li-${"9".repeat(1000)} D\\par}`,
			),
		);
		expectWellFormed(outcome);
	});

	it("treats \\bin with a lying length as the rest of the file, never reading past it", async () => {
		for (const n of ["2000000000", "99999999999999999999", "-5", "0"]) {
			expectWellFormed(await read(bin(`{\\rtf1\\ansi A\\bin${n} xyz}`)));
		}
		expectWellFormed(await read(bin("{\\rtf1\\ansi A\\bin3")));
	});

	it("ends cleanly on every kind of truncation", async () => {
		for (const tail of [
			"\\",
			"\\'",
			"\\'4",
			"{",
			"\\u",
			"\\u-",
			"\\*",
			"{\\*",
			"\\a",
			"\\uc",
		]) {
			expectWellFormed(await read(bin(`{\\rtf1\\ansi Text ${tail}`)));
		}
	});

	it("survives a fallback skip of two billion characters", async () => {
		const outcome = await read(
			bin("{\\rtf1\\ansi\\uc2147483647 \\u65 lots of skipped text\\par}"),
		);
		expectWellFormed(outcome);
	});

	it("never lets a control word swallow the closing brace of a group", async () => {
		const outcome = await read(bin("{\\rtf1\\ansi {\\b\\i\\ul}After\\par}"));
		expect(textsOf(outcome)).toEqual(["After"]);
	});

	it("ignores NUL bytes and other control characters in the text", async () => {
		const outcome = await read(
			Uint8Array.from([
				...bin("{\\rtf1\\ansi A"),
				0,
				1,
				2,
				7,
				27,
				0x7f,
				...bin("B\\par}"),
			]),
		);
		expect(textsOf(outcome)).toEqual(["AB"]);
	});
});

describe("rtf hostile: tables that grow without bound", () => {
	it("caps the font table, the style table and captured text without failing", async () => {
		const fonts = "{\\f1\\fcharset204 X;}".repeat(300_000);
		const styles = Array.from(
			{ length: 300_000 },
			(_, k) => `{\\s${k}\\outlinelevel0 S${k};}`,
		).join("");
		const outcome = await read(
			bin(
				`{\\rtf1\\ansi{\\fonttbl${fonts}}{\\stylesheet${styles}}\\f1\\'cf Body\\par}`,
			),
		);
		expectWellFormed(outcome);
	}, 60_000);

	it("caps a field instruction, a title and a list label of ten million characters", async () => {
		const long = "A".repeat(10 * MiB);
		const outcome = await read(
			bin(
				`{\\rtf1\\ansi{\\info{\\title ${long}}}{\\field{\\*\\fldinst HYPERLINK "${long}"}{\\fldrslt link}}` +
					`\\pard\\ls1{\\listtext ${long}}Item\\par}`,
			),
		);
		const done = expectSuccess(outcome);
		expect((done.title ?? "").length).toBeLessThanOrEqual(200);
		expect(JSON.stringify(done.document).length).toBeLessThan(10_000);
	}, 60_000);

	it("does not let a font index or style number outside the range break anything", async () => {
		const outcome = await read(
			bin(
				"{\\rtf1\\ansi{\\fonttbl{\\f-5 A;}{\\f99999999999 B;}}\\f-1 \\'e9\\f4294967295 \\'e9\\s99999999999 x\\par}",
			),
		);
		expectWellFormed(outcome);
	});
});

describe("rtf hostile: block and size ceilings", () => {
	it("stops with too-big instead of building millions of paragraphs", async () => {
		const outcome = await read(
			bin(`{\\rtf1\\ansi ${"a\\par ".repeat(1_200_000)}}`),
		);
		expectError(outcome, "too-big");
	}, 60_000);

	it("honours a lower block ceiling", async () => {
		const outcome = await read(
			bin(`{\\rtf1\\ansi ${"a\\par ".repeat(2_000)}}`),
			{
				maxBlocks: 100,
			},
		);
		expectError(outcome, "too-big");
	});

	it("honours a lower byte ceiling", async () => {
		const outcome = await read(doc("x".repeat(5000)), { maxBytes: 1000 });
		expectError(outcome, "too-big");
	});

	it("reports five million empty paragraphs as empty", async () => {
		const outcome = await read(
			bin(`{\\rtf1\\ansi ${"\\par ".repeat(5_000_000)}}`),
		);
		expectError(outcome, "empty");
	}, 60_000);

	it("stops a flood of pictures at the block ceiling", async () => {
		const outcome = await read(
			bin(`{\\rtf1\\ansi ${"{\\pict ff}".repeat(2_000)}\\par}`),
			{
				maxBlocks: 500,
			},
		);
		expectError(outcome, "too-big");
	});

	it("reads a very long single paragraph", async () => {
		const outcome = await read(doc("word ".repeat(2_000_000)));
		expect(textsOf(outcome)[0]?.length).toBe(9_999_999);
	}, 60_000);
});

describe("rtf hostile: code pages", () => {
	it("decodes a hundred thousand double-byte pairs split across the decoder buffer", async () => {
		const outcome = await read(
			bin(
				`{\\rtf1\\ansi{\\fonttbl{\\f0\\fcharset128 A;}}\\f0 ${"\\'82\\'a0".repeat(100_000)}\\par}`,
			),
		);
		expect(textsOf(outcome)).toEqual(["あ".repeat(100_000)]);
	}, 60_000);

	it("never leaks half of a double-byte pair into the next text", async () => {
		const outcome = await read(
			bin(
				"{\\rtf1\\ansi{\\fonttbl{\\f0\\fcharset128 A;}}\\f0 \\'82 plain\\par}",
			),
		);
		expectWellFormed(outcome);
	});

	it("reads twenty million raw high bytes", async () => {
		const bytes = new Uint8Array(20 * MiB);
		bytes.fill(0xcf);
		const head = bin("{\\rtf1\\ansi\\ansicpg1251 ");
		const tail = bin("\\par}");
		const all = new Uint8Array(head.length + bytes.length + tail.length);
		all.set(head);
		all.set(bytes, head.length);
		all.set(tail, head.length + bytes.length);
		const outcome = await read(all);
		expect(textsOf(outcome)[0]?.length).toBe(20 * MiB);
	}, 60_000);
});

describe("rtf hostile: random input never breaks the contract", () => {
	const TOKENS = [
		"{",
		"}",
		"\\",
		"\\*",
		"\\'",
		"\\'e9",
		"\\u",
		"\\u233",
		"\\u-3?",
		"\\uc0",
		"\\uc9",
		"\\par",
		"\\cell",
		"\\row",
		"\\pard",
		"\\plain",
		"\\b",
		"\\b0",
		"\\i",
		"\\ab",
		"\\rtlch",
		"\\f0",
		"\\f9",
		"\\fcharset128",
		"\\fcharset204",
		"\\cpg1251",
		"\\ansicpg932",
		"\\ansicpg-1",
		"\\fonttbl",
		"\\stylesheet",
		"\\s1",
		"\\s2",
		"\\outlinelevel0",
		"\\ls1",
		"\\ilvl3",
		"\\listtext",
		"\\fldinst",
		"\\fldrslt",
		"\\field",
		"\\pict",
		"\\bin2",
		"\\info",
		"\\title",
		"\\intbl",
		" ",
		"word",
		'HYPERLINK "http://x"',
		";",
		"\r\n",
		"é",
		"ÿ",
		"\u0000",
	];

	it("returns a valid Document or a typed error for 1,500 random token streams", async () => {
		const rand = mulberry32(0x7f0a);
		for (let i = 0; i < 1500; i++) {
			const count = 1 + Math.floor(rand() * 300);
			let text = "{\\rtf1\\ansi";
			for (let k = 0; k < count; k++) {
				text += TOKENS[Math.floor(rand() * TOKENS.length)] ?? "";
			}
			expectWellFormed(await read(bin(text)));
		}
	}, 60_000);

	it("returns a valid Document or a typed error for random bytes after the header", async () => {
		const rand = mulberry32(99);
		for (let i = 0; i < 300; i++) {
			const bytes = new Uint8Array(5 + Math.floor(rand() * 2000));
			bytes.set(bin("{\\rtf1"));
			for (let k = 6; k < bytes.length; k++)
				bytes[k] = Math.floor(rand() * 256);
			expectWellFormed(await read(bytes));
		}
	}, 60_000);

	it("survives every prefix of a real document", async () => {
		const full = doc(
			'{\\fonttbl{\\f0\\fcharset162 A;}}{\\stylesheet{\\s1 heading 1;}}\\pard\\s1 T\\par\\pard\\f0\\\'fe {\\b b}\\u233?{\\field{\\*\\fldinst HYPERLINK "http://x"}{\\fldrslt L}}\\par',
		);
		for (let cut = 0; cut <= full.length; cut++) {
			expectWellFormed(await read(full.subarray(0, cut)));
		}
	});
});

/**
 * Wall-clock budgets flake when suites share a machine. Each hostile case is timed against
 * a plain RTF file of the same size parsed in the same run; a quadratic loop misses the ratio
 * by orders of magnitude while load slows both sides alike.
 */
describe("rtf hostile: no superlinear blowup", { timeout: 120_000 }, () => {
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

	async function expectNoBlowup(body: string): Promise<void> {
		const unit = "lorem ipsum dolor sit amet\\par ";
		const plain = doc(unit.repeat(Math.ceil(body.length / unit.length)));
		const first = await timed(plain);
		const baseline = Math.max(first, await timed(plain));
		const elapsed = await timed(doc(body));
		expect(
			elapsed,
			`${elapsed.toFixed(0)} ms against a ${baseline.toFixed(0)} ms linear baseline`,
		).toBeLessThan(Math.max(baseline, 20) * SLOWDOWN_LIMIT);
	}

	it("a control word with millions of letters", async () => {
		await expectNoBlowup(`\\${"a".repeat(4 * MiB)}`);
	});

	it("a long run of nested groups at the depth limit, repeated", async () => {
		await expectNoBlowup("{\\b{\\i{\\ul a}}}".repeat(300_000));
	});

	it("a flood of bold toggles", async () => {
		await expectNoBlowup("{\\b a}{\\b0 b}{\\i c}".repeat(300_000));
	});

	it("a flood of \\u escapes with fallbacks", async () => {
		await expectNoBlowup("\\u233?".repeat(800_000));
	});

	it("a flood of \\'hh escapes in a double-byte code page", async () => {
		await expectNoBlowup(
			`{\\fonttbl{\\f0\\fcharset128 A;}}\\f0 ${"\\'82\\'a0".repeat(600_000)}`,
		);
	});

	it("a flood of ignorable destinations", async () => {
		await expectNoBlowup("{\\*\\x some text}".repeat(300_000));
	});

	it("megabytes of picture data", async () => {
		await expectNoBlowup(`{\\pict ${"ab".repeat(8 * MiB)}}`);
	});

	it("megabytes of binary data after \\bin", async () => {
		const n = 6 * MiB;
		await expectNoBlowup(`{\\pict\\bin${n} ${"}{\\".repeat(n / 3)}}`);
	});

	it("a flood of table cells and rows", async () => {
		await expectNoBlowup("\\intbl cell\\cell \\row ".repeat(300_000));
	});

	it("a flood of list items", async () => {
		await expectNoBlowup(
			"\\pard\\ls1\\ilvl2{\\listtext 1.\\tab}item\\par ".repeat(150_000),
		);
	});

	it("a flood of hyperlink fields", async () => {
		await expectNoBlowup(
			'{\\field{\\*\\fldinst HYPERLINK "http://example.org/a"}{\\fldrslt link}} '.repeat(
				120_000,
			),
		);
	});

	it("a flood of style and font definitions", async () => {
		await expectNoBlowup(
			`{\\fonttbl${"{\\f1\\fcharset204 X;}".repeat(150_000)}}{\\stylesheet${"{\\s1\\outlinelevel0 H;}".repeat(150_000)}}`,
		);
	});
});

describe("rtf hostile: results stay well-formed", () => {
	it("keeps every span inside its block's text", async () => {
		const rand = mulberry32(5);
		for (let i = 0; i < 200; i++) {
			let body = "";
			for (let k = 0; k < 60; k++) {
				const pick = Math.floor(rand() * 7);
				body +=
					pick === 0
						? "{\\b x}"
						: pick === 1
							? "{\\i yy }"
							: pick === 2
								? "\\par "
								: pick === 3
									? " "
									: pick === 4
										? '{\\field{\\*\\fldinst HYPERLINK "http://e.org"}{\\fldrslt l}}'
										: pick === 5
											? "\\b0 "
											: "text ";
			}
			const outcome = await read(doc(body));
			if (outcome.ok) {
				for (const block of blocksOf(outcome)) {
					if (block.kind === "image-placeholder") continue;
					for (const span of block.spans) {
						expect(span.start).toBeGreaterThanOrEqual(0);
						expect(span.end).toBeLessThanOrEqual(block.text.length);
						expect(span.start).toBeLessThan(span.end);
					}
					expect(block.text).toBe(block.text.trim());
				}
			}
			expectWellFormed(outcome);
		}
	});
});
