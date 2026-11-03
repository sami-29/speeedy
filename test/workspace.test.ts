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
const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

const packageDirs = {
	app: "@speeedy/app",
	worker: "@speeedy/worker",
	"packages/engine": "@speeedy/engine",
	"packages/parsers": "@speeedy/parsers",
	"packages/contracts": "@speeedy/contracts",
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
			".husky",
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
		for (const path of [".github", "LICENSE", "README.md", "CHANGELOG.md", ".gitignore"]) {
			assert.ok(existsSync(join(root, path)), `${path} is missing`);
		}
	});
});

describe("workspace packages", () => {
	it("lists every package in pnpm-workspace.yaml", () => {
		const yaml = read("pnpm-workspace.yaml");
		for (const entry of ["app", "worker", "packages/*", "extension", "twa", "voice-server"]) {
			assert.match(yaml, new RegExp(`^  - ${entry.replace("*", "\\*")}$`, "m"), entry);
		}
		assert.deepEqual(readdirSync(join(root, "packages")).sort(), [
			"contracts",
			"engine",
			"parsers",
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
	const manifests = ["package.json", ...Object.keys(packageDirs).map((d) => `${d}/package.json`)];

	it("uses exact versions in every package.json", () => {
		const loose: string[] = [];
		for (const file of manifests) {
			const pkg = json(file) as Record<string, Record<string, string> | undefined>;
			for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
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
		assert.match(String(json("package.json").packageManager), /^pnpm@\d+\.\d+\.\d+$/);
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
	it("adds X-Robots-Tag: noindex only for branch preview hosts", () => {
		const blocks = read("app/public/_headers").split(/\n(?=\S)/);
		const noindex = blocks.filter((block) => /X-Robots-Tag: noindex/.test(block));
		assert.ok(noindex.length > 0, "a noindex rule");
		for (const block of noindex) {
			assert.match(block, /^https:\/\/\*\.[\w.-]+\/\*/, "scoped to preview hosts");
		}
	});
});
