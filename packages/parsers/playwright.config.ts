import { defineConfig, devices } from "@playwright/test";

// The one thing vitest cannot check: pdf.js running inside a real Web Worker, loaded the way
// the production build loads it. The harness is built with Vite and served by `vite preview`.
export default defineConfig({
	testDir: "e2e",
	testMatch: "*.spec.ts",
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	use: { baseURL: "http://localhost:4174", trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command:
			"pnpm exec vite build --config e2e/vite.config.ts && pnpm exec vite preview --config e2e/vite.config.ts",
		url: "http://localhost:4174",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
