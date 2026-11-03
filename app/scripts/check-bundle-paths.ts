// Runs after `vite build`: node scripts/check-bundle-paths.ts

import { unexpectedBundleFiles } from "./bundle-paths.ts";
import { BUILD_DIRECTORY } from "./sourcemaps-plan.ts";

const unexpected = unexpectedBundleFiles(BUILD_DIRECTORY);
if (unexpected.length > 0) {
	console.error(
		"These built scripts do not match the bundle name shapes in packages/contracts/src/errors.ts,\nso error reports would show their frames as external:",
	);
	for (const path of unexpected) console.error(`  ${path}`);
	process.exit(1);
}
console.log("bundle names: every built script matches an error-report shape.");
