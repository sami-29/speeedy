import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				// A fake PostHog host and token: no test ever reaches the real one.
				bindings: {
					POSTHOG_HOST: "https://posthog.test",
					POSTHOG_PROJECT_TOKEN: "phc_test_token",
					BUTTONDOWN_HOST: "https://buttondown.test",
					BUTTONDOWN_API_TOKEN: "bd_test_token",
				},
			},
		}),
	],
	test: {
		// The first request in a file starts posthog-node and the fake network; a busy
		// machine can take longer than the 5 s default.
		testTimeout: 15_000,
		setupFiles: ["./test/setup.ts"],
	},
});
