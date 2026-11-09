import { describe, expect, it } from "vitest";
import { cacheKeyFor, routeFor } from "../src/lib/pwa/route.ts";

const ORIGIN = "https://speeedy.test";
const precached = new Set([
	"/",
	"/reader",
	"/library",
	"/account/offline",
	"/_app/immutable/entry/app.AAAAAAAA.js",
	"/fonts/archivo-wdth.woff2",
]);

const route = (
	url: string,
	over: { method?: string; mode?: string; origin?: string } = {},
) =>
	routeFor(
		{ method: "GET", mode: "no-cors", ...over, url: new URL(url, ORIGIN).href },
		{ origin: over.origin ?? ORIGIN, precached },
	);

describe("cacheKeyFor", () => {
	it("keys a page by its path, without query, fragment or trailing slash", () => {
		expect(cacheKeyFor(new URL("/reader?text=hi#top", ORIGIN))).toBe("/reader");
		expect(cacheKeyFor(new URL("/reader/", ORIGIN))).toBe("/reader");
		expect(cacheKeyFor(new URL("/", ORIGIN))).toBe("/");
	});
});

describe("routeFor", () => {
	it("serves a precached file from the cache", () => {
		expect(route("/_app/immutable/entry/app.AAAAAAAA.js")).toBe("precache");
		expect(route("/fonts/archivo-wdth.woff2")).toBe("precache");
	});

	it("serves a shell page navigation from the cache, whatever its query", () => {
		expect(route("/reader?title=A&text=B", { mode: "navigate" })).toBe(
			"precache",
		);
		expect(route("/", { mode: "navigate" })).toBe("precache");
	});

	it("tries the network first for any other page, then falls back to the shell", () => {
		expect(route("/learn", { mode: "navigate" })).toBe("page");
		expect(route("/account/billing", { mode: "navigate" })).toBe("page");
	});

	it("leaves everything else to the network: other files, other origins, other methods", () => {
		expect(route("/_app/immutable/workers/chunks/IIIIIIII.js")).toBe("network");
		expect(
			route("/_app/immutable/workers/assets/pdf.worker.min-KKKKKKKK.mjs"),
		).toBe("network");
		expect(route("/_app/version.json")).toBe("network");
		expect(route("https://huggingface.co/model.onnx", { origin: ORIGIN })).toBe(
			"network",
		);
		expect(route("/reader", { method: "POST", mode: "navigate" })).toBe(
			"network",
		);
	});
});

describe("routeFor: the on-device voice", () => {
	it("serves the voice's worker and runtime from the voice's own cache, offline too", () => {
		expect(route("/_app/immutable/workers/kokoro.worker-BuIIhfUY.js")).toBe(
			"voice",
		);
		expect(
			route(
				"/_app/immutable/workers/assets/ort-wasm-simd-threaded-qh98TCA_.wasm",
			),
		).toBe("voice");
	});

	it("leaves other workers, other origins and other methods alone", () => {
		expect(route("/_app/immutable/workers/parser.worker-AAAAAAAA.js")).toBe(
			"network",
		);
		expect(route("https://huggingface.co/x/onnx/model.onnx")).toBe("network");
		expect(
			route("/_app/immutable/workers/kokoro.worker-BuIIhfUY.js", {
				method: "POST",
			}),
		).toBe("network");
	});
});
