import { describe, expect, it } from "vitest";
import { PDF_PRECACHE_EXCLUDE } from "../src/index";

describe("PDF_PRECACHE_EXCLUDE", () => {
	it("catches the PDF files of a plain Vite build", () => {
		for (const file of [
			"assets/pdf-C2a4ZsyS.js",
			"assets/pdf.worker-C0scuEUH.js",
			"assets/pdf.worker.min-Dkey6ZUl.mjs",
			"assets/pdf.worker.min-WWY7VKxM.js",
			"assets/pdf-C2a4ZsyS.js.map",
		]) {
			expect(PDF_PRECACHE_EXCLUDE.test(file), file).toBe(true);
		}
	});

	it("catches the PDF files of the SvelteKit build", () => {
		for (const file of [
			"_app/immutable/workers/chunks/C2a4ZsyS.js",
			"_app/immutable/workers/chunks/C7x-RYpg.js",
			"_app/immutable/workers/assets/pdf.worker.min-Dkey6ZUl.mjs",
			"_app/immutable/assets/pdf.worker.min.Dkey6ZUl.mjs",
		]) {
			expect(PDF_PRECACHE_EXCLUDE.test(file), file).toBe(true);
		}
	});

	it("leaves the parser worker and ordinary files alone", () => {
		for (const file of [
			"_app/immutable/workers/worker-CRdd0EIv.js",
			"_app/immutable/nodes/0.AbCdEfGh.js",
			"_app/immutable/nodes/pdf-speed-reader.AbCdEfGh.js",
			"_app/immutable/assets/0.xcIsrfFV.css",
			"assets/index-CZqNLTMa.js",
			"assets/pdf-speed-reader-AbCdEfGh.js",
			"assets/pdf-x.js",
			"pdf.worker.min-Dkey6ZUl.mjs.html",
		]) {
			expect(PDF_PRECACHE_EXCLUDE.test(file), file).toBe(false);
		}
	});
});
