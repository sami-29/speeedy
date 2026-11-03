// Licence check: nothing that ships may be GPL-family, and no GPL phonemizer may be installed.
// Kokoro's G2P is a lexicon port so that eSpeak (GPL-3.0) stays out of the bundle.
// Run with: node --test test/licences.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	bannedInLockfile,
	isCopyleft,
	licenceProblems,
	workspacePackageDirs,
} from "./licences.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("isCopyleft", () => {
	it("flags GPL, LGPL and AGPL in any version", () => {
		for (const licence of [
			"GPL-3.0",
			"GPL-2.0-or-later",
			"LGPL-3.0-or-later",
			"AGPL-3.0-only",
			"GPL-3.0+",
		]) {
			assert.equal(isCopyleft(licence), true, licence);
		}
	});

	it("accepts permissive licences, and a dual licence with a permissive choice", () => {
		for (const licence of [
			"MIT",
			"Apache-2.0",
			"BSD-3-Clause",
			"ISC",
			"(MIT OR GPL-3.0)",
			"MIT OR Apache-2.0",
		]) {
			assert.equal(isCopyleft(licence), false, licence);
		}
	});

	it("flags a dual licence whose every choice is copyleft", () => {
		assert.equal(isCopyleft("(GPL-2.0 OR LGPL-3.0)"), true);
	});
});

describe("licenceProblems", () => {
	it("walks production dependencies and reports GPL and banned packages", () => {
		const dir = mkdtempSync(join(tmpdir(), "licences-"));
		const write = (path: string, pkg: object) => {
			mkdirSync(join(dir, path), { recursive: true });
			writeFileSync(join(dir, path, "package.json"), JSON.stringify(pkg));
		};
		write("app", {
			name: "app",
			dependencies: { ok: "1.0.0", bad: "1.0.0" },
			devDependencies: { "dev-only": "1.0.0" },
		});
		write("app/node_modules/ok", {
			name: "ok",
			license: "MIT",
			dependencies: { deep: "1.0.0" },
		});
		write("app/node_modules/deep", { name: "deep", license: "AGPL-3.0" });
		write("app/node_modules/bad", {
			name: "phonemizer",
			license: "Apache-2.0",
		});
		write("app/node_modules/dev-only", {
			name: "dev-only",
			license: "GPL-3.0",
		});
		assert.deepEqual(licenceProblems([join(dir, "app")]).sort(), [
			"deep: AGPL-3.0",
			"phonemizer: banned (GPL phonemizer)",
		]);
	});

	it("finds nothing copyleft or banned in this workspace", () => {
		const dirs = workspacePackageDirs(root);
		assert.ok(dirs.some((dir) => dir.endsWith(join("packages", "kokoro"))));
		assert.deepEqual(licenceProblems(dirs), []);
	});

	it("finds eSpeak, phonemizer and kokoro-js anywhere in a lockfile, dev tools included", () => {
		const lock = [
			"packages:",
			"  /left-pad@1.3.0:",
			"  '@echogarden/espeak-ng-emscripten@0.3.3':",
			"  phonemizer@1.2.1:",
			"  kokoro-js@1.2.0:",
			"  kokoro-jsx@1.0.0:",
		].join("\n");
		assert.deepEqual(bannedInLockfile(lock), [
			"@echogarden/espeak-ng-emscripten",
			"phonemizer",
			"kokoro-js",
		]);
		assert.deepEqual(
			bannedInLockfile(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")),
			[],
		);
	});
});
