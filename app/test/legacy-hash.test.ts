import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { mapLegacyHash } from "../src/lib/legacy/hash-map.js";
import {
	LEGACY_HASH_SCRIPT,
	withLegacyScript,
} from "../src/lib/legacy/inline.ts";
import { MAX_TEXT_BYTES } from "../src/lib/share/codec.ts";

// The longest 1.x `#/read/` payload the Share Link codec reads (its own constant is private).
const MAX_LEGACY_CHARS = Math.ceil(MAX_TEXT_BYTES / 3) * 4;

const ROUTES = [
	"/",
	"/library",
	"/reader",
	"/stats",
	"/reading-speed-test",
	"/learn",
	"/support",
	"/share-link",
	"/privacy",
	"/terms",
	"/changelog",
	"/s",
];

describe("mapLegacyHash, the 1.x routes", () => {
	const table: [string, string][] = [
		["#/", "/"],
		["#/app", "/library"],
		["#/profile", "/library"],
		["#/reader", "/reader"],
		["#/stats", "/stats"],
		["#/benchmark", "/reading-speed-test"],
		["#/learn", "/learn"],
		["#/donate", "/support"],
		["#/promote", "/share-link"],
		["#/privacy", "/privacy"],
		["#/terms", "/terms"],
		["#/changelog", "/changelog"],
		// 1.x also read a hash with no slash (`#app`), so those bookmarks work too.
		["#app", "/library"],
		["#profile", "/library"],
		["#reader", "/reader"],
		["#stats", "/stats"],
		["#benchmark", "/reading-speed-test"],
		["#learn", "/learn"],
		["#donate", "/support"],
		["#promote", "/share-link"],
		["#privacy", "/privacy"],
		["#terms", "/terms"],
		["#changelog", "/changelog"],
	];
	for (const [hash, path] of table) {
		it(`${hash} goes to ${path}`, () => {
			expect(mapLegacyHash(hash)).toEqual({ path, hash: "" });
		});
	}
});

describe("mapLegacyHash, unknown 1.x routes", () => {
	for (const hash of [
		"#/nope",
		"#/app/",
		"#//app",
		"#/app?x=1",
		"#/app#x",
		"#/App",
		"#/APP",
		"#/ app",
		"#/%61pp",
		"#/share",
		"#/read",
		"#/javascript:alert(1)",
		"#//evil.example",
		"#/\\evil.example",
		"#/https://evil.example",
		"#/../library",
		`#/${"a".repeat(100_000)}`,
	]) {
		it(`${hash.slice(0, 40)} goes to the landing page`, () => {
			expect(mapLegacyHash(hash)).toEqual({ path: "/", hash: "" });
		});
	}
});

describe("mapLegacyHash, stats cards", () => {
	for (const hash of [
		"#/share/abc",
		"#share/abc",
		"#/share/",
		"#/share/JTdCJTIydGV4dCUyMjE_",
		`#/share/${"A".repeat(500_000)}`,
		'#/share/<img src=x onerror="alert(1)">',
	]) {
		it(`${hash.slice(0, 30)} drops the payload and goes to /`, () => {
			expect(mapLegacyHash(hash)).toEqual({ path: "/", hash: "" });
		});
	}
});

