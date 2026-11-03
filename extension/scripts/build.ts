// Builds the launcher extension for Chrome, Edge and Firefox into one folder per browser.
//
//   node scripts/build.ts                  development build for http://localhost:5173
//   SPEEEDY_ORIGIN=https://speeedy.app SPEEEDY_RELEASE=1 node scripts/build.ts
//
// SPEEEDY_ORIGIN is the Speeedy site this build sends pages to. A release build leaves the
// development key out of the manifest, so the store assigns the extension its ID.
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import {
	buildManifest,
	STORE_REF,
	TARGETS,
	type Target,
} from "../src/manifest.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "..", "app");

/** The site the app is served from in development (`vite dev`). */
export const DEV_ORIGIN = "http://localhost:5173";

/**
 * The parsers load pdf.js on demand, which esbuild would fold into the extension (megabytes).
 * The launcher only ever reads HTML, so that import is swapped for a stub that is never called.
 */
const withoutPdf: Plugin = {
	name: "without-pdf",
	setup(builder) {
		builder.onResolve({ filter: /\/pdf\/blocks$/ }, (args) => ({
			path: args.path,
			namespace: "without-pdf",
		}));
		builder.onLoad({ filter: /.*/, namespace: "without-pdf" }, () => ({
			contents:
				'export const pdfToBlocks = () => { throw new Error("The launcher does not read PDF."); };',
			loader: "js",
		}));
	},
};

export type BuildOptions = {
	outDir: string;
	/** The Speeedy site this build sends pages to, for example `https://speeedy.app`. */
	origin: string;
	/** Dev builds carry the development key. Release builds leave the ID to the store. */
	dev: boolean;
	targets?: readonly Target[];
	/** A dev build's public key, when it should not use the development key. */
	devKey?: string;
	/** The end-to-end build: site access for these patterns and a hook to start the launcher. */
	e2e?: { hostPermissions: readonly string[] };
};

const ENTRIES = [
	["src/background.ts", "background.js"],
	["src/content.ts", "extract.js"],
	["src/relay.ts", "relay.js"],
] as const;

function cleanOrigin(origin: string, dev: boolean): string {
	const url = new URL(origin);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`SPEEEDY_ORIGIN must be an http(s) address, got ${origin}`);
	}
	if (!dev && (url.protocol !== "https:" || url.hostname === "localhost")) {
		throw new Error(
			"A release build needs the real https site as SPEEEDY_ORIGIN.",
		);
	}
	return url.origin;
}

export async function buildExtension(options: BuildOptions): Promise<void> {
	if (options.e2e && !options.dev) {
		throw new Error("The end-to-end build is a development build.");
	}
	const origin = cleanOrigin(options.origin, options.dev);
	const version = (
		JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
			version: string;
		}
	).version;

	for (const target of options.targets ?? TARGETS) {
		const out = join(options.outDir, target);
		rmSync(out, { recursive: true, force: true });
		mkdirSync(join(out, "icons"), { recursive: true });

		await build({
			entryPoints: Object.fromEntries(
				ENTRIES.map(([source, file]) => [
					file.replace(/\.js$/, ""),
					join(root, source),
				]),
			),
			outdir: out,
			bundle: true,
			plugins: [withoutPdf],
			format: "iife",
			platform: "browser",
			target: target === "firefox" ? "firefox140" : "chrome120",
			define: {
				__SPEEEDY_ORIGIN__: JSON.stringify(origin),
				__SPEEEDY_E2E__: JSON.stringify(Boolean(options.e2e)),
			},
			logLevel: "warning",
		});

		const manifest = buildManifest(target, {
			version,
			dev: options.dev,
			key: options.devKey,
			hostPermissions: options.e2e?.hostPermissions,
		});
		writeFileSync(
			join(out, "manifest.json"),
			`${JSON.stringify(manifest, null, "\t")}\n`,
		);

		for (const page of ["relay.html", "options.html"]) {
			const html = readFileSync(join(root, "static", page), "utf8")
				.replaceAll("__ORIGIN__", origin)
				.replaceAll("__REF__", STORE_REF[target]);
			writeFileSync(join(out, page), html);
		}
		cpSync(join(root, "static", "page.css"), join(out, "page.css"));
		cpSync(
			join(app, "static", "fonts", "archivo-wdth.woff2"),
			join(out, "archivo-wdth.woff2"),
		);
		cpSync(join(app, "static", "fonts", "OFL.txt"), join(out, "OFL.txt"));
		// Apache-2.0 asks for the licence text to travel with the bundled code.
		cpSync(
			join(root, "node_modules", "@mozilla", "readability", "LICENSE.md"),
			join(out, "Readability-LICENSE.md"),
		);
		for (const size of [16, 32, 48, 128]) {
			cpSync(
				join(app, "brand", "generated", "extension", `icon-${size}.png`),
				join(out, "icons", `icon-${size}.png`),
			);
		}
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const release = process.env.SPEEEDY_RELEASE === "1";
	await buildExtension({
		outDir: join(root, "dist"),
		origin: process.env.SPEEEDY_ORIGIN ?? DEV_ORIGIN,
		dev: !release,
	});
	console.log(
		`extension built into ${join(root, "dist")} (${release ? "release" : "dev"})`,
	);
}
