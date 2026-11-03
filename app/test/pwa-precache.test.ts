import { describe, expect, it } from "vitest";
import {
	cacheNameFor,
	FALLBACK_PAGE,
	isStaleCache,
	precacheList,
	SHELL_PAGES,
} from "../src/lib/pwa/precache.ts";

// A build as SvelteKit lists it: hashed files under /_app/immutable, the static folder, and
// every prerendered page.
const build = {
	immutable: [
		"/_app/immutable/entry/start.AAAAAAAA.js",
		"/_app/immutable/entry/app.BBBBBBBB.js",
		"/_app/immutable/nodes/0.CCCCCCCC.js",
		"/_app/immutable/chunks/DDDDDDDD.js",
		"/_app/immutable/assets/0.EEEEEEEE.css",
		"/_app/immutable/assets/archivo-wdth.FFFFFFFF.woff2",
		// The parser and Timeline workers: the free core needs them offline.
		"/_app/immutable/workers/worker-GGGGGGGG.js",
		"/_app/immutable/workers/worker-HHHHHHHH.js",
		// pdf.js and its worker: only a reader who opens a PDF needs them.
		"/_app/immutable/workers/chunks/IIIIIIII.js",
		"/_app/immutable/workers/chunks/JJJJJJJJ.js",
		"/_app/immutable/workers/assets/pdf.worker.min-KKKKKKKK.mjs",
		"/_app/immutable/assets/pdf.worker.min.LLLLLLLL.mjs",
		// The on-device voice: its worker and the ONNX runtime's WASM.
		"/_app/immutable/workers/kokoro.worker-MMMMMMMM.js",
		"/_app/immutable/workers/assets/ort-wasm-simd-threaded-NNNNNNNN.wasm",
		"/_app/immutable/assets/model.OOOOOOOO.onnx",
		"/_app/immutable/assets/voice.PPPPPPPP.bin",
		"/_app/immutable/chunks/DDDDDDDD.js.map",
	],
	assets: [
		"/fonts/archivo-wdth.woff2",
		"/fonts/OFL.txt",
		"/brand/wordmark.svg",
		"/brand/wordmark-night.svg",
		"/icons/icon-192.png",
		"/icons/icon-512.png",
		"/icons/icon-maskable-512.png",
		"/icons/favicon-32.png",
		"/favicon.svg",
		"/favicon.ico",
		"/apple-touch-icon.png",
		"/manifest.webmanifest",
		"/og-image.png",
		"/robots.txt",
		"/sitemap.xml",
		"/_headers",
		"/_redirects",
		"/service-worker.js",
	],
	prerendered: [
		"/",
		"/reader",
		"/reader/voice-lab",
		"/library",
		"/stats",
		"/training",
		"/s",
		"/account",
		"/learn",
		"/learn/some-guide",
		"/pdf-speed-reader",
		"/robots.txt",
		"/sitemap.xml",
	],
};

const list = precacheList(build);

describe("precacheList", () => {
	it("holds the app shell: every app page, the fallback page, scripts, styles and fonts", () => {
		for (const page of SHELL_PAGES) expect(list, page).toContain(page);
		expect(list).toContain(FALLBACK_PAGE);
		expect(list).toContain("/_app/immutable/entry/start.AAAAAAAA.js");
		expect(list).toContain("/_app/immutable/entry/app.BBBBBBBB.js");
		expect(list).toContain("/_app/immutable/nodes/0.CCCCCCCC.js");
		expect(list).toContain("/_app/immutable/assets/0.EEEEEEEE.css");
		expect(list).toContain("/fonts/archivo-wdth.woff2");
		expect(list).toContain("/brand/wordmark.svg");
	});

	it("holds the parsers: the parser and Timeline workers", () => {
		expect(list).toContain("/_app/immutable/workers/worker-GGGGGGGG.js");
		expect(list).toContain("/_app/immutable/workers/worker-HHHHHHHH.js");
	});

	it("holds the install assets the manifest names", () => {
		expect(list).toContain("/manifest.webmanifest");
		expect(list).toContain("/icons/icon-192.png");
		expect(list).toContain("/icons/icon-512.png");
		expect(list).toContain("/icons/icon-maskable-512.png");
	});

	it("leaves out pdf.js and its worker", () => {
		for (const path of [
			"/_app/immutable/workers/chunks/IIIIIIII.js",
			"/_app/immutable/workers/chunks/JJJJJJJJ.js",
			"/_app/immutable/workers/assets/pdf.worker.min-KKKKKKKK.mjs",
			"/_app/immutable/assets/pdf.worker.min.LLLLLLLL.mjs",
		])
			expect(list, path).not.toContain(path);
	});

	it("leaves out the voice worker, the runtime WASM and any model or voice file", () => {
		for (const path of [
			"/_app/immutable/workers/kokoro.worker-MMMMMMMM.js",
			"/_app/immutable/workers/assets/ort-wasm-simd-threaded-NNNNNNNN.wasm",
			"/_app/immutable/assets/model.OOOOOOOO.onnx",
			"/_app/immutable/assets/voice.PPPPPPPP.bin",
		])
			expect(list, path).not.toContain(path);
		expect(list.some((path) => /\.(?:wasm|onnx|bin)$/.test(path))).toBe(false);
	});

	it("leaves out source maps, public pages, the voice lab page and files nothing offline needs", () => {
		for (const path of [
			"/_app/immutable/chunks/DDDDDDDD.js.map",
			"/learn",
			"/learn/some-guide",
			"/pdf-speed-reader",
			"/reader/voice-lab",
			"/account",
			"/og-image.png",
			"/robots.txt",
			"/sitemap.xml",
			"/_headers",
			"/_redirects",
			"/fonts/OFL.txt",
			"/service-worker.js",
		])
			expect(list, path).not.toContain(path);
	});

	it("names every file explicitly: no globs, no duplicates", () => {
		expect(list.some((path) => path.includes("*"))).toBe(false);
		expect(new Set(list).size).toBe(list.length);
		expect(list.every((path) => path.startsWith("/"))).toBe(true);
	});

	it("accepts paths without a leading slash, as a build tool may list them", () => {
		const bare = precacheList({
			immutable: ["_app/immutable/entry/start.AAAAAAAA.js"],
			assets: ["fonts/archivo-wdth.woff2"],
			prerendered: ["reader"],
		});
		expect(bare).toContain("/_app/immutable/entry/start.AAAAAAAA.js");
		expect(bare).toContain("/fonts/archivo-wdth.woff2");
		expect(bare).toContain("/reader");
	});

	it("still lists the shell pages when the build did not report them as prerendered", () => {
		const bare = precacheList({ immutable: [], assets: [], prerendered: [] });
		expect(bare).toEqual(expect.arrayContaining([...SHELL_PAGES]));
		expect(bare).toContain(FALLBACK_PAGE);
	});
});

describe("cache names", () => {
	it("names the precache after the build version", () => {
		expect(cacheNameFor("123")).toBe("speeedy-precache-123");
	});

	it("treats only older Speeedy precaches as stale", () => {
		const current = cacheNameFor("2");
		expect(isStaleCache(cacheNameFor("1"), current)).toBe(true);
		expect(isStaleCache(current, current)).toBe(false);
		// The on-device voice keeps its own cache; the service worker must never delete it.
		expect(isStaleCache("speeedy-kokoro-v1", current)).toBe(false);
		expect(isStaleCache("workbox-precache-v2", current)).toBe(false);
	});
});
