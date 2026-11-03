import { defineConfig } from "vitest/config";

// Unit tests are plain TypeScript, so they skip the SvelteKit plugin. Components are covered
// by the Playwright e2e run against the built site.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts", "src/**/*.test.ts"],
		environment: "node",
	},
});