describe("mapLegacyHash, Share Links", () => {
	it("hands a 1.x payload to /s, which decodes it on the device and rewrites it", () => {
		expect(mapLegacyHash("#/read/SGVsbG8gd29ybGQ")).toEqual({
			path: "/s",
			hash: "#/read/SGVsbG8gd29ybGQ",
		});
	});

	it("keeps the - and _ of base64url", () => {
		expect(mapLegacyHash("#/read/a-b_c-d_")).toEqual({
			path: "/s",
			hash: "#/read/a-b_c-d_",
		});
	});

	it("also reads the slash-less form", () => {
		expect(mapLegacyHash("#read/SGVsbG8")).toEqual({
			path: "/s",
			hash: "#/read/SGVsbG8",
		});
	});

	it("passes a payload at the cap unchanged", () => {
		const payload = "A".repeat(MAX_LEGACY_CHARS);
		expect(mapLegacyHash(`#/read/${payload}`)).toEqual({
			path: "/s",
			hash: `#/read/${payload}`,
		});
	});

	it("cuts a longer payload one character past the cap, enough for /s to say too long", () => {
		const out = mapLegacyHash(`#/read/${"A".repeat(MAX_LEGACY_CHARS + 5000)}`);
		expect(out?.path).toBe("/s");
		expect(out?.hash).toBe(`#/read/${"A".repeat(MAX_LEGACY_CHARS + 1)}`);
	});

	for (const [name, hash] of [
		["empty", "#/read/"],
		["markup", '#/read/<img src=x onerror="alert(1)">'],
		["a script tag", "#/read/</script><script>alert(1)</script>"],
		["spaces", "#/read/ab cd"],
		["padding", "#/read/SGVsbG8="],
		["standard base64", "#/read/a+b/c"],
		["percent escapes", "#/read/%41%41"],
		["a newline", "#/read/ab\ncd"],
		["a path escape", "#/read/../../library"],
		["non-ASCII", "#/read/аб"],
	] as const) {
		it(`${name} goes to /s with no payload, so /s says the link is broken`, () => {
			expect(mapLegacyHash(hash)).toEqual({ path: "/s", hash: "#/read/" });
		});
	}
});

describe("mapLegacyHash, hashes that are not 1.x routes", () => {
	for (const hash of [
		"",
		"#",
		"#main",
		"#faq",
		"#foo/bar",
		"#1.abcdef",
		"#readx",
		"#application",
		"#reader/",
		"main",
		"/app",
		"app",
	]) {
		it(`leaves "${hash}" alone`, () => {
			expect(mapLegacyHash(hash)).toBeNull();
		});
	}

	it("returns nothing for input that is not a string", () => {
		for (const value of [
			undefined,
			null,
			42,
			{},
			[],
			{ toString: () => "#/app" },
		]) {
			expect(mapLegacyHash(value as unknown as string)).toBeNull();
		}
	});
});

