// Maps a 1.x location hash to its 2.0 address. This file is plain JavaScript on purpose: it is
// unit tested as a module and also inlined, unchanged, into the landing page by ./inline.ts, so
// it must stay self-contained (no imports, no outside names).
//
// The hash is hostile input. Only the routes listed below can come out, so a hash can never
// choose where the reader is sent, and a payload leaves only as `#/read/` plus base64url
// characters, cut to a bounded length.

/**
 * @param {unknown} hash `location.hash`, for example `#/benchmark`.
 * @returns {{ path: string, hash: string } | null} Where to send the reader (`hash` is empty
 * or `#/read/…`), or null when the hash is not a 1.x route and must be left alone.
 */
export function mapLegacyHash(hash) {
	if (typeof hash !== "string" || hash.charAt(0) !== "#") return null;
	// 1.x read `#/app` and `#app` alike. Only the slashed form may fall back to the landing
	// page: a bare `#main` is the skip link and `#faq` an in-page anchor, not 1.x routes.
	const slashed = hash.charAt(1) === "/";
	const rest = hash.slice(slashed ? 2 : 1);

	if (rest.slice(0, 5) === "read/") {
		// One character past the longest 1.x payload the Share Link codec reads (262144 bytes
		// as base64), so /s can still say "too long" for an oversized link.
		const payload = rest.slice(5, 5 + 349528 + 1);
		const valid = payload !== "" && /^[A-Za-z0-9_-]+$/.test(payload);
		return { path: "/s", hash: valid ? `#/read/${payload}` : "#/read/" };
	}
	// A 1.x stats card. Its payload is dropped, never read.
	if (rest.slice(0, 6) === "share/") return { path: "/", hash: "" };

	let path;
	switch (rest) {
		case "app":
		case "profile":
			path = "/library";
			break;
		case "reader":
			path = "/reader";
			break;
		case "stats":
			path = "/stats";
			break;
		case "benchmark":
			path = "/reading-speed-test";
			break;
		case "learn":
			path = "/learn";
			break;
		case "donate":
			path = "/support";
			break;
		case "promote":
			path = "/share-link";
			break;
		case "privacy":
		case "terms":
		case "changelog":
			path = `/${rest}`;
			break;
		default:
			return slashed ? { path: "/", hash: "" } : null;
	}
	return { path: path, hash: "" };
}
