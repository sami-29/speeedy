import { describe, expect, it } from "vitest";
import { type ParseOutcome, parse, parseText } from "../src/index";
import { expectError, expectSuccess, expectWellFormed, utf8 } from "./helpers";

/** A small seeded generator, so a failing case can be replayed exactly. */
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

const NAMES = [
	"a.txt",
	"a.md",
	"a.csv",
	"a.markdown",
	"a.TXT",
	"noext",
	"",
	".",
	"a.pdf",
	"a.epub",
	"a.docx",
	"a.html",
	"a.rtf",
];

describe("fuzz: random bytes never break the contract", () => {
	it("returns a valid Document or a typed error for 600 random byte arrays", async () => {
		const rand = mulberry32(0x5eeed);
		const lengths = [0, 1, 2, 3, 4, 7, 16, 100, 1000, 5000];
		for (let i = 0; i < 600; i++) {
			const length = lengths[Math.floor(rand() * lengths.length)] ?? 0;
			const bytes = new Uint8Array(length);
			const mode = rand();
			for (let j = 0; j < length; j++) {
				bytes[j] =
					mode < 0.3
						? Math.floor(rand() * 256)
						: mode < 0.6
							? 32 + Math.floor(rand() * 95)
							: Math.floor(rand() * 4) === 0
								? Math.floor(rand() * 256)
								: 97 + Math.floor(rand() * 26);
			}
			const name = NAMES[Math.floor(rand() * NAMES.length)] ?? "a.txt";
			expectWellFormed(await parse(bytes, name));
		}
	});

	it("survives random bytes under every legacy codepage hint and BOM prefix", async () => {
		const rand = mulberry32(42);
		const labels = [
			"windows-1250",
			"windows-1251",
			"windows-1254",
			"windows-1255",
			"windows-1256",
			"shift_jis",
			"gbk",
			"euc-kr",
			"utf-16le",
			"utf-16be",
			"utf-8",
			"x-user-defined",
			"iso-8859-2",
		];
		const prefixes = [
			[],
			[0xef, 0xbb, 0xbf],
			[0xff, 0xfe],
			[0xfe, 0xff],
			[0xff, 0xfe, 0, 0],
			[0, 0, 0xfe, 0xff],
		];
		for (let i = 0; i < 300; i++) {
			const body = Array.from({ length: Math.floor(rand() * 200) }, () =>
				Math.floor(rand() * 256),
			);
			const prefix = prefixes[Math.floor(rand() * prefixes.length)] ?? [];
			const label = labels[Math.floor(rand() * labels.length)] ?? "utf-8";
			expectWellFormed(
				await parse(Uint8Array.from([...prefix, ...body]), "a.txt", {
					encoding: label,
				}),
			);
		}
	});

	it("survives mutated Markdown and CSV built from their own special characters", async () => {
		const rand = mulberry32(7);
		const pieces = [
			"*",
			"**",
			"_",
			"__",
			"`",
			"```",
			"~~~",
			"[",
			"]",
			"(",
			")",
			"![",
			"](",
			"<",
			">",
			"&",
			"&#",
			";",
			"#",
			"##",
			"-",
			"- ",
			"1. ",
			"> ",
			">> ",
			"|",
			"---",
			"\n",
			"\n\n",
			"    ",
			"\t",
			" ",
			'"',
			'""',
			",",
			"\\",
			"x",
			"word",
			"é",
			"\u0000",
			"\r",
			"\u2028",
			"http://a.b/c",
			"[x]: u",
			"&amp;",
			"&#x110000;",
			"---\n",
		];
		for (let i = 0; i < 500; i++) {
			let source = "";
			const count = Math.floor(rand() * 80);
			for (let j = 0; j < count; j++) {
				source += pieces[Math.floor(rand() * pieces.length)] ?? "";
			}
			for (const name of ["a.md", "a.csv", "a.txt"]) {
				expectWellFormed(await parse(utf8(source), name));
			}
			expectWellFormed(await parseText(source));
		}
	});

	it("keeps every span inside its block's text for Markdown fuzz", async () => {
		const rand = mulberry32(99);
		const pieces = [
			"*",
			"**",
			"_",
			"[",
			"](",
			")",
			"x",
			" ",
			"word",
			"`",
			"![",
			"\n",
			"<b>",
			"&amp;",
			"\\",
		];
		for (let i = 0; i < 400; i++) {
			let source = "";
			for (let j = 0; j < 60; j++)
				source += pieces[Math.floor(rand() * pieces.length)] ?? "";
			const outcome = await parse(utf8(source), "a.md");
			if (outcome.ok) {
				for (const block of outcome.document.blocks) {
					if (block.kind === "image-placeholder") continue;
					for (const span of block.spans) {
						expect(span.start).toBeGreaterThanOrEqual(0);
						expect(span.end).toBeLessThanOrEqual(block.text.length);
						expect(span.start).toBeLessThan(span.end);
					}
				}
			}
			expectWellFormed(outcome);
		}
	});
});

