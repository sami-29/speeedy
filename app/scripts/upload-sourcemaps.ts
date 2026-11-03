// Runs after `vite build`: injects chunk ids into the built files and uploads their source
// maps to PostHog, then deletes the maps. Skipped, with a log line, when the PostHog
// credentials are not set. See sourcemaps-plan.ts.
//
//   node scripts/upload-sourcemaps.ts
import { spawnSync } from "node:child_process";
import { sourcemapPlan } from "./sourcemaps-plan.ts";

const plan = sourcemapPlan(process.env);

if (!plan.run) {
	console.log(`posthog: skipping source map upload (${plan.reason}).`);
} else {
	for (const [program, ...args] of plan.commands) {
		console.log(`posthog: ${program} ${args.join(" ")}`);
		const result = spawnSync(program, args, {
			stdio: "inherit",
			env: { ...process.env, ...plan.env },
		});
		if (result.error || result.status !== 0) {
			console.error(
				`posthog: ${program} ${args[1]} failed${result.error ? `: ${result.error.message}` : ""}.`,
			);
			process.exit(result.status || 1);
		}
	}
	console.log("posthog: source maps uploaded and removed from the build.");
}
