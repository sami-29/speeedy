import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	createSharePayload,
	decodeShareHash,
	MAX_PAYLOAD_CHARS,
	MAX_TEXT_BYTES,
} from "../src/lib/share/codec.ts";

// The 1.x encoder from src/components/promote-page.ts on main, copied here (not into the app)
// so the fixtures are real 1.x links.
function legacyEncode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

const toBase64Url = (bytes: Uint8Array) =>
	Buffer.from(bytes).toString("base64url");

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

const TEXTS = {
	english:
		"The quick brown fox jumps over the lazy dog.\n\nA second paragraph.",
	turkish: "Işık ılık süt içtiğinde ğüşiöç İĞÜŞÖÇ okudu.",
	cyrillic: "Съешь же ещё этих мягких французских булок, да выпей чаю.",
	arabic: "نص حكيم له سر قاطع وذو شأن عظيم مكتوب على ثوب أخضر",
	emoji: "Read 📚 fast 🚀, then rest 😴.",
};

async function share(text: string): Promise<string> {
	const created = await createSharePayload(text);
	if (!created.ok) throw new Error(`could not create: ${created.reason}`);
	return created.payload;
}

describe("Share Link payload", () => {
	for (const [name, text] of Object.entries(TEXTS)) {
		it(`round-trips ${name} text exactly`, async () => {
			const payload = await share(text);
			expect(await decodeShareHash(`#${payload}`)).toEqual({
				kind: "text",
				text,
			});
		});
	}

	it("uses only characters that need no escaping in a URL fragment", async () => {
		const payload = await share(Object.values(TEXTS).join(" "));
		expect(payload).toMatch(/^[A-Za-z0-9._-]+$/);
		expect(encodeURIComponent(payload)).toBe(payload);
	});

	it("compresses: repetitive text gives a much shorter payload than 1.x base64", async () => {
		const text = "speed reading is reading at speed. ".repeat(200);
		const payload = await share(text);
		expect(payload.length).toBeLessThan(legacyEncode(text).length / 10);
	});

	it("refuses empty or blank text", async () => {
		expect(await createSharePayload("")).toEqual({
			ok: false,
			reason: "empty",
		});
		expect(await createSharePayload(" \n\t ")).toEqual({
			ok: false,
			reason: "empty",
		});
	});
});

describe("the size cap on creating a Share Link", () => {
	// Random code points do not compress, so the payload grows with the text.
	function incompressible(chars: number): string {
		let seed = 42;
		let out = "";
		for (let i = 0; i < chars; i++) {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			out += String.fromCharCode(0x4e00 + (seed % 20000));
		}
		return out;
	}

	it("the cap is 16,384 payload characters and 256 KiB of text", () => {
		expect(MAX_PAYLOAD_CHARS).toBe(16_384);
		expect(MAX_TEXT_BYTES).toBe(262_144);
	});

	it("fits text under the cap and reports how much of the cap it uses", async () => {
		const created = await createSharePayload(incompressible(3000));
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.payload.length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
		expect(created.used).toBeCloseTo(
			created.payload.length / MAX_PAYLOAD_CHARS,
			5,
		);
	});

	it("refuses text whose compressed link is over the cap, with no payload", async () => {
		const created = await createSharePayload(incompressible(8000));
		expect(created).toMatchObject({ ok: false, reason: "too-long" });
		expect(created).not.toHaveProperty("payload");
		if (created.ok || created.reason !== "too-long") return;
		expect(created.used).toBeGreaterThan(1);
	});

	it("refuses text over 256 KiB even when it compresses well", async () => {
		const created = await createSharePayload("a".repeat(MAX_TEXT_BYTES + 1));
		expect(created).toMatchObject({ ok: false, reason: "too-long" });
	});

	it("accepts text of exactly 256 KiB that compresses under the cap", async () => {
		const text = "a".repeat(MAX_TEXT_BYTES);
		const payload = await share(text);
		expect(await decodeShareHash(`#${payload}`)).toEqual({
			kind: "text",
			text,
		});
	});
});