describe("mapLegacyHash, hostile input", () => {
	it("treats names from Object.prototype as unknown routes and pollutes nothing", () => {
		for (const name of [
			"__proto__",
			"constructor",
			"prototype",
			"toString",
			"valueOf",
			"hasOwnProperty",
			"__defineGetter__",
		]) {
			expect(mapLegacyHash(`#/${name}`), name).toEqual({ path: "/", hash: "" });
			expect(mapLegacyHash(`#${name}`), name).toBeNull();
		}
		expect(Object.getPrototypeOf(mapLegacyHash("#/__proto__"))).toBe(
			Object.prototype,
		);
		expect(({} as Record<string, unknown>).path).toBeUndefined();
		expect(({} as Record<string, unknown>).hash).toBeUndefined();
	});

	it("only ever returns a known internal route and a bounded #/read/ fragment", () => {
		let seed = 11;
		const next = () => {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			return seed;
		};
		const pieces = [
			"#",
			"/",
			"//",
			"app",
			"read/",
			"share/",
			"benchmark",
			"..",
			"\\",
			":",
			"%",
			"<",
			"javascript:",
			"https://x.example",
			"AAAA",
			"-_",
			"\u0000",
			"‮",
			" ",
			"?",
			"&",
		];
		for (let i = 0; i < 4000; i++) {
			let hash = "";
			for (let n = next() % 7; n >= 0; n--) {
				hash += pieces[next() % pieces.length];
			}
			const out = mapLegacyHash(hash);
			if (out === null) continue;
			expect(ROUTES, JSON.stringify(hash)).toContain(out.path);
			if (out.hash !== "") {
				expect(out.path).toBe("/s");
				expect(out.hash).toMatch(/^#\/read\/[A-Za-z0-9_-]*$/);
				expect(out.hash.length).toBeLessThanOrEqual(
					"#/read/".length + MAX_LEGACY_CHARS + 1,
				);
			}
		}
	});

	it("handles a multi-megabyte hash in a blink", () => {
		const started = performance.now();
		mapLegacyHash(`#/read/${"A".repeat(5_000_000)}`);
		mapLegacyHash(`#/read/${"A".repeat(5_000_000)}!`);
		mapLegacyHash(`#/${"A".repeat(5_000_000)}`);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("allows exactly as many characters as the Share Link codec reads", () => {
		expect(MAX_LEGACY_CHARS).toBe(349_528);
	});
});

type Calls = { replace: string[]; replaceState: unknown[][] };

function run(hash: string | (() => string)): {
	calls: Calls;
	dataset: Record<string, string>;
	listeners: Record<string, () => void>;
} {
	const listeners: Record<string, () => void> = {};
	const calls: Calls = { replace: [], replaceState: [] };
	const dataset: Record<string, string> = {};
	const location = {
		get hash() {
			return typeof hash === "function" ? hash() : hash;
		},
		replace: (url: string) => calls.replace.push(url),
	};
	vm.runInNewContext(LEGACY_HASH_SCRIPT, {
		location,
		history: {
			state: null,
			replaceState: (...args: unknown[]) => calls.replaceState.push(args),
		},
		document: { documentElement: { dataset } },
		addEventListener: (type: string, listener: () => void) => {
			listeners[type] = listener;
		},
	});
	return { calls, dataset, listeners };
}

describe("the inline script", () => {
	it("location.replaces a 1.x route and marks the page as going away", () => {
		const { calls, dataset } = run("#/benchmark");
		expect(calls.replace).toEqual(["/reading-speed-test"]);
		expect(calls.replaceState).toEqual([]);
		expect(dataset.legacyRedirect).toBe("1");
	});

	it("location.replaces a 1.x Share Link with its /s form", () => {
		const { calls } = run("#/read/SGVsbG8");
		expect(calls.replace).toEqual(["/s#/read/SGVsbG8"]);
	});

	it("tidies #/ and unknown routes in place instead of reloading the landing page", () => {
		for (const hash of ["#/", "#/nope", "#/share/abc"]) {
			const { calls, dataset } = run(hash);
			expect(calls.replace, hash).toEqual([]);
			expect(calls.replaceState, hash).toEqual([[null, "", "/"]]);
			expect(dataset.legacyRedirect, hash).toBeUndefined();
		}
	});

	it("does nothing for a hash that is not a 1.x route", () => {
		for (const hash of ["", "#main", "#1.abc"]) {
			const { calls, dataset } = run(hash);
			expect(calls.replace).toEqual([]);
			expect(calls.replaceState).toEqual([]);
			expect(dataset).toEqual({});
		}
	});

	it("looks again when only the hash changes in an open landing page", () => {
		let hash = "";
		const { calls, listeners } = run(() => hash);
		expect(calls.replace).toEqual([]);
		hash = "#/learn";
		listeners.hashchange?.();
		expect(calls.replace).toEqual(["/learn"]);
	});

	it("never throws, whatever the browser does", () => {
		expect(() =>
			run(() => {
				throw new Error("blocked");
			}),
		).not.toThrow();
	});

	it("is plain script text that cannot close its own tag", () => {
		expect(LEGACY_HASH_SCRIPT).not.toMatch(/<\/script/i);
		expect(LEGACY_HASH_SCRIPT).not.toMatch(/\bexport\b|\bimport\b/);
		expect(LEGACY_HASH_SCRIPT.length).toBeLessThan(4096);
	});
});

describe("withLegacyScript", () => {
	const html = "<head><meta><!--speeedy-legacy-hash--></head>";

	it("puts the script into the landing page", () => {
		const out = withLegacyScript(html, "/");
		expect(out).toContain(`<script>${LEGACY_HASH_SCRIPT}</script>`);
		expect(out).not.toContain("speeedy-legacy-hash");
	});

	it("leaves every other page without it", () => {
		for (const path of ["/reader", "/library", "/s", "/learn", "/privacy"]) {
			const out = withLegacyScript(html, path);
			expect(out, path).not.toContain("<script>");
			expect(out, path).not.toContain("speeedy-legacy-hash");
		}
	});
});
