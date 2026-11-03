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
				},
			},
		}),
	],
	test: {
		setupFiles: ["./test/setup.ts"],
	},
});
