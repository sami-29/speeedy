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
	{ path: "/pdf-speed-reader", lastmod: "2026-11-03" },
	{ path: "/epub-speed-reader", lastmod: "2026-11-03" },
	{ path: "/adhd-reading-tool", lastmod: "2026-11-03" },
	{ path: "/text-to-speech-reader", lastmod: "2026-11-03" },
	{ path: "/spreeder-alternative", lastmod: "2026-11-03" },
	{ path: "/learn", lastmod: "2026-11-03" },
	{ path: "/learn/how-to-read-faster", lastmod: "2026-11-03" },
	{ path: "/learn/what-is-rsvp", lastmod: "2026-11-03" },
	{ path: "/learn/average-reading-speed", lastmod: "2026-11-03" },
	{ path: "/privacy", lastmod: "2026-11-04" },
	{ path: "/privacy/events", lastmod: "2026-11-04" },
	{ path: "/terms", lastmod: "2026-11-04" },
];
