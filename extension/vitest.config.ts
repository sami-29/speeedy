import { defineConfig } from "vitest/config";

// Unit tests run in Node. The extraction tests opt in to a DOM with a `@vitest-environment
// jsdom` comment. The Playwright specs in e2e/ run under `pnpm e2e`.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
	},
});
