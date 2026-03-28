import { defineConfig } from "vitest/config";

export default defineConfig({
	oxc: {},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
	},
});
