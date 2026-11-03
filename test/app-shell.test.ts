// Repo-shape test for ticket #17 (app shell and design system). It asserts the app package,
// design tokens, self-hosted font, noindex rules and the mark's raster set without building,
// so it runs fast and offline. Run with: node --test test/app-shell.test.ts
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const has = (path: string) => existsSync(join(root, path));
const pkg = () =>
	JSON.parse(read("app/package.json")) as {
		scripts: Record<string, string>;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};

// PNG width and height live in the IHDR chunk at bytes 16 to 24.
const pngSize = (path: string) => {
	const bytes = readFileSync(join(root, path));
	assert.equal(bytes.subarray(1, 4).toString(), "PNG", `${path} is a PNG`);
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe("SvelteKit app package", () => {
	it("has build, lint, typecheck, unit and e2e scripts", () => {
		for (const script of ["build", "lint", "typecheck", "test:unit", "e2e"]) {
			assert.ok(pkg().scripts[script], `app script ${script}`);
		}
	});

	it("uses Svelte 5, SvelteKit, adapter-static, Tailwind v4 and Paraglide", () => {
		const deps = { ...pkg().dependencies, ...pkg().devDependencies };
		for (const dep of [
			"svelte",
			"@sveltejs/kit",
			"@sveltejs/adapter-static",
			"@sveltejs/vite-plugin-svelte",
			"tailwindcss",
			"@tailwindcss/vite",
			"@inlang/paraglide-js",
			"@playwright/test",
			"@axe-core/playwright",
			"vitest",
			"svelte-check",
		]) {
			assert.ok(deps[dep], dep);
		}
		assert.match(deps.svelte ?? "", /^5\./);
	});

	it("uses the adapter-static, Tailwind and Paraglide Vite plugins, with no cookie strategy", () => {
		const vite = read("app/vite.config.ts");
		assert.match(vite, /adapter-static/);
		assert.match(vite, /tailwindcss\(\)/);
		assert.match(vite, /paraglideVitePlugin/);
		assert.match(vite, /strategy:\s*\["url",\s*"baseLocale"\]/);
		assert.doesNotMatch(vite, /cookie/);
	});

	it("compiles app code in runes mode and lints for Svelte 4 syntax", () => {
		assert.match(read("app/vite.config.ts"), /runes:\s*true/);
		assert.ok(has("app/scripts/lint-runes.ts"));
		assert.match(pkg().scripts.lint ?? "", /lint-runes/);
		assert.match(
			(JSON.parse(read("package.json")) as { scripts: Record<string, string> })
				.scripts.lint ?? "",
			/pnpm -r --if-present lint/,
		);
	});
});

describe("routes", () => {
	it("prerenders public routes and keeps app routes client-only", () => {
		assert.match(read("app/src/routes/+layout.ts"), /prerender = true/);
		assert.ok(has("app/src/routes/+page.svelte"));
		assert.match(read("app/src/routes/(app)/+layout.ts"), /ssr = false/);
		for (const route of ["reader", "library", "stats", "training", "s"]) {
			assert.ok(
				has(`app/src/routes/(app)/${route}/+page.svelte`),
				`${route} shell`,
			);
		}
		assert.ok(has("app/src/routes/(app)/account/+page.svelte"));
	});
});

describe("design tokens", () => {
	const css = () => read("app/src/app.css");

	it("declares the Swiss Reading Poster colours in @theme", () => {
		assert.match(css(), /@theme/);
		for (const token of [
			"--color-paper: #eff1f1",
			"--color-ink: #111111",
			"--color-red: #d12d16",
			"--color-night-paper: #111314",
			"--color-night-red: #ff5a3c",
		]) {
			assert.ok(css().includes(token), token);
		}
	});

	it("has no radii or shadows", () => {
		assert.match(css(), /--radius-\*:\s*initial/);
		assert.match(css(), /--shadow-\*:\s*initial/);
	});

	it("switches Paper and Night with data-theme and respects reduced motion", () => {
		assert.match(css(), /\[data-theme="night"\]/);
		assert.match(css(), /prefers-reduced-motion:\s*reduce/);
	});

	it("self-hosts Archivo and never imports Google Fonts", () => {
		assert.match(css(), /@font-face/);
		assert.match(css(), /\/fonts\/archivo-wdth\.woff2/);
		assert.doesNotMatch(css(), /googleapis|gstatic/);
		assert.equal(
			readFileSync(join(root, "app/static/fonts/archivo-wdth.woff2"))
				.subarray(0, 4)
				.toString(),
			"wOF2",
		);
		assert.match(
			read("app/static/fonts/OFL.txt"),
			/SIL OPEN FONT LICENSE Version 1\.1/,
		);
	});
});

describe("Paraglide", () => {
	it("ships English only under project.inlang", () => {
		const settings = JSON.parse(read("app/project.inlang/settings.json")) as {
			baseLocale: string;
			locales: string[];
		};
		assert.equal(settings.baseLocale, "en");
		assert.deepEqual(settings.locales, ["en"]);
		assert.ok(has("app/messages/en.json"));
	});
});

describe("noindex", () => {
	const blocks = () => read("app/static/_headers").split(/\n(?=\S)/);

	it("moves the _headers file into the app's static output", () => {
		assert.equal(has("app/public/_headers"), false);
		assert.ok(has("app/static/_headers"));
	});

	it("marks every app route noindex and leaves the production landing indexable", () => {
		const noindexPaths = blocks()
			.filter((block) => /X-Robots-Tag: noindex/.test(block))
			.map((block) => block.split("\n")[0]);
		for (const path of [
			"/reader",
			"/library",
			"/stats",
			"/training",
			"/s",
			"/account/*",
		]) {
			assert.ok(noindexPaths.includes(path), `${path} has a noindex rule`);
		}
		assert.ok(!noindexPaths.includes("/"));
		assert.ok(!noindexPaths.includes("/*"));
	});

	it("keeps the preview-host noindex rule", () => {
		assert.ok(
			blocks().some((block) =>
				/^https:\/\/\*\.speeedy\.pages\.dev\/\*\n\s+X-Robots-Tag: noindex/.test(
					block,
				),
			),
		);
	});

	it("does not block app routes in robots", () => {
		if (has("app/static/robots.txt")) {
			assert.doesNotMatch(
				read("app/static/robots.txt"),
				/Disallow: \/(reader|library|stats|training|s|account)/,
			);
		}
	});
});

describe("mark masters and raster set", () => {
	it("tracks the ten SVG masters", () => {
		assert.deepEqual(readdirSync(join(root, "app/brand/masters")).sort(), [
			"adaptive-background.svg",
			"adaptive-foreground.svg",
			"adaptive-monochrome.svg",
			"icon-16.svg",
			"icon-24.svg",
			"icon-32.svg",
			"icon-48.svg",
			"icon-512.svg",
			"wordmark-night.svg",
			"wordmark.svg",
		]);
	});

	it("has a reproducible generator script wired to a package script", () => {
		assert.ok(has("app/scripts/generate-icons.ts"));
		assert.match(pkg().scripts.icons ?? "", /generate-icons/);
		assert.match(pkg().scripts["icons:check"] ?? "", /generate-icons.*--check/);
	});

	const sizes: Record<string, number[]> = {
		"app/static/icons/favicon-16.png": [16, 16],
		"app/static/icons/favicon-32.png": [32, 32],
		"app/static/icons/favicon-48.png": [48, 48],
		"app/static/apple-touch-icon.png": [180, 180],
		"app/static/icons/icon-192.png": [192, 192],
		"app/static/icons/icon-512.png": [512, 512],
		"app/static/icons/icon-maskable-512.png": [512, 512],
		"app/brand/generated/extension/icon-16.png": [16, 16],
		"app/brand/generated/extension/icon-32.png": [32, 32],
		"app/brand/generated/extension/icon-48.png": [48, 48],
		"app/brand/generated/extension/icon-128.png": [128, 128],
		"app/brand/generated/android/adaptive-background-432.png": [432, 432],
		"app/brand/generated/android/adaptive-foreground-432.png": [432, 432],
		"app/brand/generated/android/adaptive-monochrome-432.png": [432, 432],
	};
	for (const [path, size] of Object.entries(sizes)) {
		it(`generates ${path} at ${size.join("x")}`, () => {
			assert.deepEqual(pngSize(path), size);
		});
	}

	it("ships favicon.svg and favicon.ico", () => {
		assert.match(read("app/static/favicon.svg"), /^<svg/);
		const ico = readFileSync(join(root, "app/static/favicon.ico"));
		assert.equal(ico.readUInt16LE(0), 0);
		assert.equal(ico.readUInt16LE(2), 1);
		assert.equal(ico.readUInt16LE(4), 3);
	});
});

describe("README and CI", () => {
	it("no longer mentions the 1.x analytics script tag", () => {
		const readme = read("README.md");
		assert.doesNotMatch(readme, /Umami/);
		assert.doesNotMatch(readme, /index\.html/);
	});

	it("runs the Playwright e2e and axe smoke test in CI", () => {
		const ci = read(".github/workflows/ci.yml");
		assert.match(ci, /playwright install/);
		assert.match(ci, /pnpm e2e/);
		assert.doesNotMatch(ci, /Placeholder until the app exists/);
	});
});