describe("hostile and huge input finishes quickly with a valid outcome", () => {
	const N = 1_000_000;
	const cases: [string, string, string][] = [
		["a million asterisks", "a.md", "*".repeat(N)],
		["a million underscores", "a.md", "_".repeat(N)],
		["a million backticks", "a.md", "`".repeat(N)],
		["open brackets", "a.md", "[".repeat(N)],
		["empty link openers", "a.md", "[](".repeat(N / 3)],
		["image openers", "a.md", "![".repeat(N / 2)],
		[
			"bracket pairs with long destinations",
			"a.md",
			`${"[a](".repeat(50_000)}${"x".repeat(1000)}`,
		],
		["unmatched openers before closers", "a.md", "*a ".repeat(N / 3)],
		[
			"unmatched closers after openers",
			"a.md",
			`${"_a ".repeat(N / 6)}${"a* ".repeat(N / 6)}`,
		],
		["alternating delimiters", "a.md", "*_".repeat(N / 2)],
		["deep nested quotes", "a.md", `${"> ".repeat(N / 2)}x`],
		["deep nested quote markers without spaces", "a.md", `${">".repeat(N)}x`],
		["deeply indented list", "a.md", `${" ".repeat(N)}- x`],
		["a million list markers", "a.md", "- ".repeat(N / 2)],
		["a million list lines", "a.md", "- x\n".repeat(N / 4)],
		["a million hashes", "a.md", "#".repeat(N)],
		["a million heading lines", "a.md", "# h\n".repeat(N / 4)],
		["entity floods", "a.md", "&amp;".repeat(N / 5)],
		[
			"numeric entity floods",
			"a.md",
			"&#x110000;&#99999999999999999999;&#;".repeat(N / 40),
		],
		["angle brackets", "a.md", "<".repeat(N)],
		["tag floods", "a.md", "<a ".repeat(N / 3)],
		["table pipes", "a.md", "|".repeat(N)],
		["table rows", "a.md", "| a | b |\n| - | - |\n".repeat(N / 40)],
		["setext markers", "a.md", "x\n===\n".repeat(N / 6)],
		["front matter openers", "a.md", "---\n".repeat(N / 4)],
		["reference definitions", "a.md", "[x]: y\n".repeat(N / 7)],
		["backslash floods", "a.md", "\\".repeat(N)],
		["a million quotes in csv", "a.csv", '"'.repeat(N)],
		["a million commas in csv", "a.csv", ",".repeat(N)],
		["a million tiny csv rows", "a.csv", "a,b\n".repeat(N / 4)],
		["one huge csv cell", "a.csv", `"${"x".repeat(N * 5)}"`],
		["quote openers in csv", "a.csv", 'a,"b\n'.repeat(N / 5)],
		["only newlines", "a.txt", "\n".repeat(N)],
		["only carriage returns", "a.txt", "\r".repeat(N)],
		["only spaces", "a.txt", " ".repeat(N)],
		["a single huge line", "a.txt", `${"word ".repeat(N * 2)}`],
		["many tiny paragraphs", "a.txt", "a\n\n".repeat(N)],
		["zero-width characters", "a.txt", "\u200B".repeat(N)],
		[
			"surrogate junk",
			"a.txt",
			"\uD800".repeat(N / 2) + "\uDC00".repeat(N / 2),
		],
		["control characters", "a.txt", "\u0001\u0002a".repeat(N / 3)],
	];

	it.each(cases)(
		"%s (%s)",
		async (_label, name, source) => {
			const bytes = utf8(source);
			const started = performance.now();
			const outcome = await parse(bytes, name);
			const elapsed = performance.now() - started;
			expectWellFormed(outcome);
			expect(elapsed).toBeLessThan(5000);
		},
		30_000,
	);

	it("parses a 20 MB single-paragraph file in a reasonable time", async () => {
		const bytes = utf8("lorem ipsum dolor sit amet. ".repeat(750_000));
		expect(bytes.length).toBeGreaterThan(20_000_000);
		const started = performance.now();
		const outcome = await parse(bytes, "big.txt");
		expectSuccess(outcome);
		expect(performance.now() - started).toBeLessThan(8000);
	}, 30_000);

	it("stops with too-big instead of building millions of blocks", async () => {
		const bytes = utf8("a\n\n".repeat(2_000_000));
		const started = performance.now();
		expectError(await parse(bytes, "many.txt"), "too-big");
		expect(performance.now() - started).toBeLessThan(5000);
	}, 30_000);

	it("stops with too-big for a CSV with millions of rows", async () => {
		const bytes = utf8("a,b\n".repeat(2_000_000));
		expectError(await parse(bytes, "many.csv"), "too-big");
	}, 30_000);

	it("caps list depth so a validator-valid Document always comes back", async () => {
		const outcome = await parse(utf8(`${" ".repeat(400)}- deep\n`), "a.md");
		const result = expectSuccess(outcome);
		const block = result.document.blocks[0];
		expect(block?.kind).toBe("list-item");
		expect(block && "depth" in block ? block.depth : 99).toBeLessThanOrEqual(
			10,
		);
	});
});

