// Workspace-shape test for ticket #07. It asserts the repo layout, dependency hygiene,
// CI, licence note and noindex rule without running a build, so it stays fast and offline.
// Run with: node --test test/workspace.test.ts
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const json = (path: string) =>
	JSON.parse(read(path)) as Record<string, unknown>;

const packageDirs = {
	app: "@speeedy/app",
	worker: "@speeedy/worker",
	"packages/engine": "@speeedy/engine",
	"packages/kokoro": "@speeedy/kokoro",
	"packages/parsers": "@speeedy/parsers",
	"packages/contracts": "@speeedy/contracts",
	"packages/sync": "@speeedy/sync",
	extension: "@speeedy/extension",
	twa: "@speeedy/twa",
	"voice-server": "@speeedy/voice-server",
};

describe("clean slate", () => {
	it("keeps no 1.x source, tests, configs or build files at the root", () => {
		const gone = [
			"src",
			"e2e",
			"public",
			"scripts",
			"test-fixtures",
			"index.html",
			"test-content.txt",
			"vite.config.ts",
			"vitest.config.ts",
			"playwright.config.ts",
			"wrangler.toml",
			"tsconfig.tsbuildinfo",
		];
		assert.deepEqual(
			gone.filter((path) => existsSync(join(root, path))),
			[],
		);
	});

	it("keeps the files that carry over", () => {
		for (const path of [
			".github",
			"LICENSE",
			"README.md",
			"CHANGELOG.md",
			".gitignore",
		]) {
			assert.ok(existsSync(join(root, path)), `${path} is missing`);
		}
	});
});

describe("workspace packages", () => {
	it("lists every package in pnpm-workspace.yaml", () => {
		const yaml = read("pnpm-workspace.yaml");
		for (const entry of [
			"app",
			"worker",
			"packages/*",
			"extension",
			"twa",
			"voice-server",
		]) {
			assert.match(
				yaml,
				new RegExp(`^  - ${entry.replace("*", "\\*")}$`, "m"),
				entry,
			);
		}
		assert.deepEqual(readdirSync(join(root, "packages")).sort(), [
			"contracts",
			"engine",
			"kokoro",
			"parsers",
			"sync",
		]);
	});

	for (const [dir, name] of Object.entries(packageDirs)) {
		it(`${dir} is a private package named ${name} with a build script`, () => {
			const pkg = json(`${dir}/package.json`) as {
				name: string;
				private: boolean;
				scripts: Record<string, string>;
			};
			assert.equal(pkg.name, name);
			assert.equal(pkg.private, true);
			assert.ok(pkg.scripts.build, "build script");
		});
	}

	it("gives packages/contracts a typed entry point for shared types", () => {
		assert.ok(existsSync(join(root, "packages/contracts/src/index.ts")));
	});

	it("keeps the Worker runnable from its workspace folder", () => {
		assert.ok(existsSync(join(root, "worker/wrangler.jsonc")));
		assert.ok(existsSync(join(root, "worker/src/index.ts")));
	});
});

describe("dependency hygiene", () => {
	const manifests = [
		"package.json",
		...Object.keys(packageDirs).map((d) => `${d}/package.json`),
	];

	it("uses exact versions in every package.json", () => {
		const loose: string[] = [];
		for (const file of manifests) {
			const pkg = json(file) as Record<
				string,
				Record<string, string> | undefined
			>;
			for (const field of [
				"dependencies",
				"devDependencies",
				"peerDependencies",
			]) {
				for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
					if (!/^(\d+\.\d+\.\d+(-[\w.]+)?|workspace:\*)$/.test(range)) {
						loose.push(`${file} ${dep}@${range}`);
					}
				}
			}
		}
		assert.deepEqual(loose, []);
	});

	it("pins packageManager to one exact pnpm version", () => {
		assert.match(
			String(json("package.json").packageManager),
			/^pnpm@\d+\.\d+\.\d+$/,
		);
	});

	it("allows builds through allowBuilds, not the removed onlyBuiltDependencies", () => {
		const yaml = read("pnpm-workspace.yaml");
		assert.doesNotMatch(yaml, /onlyBuiltDependencies/);
		assert.match(yaml, /^allowBuilds:$/m);
		assert.match(yaml, /^ {2}esbuild: true$/m);
		assert.match(yaml, /^ {2}workerd: true$/m);
	});

	it("waits seven days (10080 minutes) before installing a release", () => {
		assert.match(read("pnpm-workspace.yaml"), /^minimumReleaseAge: 10080$/m);
	});

	it("saves exact versions by default", () => {
		assert.match(read("pnpm-workspace.yaml"), /^saveExact: true$/m);
	});

	it("runs Dependabot weekly with a 7-day cooldown", () => {
		const yaml = read(".github/dependabot.yml");
		assert.match(yaml, /package-ecosystem: "npm"/);
		assert.match(yaml, /interval: "weekly"/);
		assert.match(yaml, /default-days: 7/);
	});
});

