import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourcemapPlan } from "../scripts/sourcemaps-plan.ts";

const CREDENTIALS = {
	POSTHOG_CLI_API_KEY: "phx_test_key_do_not_use",
	POSTHOG_CLI_PROJECT_ID: "123",
};

describe("sourcemapPlan", () => {
	it("skips, with a reason, when there are no credentials", () => {
		const plan = sourcemapPlan({});
		expect(plan.run).toBe(false);
		if (!plan.run) expect(plan.reason).toMatch(/POSTHOG_CLI_API_KEY/);
	});

	it("skips when only one of the two credentials is set", () => {
		expect(sourcemapPlan({ POSTHOG_CLI_API_KEY: "k" }).run).toBe(false);
		expect(sourcemapPlan({ POSTHOG_CLI_PROJECT_ID: "1" }).run).toBe(false);
	});

	it("skips on empty or blank values, as a CI secret that is not set arrives", () => {
		expect(
			sourcemapPlan({ POSTHOG_CLI_API_KEY: "", POSTHOG_CLI_PROJECT_ID: "" })
				.run,
		).toBe(false);
		expect(
			sourcemapPlan({ POSTHOG_CLI_API_KEY: "  ", POSTHOG_CLI_PROJECT_ID: "1" })
				.run,
		).toBe(false);
	});

	it("injects, then uploads with the source maps deleted afterwards", () => {
		const plan = sourcemapPlan({
			...CREDENTIALS,
			POSTHOG_RELEASE_VERSION: "abc123",
		});
		expect(plan.run).toBe(true);
		if (!plan.run) return;
		expect(plan.commands).toHaveLength(2);
		const [inject, upload] = plan.commands;
		expect(inject.slice(0, 3)).toEqual(["posthog-cli", "sourcemap", "inject"]);
		expect(inject).toContain("--directory");
		expect(upload.slice(0, 3)).toEqual(["posthog-cli", "sourcemap", "upload"]);
		expect(upload).toContain("--delete-after");
		expect(upload).toContain("abc123");
		expect(upload).not.toContain("--dry-run");
	});

	it("never puts the key on a command line", () => {
		const plan = sourcemapPlan(CREDENTIALS);
		expect(JSON.stringify(plan)).not.toContain(CREDENTIALS.POSTHOG_CLI_API_KEY);
	});

	it("names the host explicitly, defaulting to the US app host", () => {
		const plan = sourcemapPlan(CREDENTIALS);
		expect(plan.run && plan.env.POSTHOG_CLI_HOST).toBe(
			"https://us.posthog.com",
		);
		const eu = sourcemapPlan({
			...CREDENTIALS,
			POSTHOG_CLI_HOST: "https://eu.posthog.com",
		});
		expect(eu.run && eu.env.POSTHOG_CLI_HOST).toBe("https://eu.posthog.com");
	});

	it("builds with source maps only when it will upload them, so none is ever published", () => {
		expect(sourcemapPlan({}).buildSourcemap).toBe(false);
		expect(sourcemapPlan(CREDENTIALS).buildSourcemap).toBe("hidden");
	});
});

describe("the build step without credentials", () => {
	it("exits cleanly and logs that it skipped", () => {
		const script = fileURLToPath(
			new URL("../scripts/upload-sourcemaps.ts", import.meta.url),
		);
		const env = { ...process.env };
		delete env.POSTHOG_CLI_API_KEY;
		delete env.POSTHOG_CLI_PROJECT_ID;
		const result = spawnSync(process.execPath, [script], {
			env,
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/skipping source map upload/i);
	});
});