describe("hostile input never escapes as markup or script", () => {
	it("keeps tags and handlers out of the Document text", async () => {
		const source =
			'<script>alert(1)</script><img src=x onerror=alert(1)>text<iframe src="javascript:1"></iframe>';
		const outcome = await parse(utf8(source), "a.md");
		const result = expectSuccess(outcome);
		const text = result.document.blocks
			.map((b) => ("text" in b ? b.text : b.alt))
			.join("\n");
		expect(text).not.toMatch(/<\/?(script|img|iframe)/i);
	});

	it("never produces a link span with a script-capable scheme, however it is spelled", async () => {
		const sources = [
			"[a](javascript:alert(1))",
			"[a](  javascript:alert(1)  )",
			"[a](JAVASCRIPT:alert(1))",
			"[a](&#x6A;avascript:alert(1))",
			"[a](java&#10;script:alert(1))",
			"[a](\u0001javascript:alert(1))",
			"[a](data:text/html;base64,PHNjcmlwdD4=)",
			"<javascript:alert(1)>",
			"[a][r]\n\n[r]: javascript:alert(1)",
			"[a](<javascript:alert(1)>)",
		];
		for (const source of sources) {
			const outcome: ParseOutcome = await parse(utf8(source), "a.md");
			expectWellFormed(outcome);
			if (!outcome.ok) continue;
			for (const block of outcome.document.blocks) {
				if (block.kind === "image-placeholder") continue;
				for (const span of block.spans) {
					if (span.kind !== "link") continue;
					const clean = [...span.href]
						.filter((char) => char.charCodeAt(0) > 32)
						.join("")
						.toLowerCase();
					expect(clean, source).toMatch(/^(https?:|mailto:|tel:|[^:]*$)/);
				}
			}
		}
	});

	it("keeps image sources and data URIs out of the Document entirely", async () => {
		const source =
			"![alt](https://tracker.example/pixel.gif?id=1)\n\n![x](data:image/png;base64,AAAA)\n\ntext ![inline](http://t.example/p.png)";
		const outcome = await parse(utf8(source), "a.md");
		const json = JSON.stringify(expectSuccess(outcome).document);
		expect(json).not.toContain("tracker.example");
		expect(json).not.toContain("t.example");
		expect(json).not.toContain("base64");
	});
});

describe("hostile hints", () => {
	it("never throws whatever the hints are", async () => {
		const evil = [
			null,
			undefined,
			0,
			"",
			[],
			() => 1,
			Symbol("x"),
			{ encoding: Symbol("x") },
			{ encoding: { toString: () => "utf-8" } },
			{ language: { toString: () => "en" } },
			{ maxBytes: -1, maxBlocks: -1 },
			{ maxBytes: 0, maxBlocks: 0 },
			{ maxBytes: 1.5, maxBlocks: 1.5 },
			{ maxBytes: Number.POSITIVE_INFINITY },
			Object.create(null),
			new Proxy(
				{},
				{
					get: () => {
						throw new Error("trap");
					},
				},
			),
			{ __proto__: { encoding: "windows-1251" } },
		];
		for (const hints of evil) {
			expectWellFormed(
				await parse(utf8("hello world"), "a.txt", hints as never),
			);
			expectWellFormed(await parseText("hello world", hints as never));
		}
	});

	it("treats non-positive or fractional limits as unset rather than as zero", async () => {
		expect(
			expectSuccess(await parse(utf8("hello"), "a.txt", { maxBytes: 0 }))
				.document.blocks,
		).toHaveLength(1);
		expect(
			expectSuccess(await parse(utf8("hello"), "a.txt", { maxBlocks: -5 }))
				.document.blocks,
		).toHaveLength(1);
	});
});
