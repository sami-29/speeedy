export type PublicPage = {
	/** The route, starting with a slash. */
	path: string;
	/**
	 * The day the page last changed in a way a reader would notice (YYYY-MM-DD). Update it by
	 * hand when the page's content changes; do not stamp it with the build date, because
	 * Google ignores a lastmod that changes when the page did not.
	 */
	lastmod: string;
};

/**
 * Every prerendered public page, and so everything in the sitemap. A page that is not here
 * is not listed, and the e2e run fails when a prerendered page is missing from this list.
 */
export const PUBLIC_PAGES: PublicPage[] = [
	{ path: "/", lastmod: "2026-11-03" },
];
