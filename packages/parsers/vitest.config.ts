import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		// Real PDFs go through pdf.js, which takes a while on a busy CI machine.
		testTimeout: 30_000,
	},
});
