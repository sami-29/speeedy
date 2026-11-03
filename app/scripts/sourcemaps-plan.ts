// Decides whether the production build uploads source maps to PostHog, and how.
// Error reports carry stack frames only; PostHog needs the source maps to turn those frames
// back into file names and lines. The upload needs a PostHog personal API key, so it runs
// only when the key and project id are set (a release build on the owner's CI). Everywhere
// else (local builds, pull-request CI) it is skipped and no source map is built or published.

export type Env = Readonly<Record<string, string | undefined>>;

/** The build output the static adapter writes, relative to the app. */
export const BUILD_DIRECTORY = "build";

const RELEASE_NAME = "speeedy";
/** The CLI's own default is the app host; set it explicitly so nothing depends on a default. */
const DEFAULT_HOST = "https://us.posthog.com";

export type SourcemapPlan =
	| { run: false; buildSourcemap: false; reason: string }
	| {
			run: true;
			buildSourcemap: "hidden";
			/** Extra environment for the CLI. The key and project id are already in the environment. */
			env: { POSTHOG_CLI_HOST: string };
			/** Run in order. Each is a program followed by its arguments. */
			commands: string[][];
	  };

function set(value: string | undefined): value is string {
	return typeof value === "string" && value.trim() !== "";
}

export function sourcemapPlan(env: Env): SourcemapPlan {
	if (!set(env.POSTHOG_CLI_API_KEY) || !set(env.POSTHOG_CLI_PROJECT_ID)) {
		return {
			run: false,
			buildSourcemap: false,
			reason: "POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID are not both set",
		};
	}
	const version = set(env.POSTHOG_RELEASE_VERSION)
		? env.POSTHOG_RELEASE_VERSION
		: set(env.GITHUB_SHA)
			? env.GITHUB_SHA
			: "dev";
	return {
		run: true,
		// `hidden` writes the maps without a `sourceMappingURL` comment in the bundles.
		buildSourcemap: "hidden",
		env: {
			POSTHOG_CLI_HOST: set(env.POSTHOG_CLI_HOST)
				? env.POSTHOG_CLI_HOST
				: DEFAULT_HOST,
		},
		commands: [
			["posthog-cli", "sourcemap", "inject", "--directory", BUILD_DIRECTORY],
			[
				"posthog-cli",
				"sourcemap",
				"upload",
				"--directory",
				BUILD_DIRECTORY,
				"--release-name",
				RELEASE_NAME,
				"--release-version",
				version,
				// Delete the maps (and their comments) after upload so none is published.
				"--delete-after",
			],
		],
	};
}
