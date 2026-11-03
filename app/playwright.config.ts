import { defineConfig, devices } from "@playwright/test";
import { DEV_EXTENSION_ID } from "@speeedy/contracts/launcher";

// Parallel worktrees can each run e2e: set PW_PORT to a free port. A busy port fails the run
// loudly instead of testing whatever build another worktree left on it.
const port = Number(process.env.PW_PORT ?? 4173);

// The e2e run builds the static site and serves it with `vite preview`, so it tests the
// prerendered output that Cloudflare Pages will serve.
export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		// A production build trusts no extension unless told which; the e2e build names the
		// development one, as a store build would name its own.
		env: {
			SPEEEDY_EXTENSION_ORIGINS: `chrome-extension://${DEV_EXTENSION_ID}`,
		},
		reuseExistingServer: false,
		timeout: 180_000,
	},
});