describe("opening a hostile or broken fragment", () => {
	const MALFORMED = { kind: "error", reason: "malformed" } as const;
	const TOO_LONG = { kind: "error", reason: "too-long" } as const;

	it("an empty fragment is no Share Link at all", async () => {
		expect(await decodeShareHash("")).toEqual({ kind: "none" });
		expect(await decodeShareHash("#")).toEqual({ kind: "none" });
	});

	it("rejects an oversized payload before decoding it", async () => {
		expect(
			await decodeShareHash(`#1.${"A".repeat(MAX_PAYLOAD_CHARS)}`),
		).toEqual(TOO_LONG);
	});

	it("stops a decompression bomb at 256 KiB of output", async () => {
		const bomb = await deflateRaw(new Uint8Array(8 * 1024 * 1024));
		const payload = `1.${toBase64Url(bomb)}`;
		expect(payload.length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
		const started = performance.now();
		expect(await decodeShareHash(`#${payload}`)).toEqual(TOO_LONG);
		expect(performance.now() - started).toBeLessThan(2000);
	});

	it("rejects output one byte over the text cap", async () => {
		const bytes = new TextEncoder().encode("a".repeat(MAX_TEXT_BYTES + 1));
		const payload = `1.${toBase64Url(await deflateRaw(bytes))}`;
		expect(await decodeShareHash(`#${payload}`)).toEqual(TOO_LONG);
	});

	it.each([
		["characters outside base64url", "#1.abc+def/=="],
		["percent-encoded junk", "#1.%3Cscript%3E"],
		["an impossible base64 length", "#1.A"],
		["an unknown version", "#9.AAAA"],
		["no version", "#AAAA"],
		["markup", "#<img src=x onerror=alert(1)>"],
		[
			"bytes that are not deflate",
			`#1.${toBase64Url(new Uint8Array([255, 255, 255, 255, 255, 255]))}`,
		],
		["an empty payload", "#1."],
	])("rejects %s as malformed", async (_name, hash) => {
		expect(await decodeShareHash(hash)).toEqual(MALFORMED);
	});

	it("rejects a truncated stream as malformed", async () => {
		const full = await deflateRaw(
			new TextEncoder().encode(
				"a sentence that is long enough to cut ".repeat(20),
			),
		);
		const cut = `#1.${toBase64Url(full.subarray(0, Math.floor(full.length / 2)))}`;
		expect(await decodeShareHash(cut)).toEqual(MALFORMED);
	});

	it("rejects bytes that are not UTF-8 as malformed", async () => {
		const bad = await deflateRaw(new Uint8Array([0x66, 0xff, 0xfe, 0x6f]));
		expect(await decodeShareHash(`#1.${toBase64Url(bad)}`)).toEqual(MALFORMED);
	});

	it("rejects a payload that decodes to blank text as malformed", async () => {
		const blank = await deflateRaw(new TextEncoder().encode("   \n "));
		expect(await decodeShareHash(`#1.${toBase64Url(blank)}`)).toEqual(
			MALFORMED,
		);
	});

	it("hands markup back as plain text, never interpreted", async () => {
		const text = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
		const payload = await share(text);
		expect(await decodeShareHash(`#${payload}`)).toEqual({
			kind: "text",
			text,
		});
	});
});

describe("1.x #/read/<b64> links", () => {
	for (const [name, text] of Object.entries(TEXTS)) {
		it(`decodes a 1.x link of ${name} text and re-encodes it as a 2.0 payload`, async () => {
			const result = await decodeShareHash(`#/read/${legacyEncode(text)}`);
			expect(result).toMatchObject({ kind: "legacy", text });
			if (result.kind !== "legacy") return;
			expect(result.payload).toMatch(/^1\./);
			expect(await decodeShareHash(`#${result.payload}`)).toEqual({
				kind: "text",
				text,
			});
		});
	}

	it("decodes a 1.x link whose base64 used - and _", async () => {
		// "??>" encodes to "Pz8-" and "???" to "Pz8_" in base64url.
		const text = "??> and ???";
		const encoded = legacyEncode(text);
		expect(encoded).toMatch(/-/);
		expect(encoded).toMatch(/_/);
		expect(await decodeShareHash(`#/read/${encoded}`)).toMatchObject({
			kind: "legacy",
			text,
		});
	});

	it("rejects malformed 1.x base64", async () => {
		expect(await decodeShareHash("#/read/not*base64!")).toEqual({
			kind: "error",
			reason: "malformed",
		});
		expect(await decodeShareHash("#/read/")).toEqual({
			kind: "error",
			reason: "malformed",
		});
		expect(
			await decodeShareHash(
				`#/read/${Buffer.from([0xff, 0xfe]).toString("base64url")}`,
			),
		).toEqual({ kind: "error", reason: "malformed" });
	});

	it("rejects a 1.x link over 256 KiB of text", async () => {
		const huge = legacyEncode("a".repeat(MAX_TEXT_BYTES + 3));
		expect(await decodeShareHash(`#/read/${huge}`)).toEqual({
			kind: "error",
			reason: "too-long",
		});
	});

	it("opens a long 1.x link even when its 2.0 payload would be over the cap", async () => {
		let seed = 7;
		let text = "";
		for (let i = 0; i < 9000; i++) {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			text += String.fromCharCode(0x4e00 + (seed % 20000));
		}
		const result = await decodeShareHash(`#/read/${legacyEncode(text)}`);
		expect(result).toEqual({ kind: "legacy", text, payload: null });
	});
});

describe("the /s route headers", () => {
	it("sends Referrer-Policy: no-referrer on /s", () => {
		const headers = readFileSync(
			new URL("../static/_headers", import.meta.url),
			"utf8",
		);
		expect(headers).toMatch(
			/^\/s\n(?:[ \t]+.*\n)*?[ \t]+Referrer-Policy: no-referrer$/m,
		);
	});
});
