import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			// Don't inject the manifest — we manage public/manifest.webmanifest ourselves
			manifest: false,
			workbox: {
				// Cache app shell and all static assets
				globPatterns: ["**/*.{js,css,html,svg,woff2}"],
				// Large PDF/DOCX/EPUB chunks are lazy-loaded; cache them separately
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
			},
		}),
	],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("pdfjs-dist")) return "pdf";
					if (id.includes("mammoth")) return "mammoth";
					if (id.includes("jszip")) return "jszip";
					if (id.includes("html-to-image")) return "html-to-image";
					if (id.includes("node_modules/lit") || id.includes("node_modules/@lit")) return "lit";
				},
			},
		},
		chunkSizeWarningLimit: 500,
	},
});
