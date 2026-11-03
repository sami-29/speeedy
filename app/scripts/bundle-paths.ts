// Checks that every script in the built site has a name the error reports recognise.
// A frame whose file is not one of the app's own bundle paths is sent as `external`, so if a
// Vite or SvelteKit update renamed the output, every error would silently lose its frames.
// This fails the build instead.
import { readdirSync } from "node:fs";
import { join } from "node:path";
// errors.ts has no imports, so Node can load it straight from the contracts package.
import { isBundlePath } from "../../packages/contracts/src/errors.ts";

function scripts(dir: string, prefix: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? scripts(join(dir, entry.name), `${prefix}/${entry.name}`)
			: /\.m?js$/.test(entry.name)
				? [`${prefix}/${entry.name}`]
				: [],
	);
}

/** The site paths of built scripts under `_app/immutable` that no bundle shape matches. */
export function unexpectedBundleFiles(buildDirectory: string): string[] {
	// readdirSync throws when the build output is missing, which fails the check.
	return scripts(
		join(buildDirectory, "_app", "immutable"),
		"/_app/immutable",
	).filter((path) => !isBundlePath(path));
}
