// Which extension origins a build trusts to send a page to the Library, as the value of
// `SPEEEDY_EXTENSION_ORIGINS`. Read by vite.config.ts; see src/lib/launcher/config.ts for the
// list syntax.
import { DEV_EXTENSION_ID } from "@speeedy/contracts/launcher";

/**
 * What `vite dev` trusts when nothing is configured: the development extension, whose public
 * key sits in this repository and whose ID is therefore known to everyone, and Firefox
 * extensions, which the Library asks the reader about.
 */
export const DEV_TRUSTED_ORIGINS = [
	`chrome-extension://${DEV_EXTENSION_ID}`,
	"moz-extension://*",
];

/**
 * A production build trusts nothing unless `SPEEEDY_EXTENSION_ORIGINS` says so, so a build
 * made without the store IDs refuses every extension rather than trusting the development one.
 * An explicit value, even an empty one, always wins.
 */
export function trustedOriginsDefine(
	command: "build" | "serve",
	env: Record<string, string | undefined>,
): string {
	const configured = env.SPEEEDY_EXTENSION_ORIGINS;
	if (configured !== undefined) return configured;
	return command === "serve" ? DEV_TRUSTED_ORIGINS.join(",") : "";
}
