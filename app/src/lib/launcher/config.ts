/**
 * Which extension origins may send a page, set at build time by `SPEEEDY_EXTENSION_ORIGINS`
 * (see scripts/extension-origins.ts for what each kind of build does when it is unset). A
 * comma-separated list of:
 *
 * - `chrome-extension://<id>`: a Chromium extension whose ID is pinned; its pages are saved
 *   at once.
 * - `moz-extension://*`: any Firefox extension. Firefox gives every install a random origin,
 *   so the sender cannot be pinned and the reader is asked before a page is kept.
 * - `ask:chrome-extension://<id>`: a Chromium ID whose pages the reader is asked about too.
 *
 * Anything else is dropped, so a typo can never trust a website. The default is no one.
 */

const CHROMIUM_ORIGIN = /^(ask:)?chrome-extension:\/\/[a-p]{32}$/;

export function parseTrustedOrigins(raw: string | undefined): string[] {
	if (raw === undefined) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(
			(entry) => CHROMIUM_ORIGIN.test(entry) || entry === "moz-extension://*",
		);
}

declare const __SPEEEDY_EXTENSION_ORIGINS__: string | undefined;

/** The list this build trusts. A build the define did not reach trusts no one. */
export const TRUSTED_ORIGINS: readonly string[] = parseTrustedOrigins(
	typeof __SPEEEDY_EXTENSION_ORIGINS__ === "string"
		? __SPEEEDY_EXTENSION_ORIGINS__
		: undefined,
);