describe("CI", () => {
	const ci = () => read(".github/workflows/ci.yml");

	it("runs on pushes and pull requests to 2.0 and main", () => {
		const yaml = ci();
		assert.match(yaml, /push:\n\s+branches: \[main, "2\.0"\]/);
		assert.match(yaml, /pull_request:\n\s+branches: \[main, "2\.0"\]/);
	});

	it("has lint, typecheck, unit, worker and e2e jobs", () => {
		for (const job of ["lint", "typecheck", "unit", "worker", "e2e"]) {
			assert.match(ci(), new RegExp(`^  ${job}:$`, "m"), job);
		}
	});

	it("uses Node 22.22 or newer and the pinned pnpm from packageManager", () => {
		const yaml = ci();
		assert.doesNotMatch(yaml, /node-version: (20|22)$/m);
		assert.match(yaml, /node-version: 22\.22/);
		assert.doesNotMatch(yaml, /version: 10\.30\.3/);
	});

	it("sets a Node floor that every locked package's engines range accepts", () => {
		// Ranges in the lockfile are `>=x`, `^x` or `x`, joined by `||`; versions may be short
		// or end in `.*`.
		const atLeast = (have: number[], want: number[]) => {
			for (let i = 0; i < 3; i++)
				if ((have[i] ?? 0) !== (want[i] ?? 0))
					return (have[i] ?? 0) > (want[i] ?? 0);
			return true;
		};
		const accepts = (range: string, have: number[]) =>
			range.split("||").some((part) => {
				const { op, v } =
					/^\s*(?<op>>=|\^)?\s*v?(?<v>\d+(?:\.\d+)*)(?:\.\*)?\s*$/.exec(part)
						?.groups ?? {};
				assert.ok(v, `cannot read engines range "${range}"`);
				const want = v.split(".").map(Number);
				if (op === "^") return have[0] === want[0] && atLeast(have, want);
				if (op === ">=") return atLeast(have, want);
				return want.every((n, i) => have[i] === n);
			});
		const engines = json("package.json").engines as { node: string };
		const floor = engines.node.replace(/^>=/, "").split(".").map(Number);
		const ranges = [
			...read("pnpm-lock.yaml").matchAll(
				/^ {2}(?<name>\S+):\n(?: {4}.*\n)*? {4}engines: \{node: '?(?<range>[^'}]+)'?\}/gm,
			),
		].map((m) => m.groups as { name: string; range: string });
		assert.ok(
			ranges.length > 100,
			"found too few engines ranges in the lockfile",
		);
		// sharp's 32-bit Windows binary only supports Node 20; Node 22 has no 32-bit Windows
		// build, so it is never installed.
		const refused = ranges
			.filter(({ name }) => !name.startsWith("'@img/sharp-win32-ia32@"))
			.filter(({ range }) => !accepts(range, floor))
			.map(({ name, range }) => `${name} needs ${range}`);
		assert.deepEqual(refused, []);
	});
});

describe("licence and README", () => {
	it("keeps one MIT LICENSE at the root and none below it", () => {
		assert.match(read("LICENSE"), /^MIT License/);
		for (const dir of Object.keys(packageDirs)) {
			assert.equal(existsSync(join(root, dir, "LICENSE")), false, dir);
		}
	});

	it("says the licence excludes the name and logo, and that self-hosting is unsupported", () => {
		const readme = read("README.md");
		assert.match(readme, /does not cover the Speeedy name or logo/i);
		assert.match(readme, /self-hosting is tolerated, not supported/i);
	});
});

describe("noindex on non-main builds", () => {
	const blocks = () => read("app/static/_headers").split(/\n(?=\S)/);

	it("adds X-Robots-Tag: noindex for branch preview hosts", () => {
		const preview = blocks().filter((block) =>
			/^https:\/\/\*\.[\w.-]+\/\*/.test(block),
		);
		assert.ok(preview.length > 0, "a preview-host rule");
		for (const block of preview) {
			assert.match(block, /X-Robots-Tag: noindex/);
		}
	});

	it("never marks the whole production site noindex", () => {
		for (const block of blocks()) {
			const path = block.split("\n")[0] ?? "";
			if (/X-Robots-Tag: noindex/.test(block)) {
				assert.ok(path !== "/" && path !== "/*", `${path} must stay indexable`);
			}
		}
	});
});
