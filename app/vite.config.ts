import { paraglideVitePlugin } from "@inlang/paraglide-js";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
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
			// Runes mode for our own code only. A global `runes: true` would also force
			// node_modules, so it is set per file here and checked by `pnpm lint`.
			dynamicCompileOptions: ({ filename }) =>
				filename.includes("/node_modules/") ? undefined : { runes: true },
		}),
	],
});
