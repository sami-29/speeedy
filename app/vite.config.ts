import { paraglideVitePlugin } from "@inlang/paraglide-js";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { trustedOriginsDefine } from "./scripts/extension-origins.ts";
import { sourcemapPlan } from "./scripts/sourcemaps-plan.ts";
import { staticHeaders } from "./scripts/static-headers.ts";
import { handlePrerenderError } from "./src/lib/seo/planned.ts";

// Which extension origins may send a page to the Library is fixed per build (see
// scripts/extension-origins.ts): a production build trusts none unless SPEEEDY_EXTENSION_ORIGINS
// lists them.
export default defineConfig(({ command }) => ({
	define: {
		__SPEEEDY_EXTENSION_ORIGINS__: JSON.stringify(
			trustedOriginsDefine(command, process.env),
		),
	},
	// Module workers, for two reasons. The parser worker loads pdf.js on demand, and only an ES
	// module worker can split that into chunks of its own; the default format would fold all of
	// pdf.js into the worker file, which every visit downloads. The voice worker bundles
	// onnxruntime-web, which starts its WASM threads from its own `import.meta.url`.
	worker: { format: "es" },
	build: {
		// Source maps are built only when `scripts/upload-sourcemaps.ts` will upload and then
		// delete them, so a local or pull-request build never publishes one.
		sourcemap: sourcemapPlan(process.env).buildSourcemap,
	},
	plugins: [
		tailwindcss(),
		// The locale lives in the URL (English has no prefix, a future locale gets `/<lang>/`)
		// and no strategy stores it, because the privacy promise is no storage before sign-in.
		// A unit test guards the strategy list.
		// Keep `strategy` in step with the `paraglide` script in package.json.
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/lib/paraglide",
			strategy: ["url", "baseLocale"],
		}),
		sveltekit({
			// Public routes prerender. App routes are prerendered as empty client-only shells
			// (see src/routes/(app)); the fallback serves `/account/*`, which has no fixed list.
			adapter: adapter({ fallback: "200.html" }),
			// A link to a public page that a later ticket builds must not stop the build.
			prerender: { handleHttpError: handlePrerenderError },
			// Runes mode for our own code only. A global `runes: true` would also force
			// node_modules, so it is set per file here and checked by `pnpm lint`.
			dynamicCompileOptions: ({ filename }) =>
				filename.includes("/node_modules/") ? undefined : { runes: true },
		}),
		// `static/_headers` on the dev and preview servers too, so e2e sees production headers.
		staticHeaders("./static/_headers"),
	],
	optimizeDeps: { exclude: ["onnxruntime-web"] },
}));
