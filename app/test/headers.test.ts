import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { headersFor, parseHeaders } from "../scripts/static-headers.ts";

const rules = parseHeaders(
	readFileSync(join(import.meta.dirname, "../static/_headers"), "utf8"),
);
const at = (path: string) =>
	Object.fromEntries(
		Object.entries(headersFor(rules, path)).map(([k, v]) => [k.toLowerCase(), v]),
	);

describe("cross-origin isolation headers", () => {
	it("isolates /reader and the pages under it, for threaded WASM", () => {
		for (const path of ["/reader", "/reader/voice-lab"]) {
			expect(at(path)["cross-origin-opener-policy"], path).toBe("same-origin");
			expect(at(path)["cross-origin-embedder-policy"], path).toBe("credentialless");
		}
	});

	it("leaves every other page alone, so handoff, checkout return and sharing keep their opener", () => {
		for (const path of [
			"/",
			"/library",
			"/stats",
			"/training",
			"/s",
			"/s/abc",
			"/account",
			"/account/checkout/return",
			"/handoff",
			"/readers",
		]) {
			expect(at(path)["cross-origin-opener-policy"], path).toBeUndefined();
			expect(at(path)["cross-origin-embedder-policy"], path).toBeUndefined();
		}
	});

	it("keeps the noindex rule for app routes", () => {
		expect(at("/reader")["x-robots-tag"]).toBe("noindex");
		expect(at("/account/x")["x-robots-tag"]).toBe("noindex");
		expect(at("/")["x-robots-tag"]).toBeUndefined();
	});
});

describe("parseHeaders", () => {
	it("reads Cloudflare's _headers format: exact paths, splats and comments", () => {
		const parsed = parseHeaders(
			"# comment\n/a\n  X-One: 1\n/b/*\n  X-Two: 2\n  X-Three: 3\nhttps://*.x.dev/*\n  X-Host: h\n",
		);
		expect(headersFor(parsed, "/a")).toEqual({ "X-One": "1" });
		expect(headersFor(parsed, "/a/b")).toEqual({});
		expect(headersFor(parsed, "/b/c/d")).toEqual({ "X-Two": "2", "X-Three": "3" });
		// Host rules never match a bare path.
		expect(headersFor(parsed, "/")).toEqual({});
	});
});
