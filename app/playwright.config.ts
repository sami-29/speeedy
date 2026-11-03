import { defineConfig, devices } from "@playwright/test";

// The e2e run builds the static site and serves it with `vite preview`, so it tests the
// prerendered output that Cloudflare Pages will serve.
// `PW_PORT` picks the port, so parallel checkouts can run e2e without sharing a server.
const port = Number(process.env.PW_PORT ?? 4173);
const origin = `http://localhost:${port}`;

export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	use: { baseURL: origin, trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		url: origin,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
});
