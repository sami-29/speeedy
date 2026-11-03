import { DEV_EXTENSION_ID } from "@speeedy/contracts";

/**
 * Which extension origins may send a page, set at build time by `SPEEEDY_EXTENSION_ORIGINS`
 * (a comma-separated list). Without it the app trusts the development extension, which has a
 * fixed ID, and any Firefox extension, because Firefox gives each install a random origin.
 * A release build sets the store IDs.
 */
export const DEFAULT_TRUSTED_ORIGINS: readonly string[] = [
	`chrome-extension://${DEV_EXTENSION_ID}`,
	"moz-extension://*",
];

const CHROMIUM_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

/**
 * Read the configured list. An entry that is not a Chromium extension origin or the Firefox
 * pattern is dropped, so a typo can never trust a website. `undefined` means not configured.
 */
export function parseTrustedOrigins(raw: string | undefined): string[] {
	if (raw === undefined) return [...DEFAULT_TRUSTED_ORIGINS];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(
			(entry) => CHROMIUM_ORIGIN.test(entry) || entry === "moz-extension://*",
		);
}

declare const __SPEEEDY_EXTENSION_ORIGINS__: string | undefined;

/** The list this build trusts. */
export const TRUSTED_ORIGINS: readonly string[] = parseTrustedOrigins(
	typeof __SPEEEDY_EXTENSION_ORIGINS__ === "string"
		? __SPEEEDY_EXTENSION_ORIGINS__
		: undefined,
);
