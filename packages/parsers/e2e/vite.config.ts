import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Builds the harness page and its parser worker the way the app's build will: the worker is
// an ES module worker, so the PDF code it loads on demand becomes a chunk of its own.
export default defineConfig({
	root: fileURLToPath(new URL("./harness", import.meta.url)),
	worker: { format: "es" },
	build: {
		outDir: fileURLToPath(new URL("./dist", import.meta.url)),
		emptyOutDir: true,
	},
	preview: { port: 4174, strictPort: true },
});
