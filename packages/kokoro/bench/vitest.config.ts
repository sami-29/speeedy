import { defineConfig } from "vitest/config";

// The RTF benchmark runs on its own, never with the unit tests.
export default defineConfig({
	test: {
		environment: "node",
		include: ["bench/rtf.ts"],
		testTimeout: 600_000,
		hookTimeout: 120_000,
	},
});
