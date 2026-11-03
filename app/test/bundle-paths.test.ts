import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unexpectedBundleFiles } from "../scripts/bundle-paths.ts";

const made: string[] = [];

function site(files: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "speeedy-bundle-"));
	made.push(dir);
	for (const file of files) {
		const full = join(dir, file);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, "");
	}
	return dir;
}

afterEach(() => {
	for (const dir of made.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("unexpectedBundleFiles", () => {
	it("accepts every shape the build emits", () => {
		const dir = site([
			"_app/immutable/chunks/Bjy-W4x2.js",
			"_app/immutable/entry/app.CNj6W8l9.js",
			"_app/immutable/entry/start.DSC0Qj7T.js",
			"_app/immutable/entry/payload.DSmR2FwN.js",
			"_app/immutable/nodes/0.B-qekoYf.js",
			"_app/immutable/nodes/10.Bkr0SAZf.js",
			"_app/immutable/workers/worker-Clb-aXNV.js",
			"_app/immutable/workers/chunks/C2a4ZsyS.js",
			"_app/immutable/workers/chunks/C7x-RYpg.js",
			"_app/immutable/workers/assets/pdf.worker.min-Dkey6ZUl.mjs",
			"_app/immutable/assets/pdf.worker.min.Dkey6ZUl.mjs",
			"_app/immutable/assets/0.AbCd1234.css",
			"_app/version.json",
			"index.html",
		]);
		expect(unexpectedBundleFiles(dir)).toEqual([]);
	});

	it("names a script whose name the error reports would not recognise", () => {
		const dir = site([
			"_app/immutable/chunks/Bjy-W4x2.js",
			"_app/immutable/workers/parse.worker-AbCd1234.js",
			"_app/immutable/chunks/AbCd123.js",
			"_app/immutable/entry/other.AbCd1234.js",
		]);
		expect(unexpectedBundleFiles(dir).sort()).toEqual([
			"/_app/immutable/chunks/AbCd123.js",
			"/_app/immutable/entry/other.AbCd1234.js",
			"/_app/immutable/workers/parse.worker-AbCd1234.js",
		]);
	});

	it("rejects a word smuggled into a PDF worker file name", () => {
		const dir = site([
			"_app/immutable/workers/assets/pdf.worker.min-Dkey6ZUl.mjs",
			"_app/immutable/workers/assets/pdf.worker.min-the_cat.mjs",
			"_app/immutable/workers/assets/the_cat.pdf.worker.min-Dkey6ZUl.mjs",
			"_app/immutable/workers/assets/pdf.worker.min-Dkey6ZUl.the_cat.mjs",
			"_app/immutable/assets/pdf.worker.min.the_cat.mjs",
			"_app/immutable/assets/pdf.worker.min.Dkey6ZUl.the_cat.mjs",
			"_app/immutable/workers/chunks/the_cat.AbCd1234.js",
			"_app/immutable/workers/chunks/AbCd1234/the_cat.js",
		]);
		expect(unexpectedBundleFiles(dir).sort()).toEqual([
			"/_app/immutable/assets/pdf.worker.min.Dkey6ZUl.the_cat.mjs",
			"/_app/immutable/assets/pdf.worker.min.the_cat.mjs",
			"/_app/immutable/workers/assets/pdf.worker.min-Dkey6ZUl.the_cat.mjs",
			"/_app/immutable/workers/assets/pdf.worker.min-the_cat.mjs",
			"/_app/immutable/workers/assets/the_cat.pdf.worker.min-Dkey6ZUl.mjs",
			"/_app/immutable/workers/chunks/AbCd1234/the_cat.js",
			"/_app/immutable/workers/chunks/the_cat.AbCd1234.js",
		]);
	});

	it("fails when there is no build output to check", () => {
		expect(() =>
			unexpectedBundleFiles(join(tmpdir(), "speeedy-missing")),
		).toThrow();
	});
});
