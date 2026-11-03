// The public origin that canonical links, share tags, robots.txt and the sitemap point at.
// It is config, not a hard-coded host: set VITE_SITE_ORIGIN at build time (for example for a
// preview or a staging host). With nothing set it is the planned production domain.
export const DEFAULT_SITE_ORIGIN = "https://speeedy.app";

/** Turns a configured value into a bare origin: no trailing slash, no path. */
export function resolveSiteOrigin(value: string | undefined): string {
	if (!value) return DEFAULT_SITE_ORIGIN;
	const url = new URL(value);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`The site origin must be http or https, got "${value}"`);
	}
	return url.origin;
}

const configured = (import.meta.env as Record<string, string | undefined>)
	.VITE_SITE_ORIGIN;

export const SITE_ORIGIN = resolveSiteOrigin(configured);
