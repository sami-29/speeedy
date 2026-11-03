import { defineConfig } from "@playwright/test";

// The extension is loaded unpacked into Chromium and talks to the built app, served the way
// the app's own e2e run serves it. Set PW_PORT to a free port when worktrees run side by side.
const port = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
	testDir: "e2e",
	// One persistent browser profile per test, so tests may run in parallel.
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	// Three browsers load the app at once, so a cold page can take a while.
	expect: { timeout: 15_000 },
	timeout: 60_000,
	use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
	webServer: {
		command: `pnpm --filter @speeedy/app build && pnpm --filter @speeedy/app preview --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		reuseExistingServer: false,
		timeout: 240_000,
	},
});
