import { VOICE_FILES } from "./precache.ts";

/** How the service worker answers one request. */
export type Route =
	/** From the precache; the network is only a fallback. */
	| "precache"
	/** The on-device voice's worker or runtime: from the voice's own cache, else the network. */
	| "voice"
	/** A page the precache does not hold: the network, then the cached fallback page. */
	| "page"
	/** Not the service worker's business: the browser handles it as if there were none. */
	| "network";

export type RoutedRequest = { method: string; mode: string; url: string };

/** The key a page or file has in the precache: its path, with no query, fragment or trailing slash. */
export function cacheKeyFor(url: URL): string {
	const path = url.pathname.replace(/(.)\/+$/, "$1");
	return path === "" ? "/" : path;
}

export function routeFor(
	request: RoutedRequest,
	context: { origin: string; precached: ReadonlySet<string> },
): Route {
	if (request.method !== "GET") return "network";
	const url = new URL(request.url);
	if (url.origin !== context.origin) return "network";
	if (context.precached.has(cacheKeyFor(url))) return "precache";
	if (VOICE_FILES.test(url.pathname)) return "voice";
	// Anything else that is not a page (a PDF chunk, `version.json`) is never cached here, so
	// it always comes from the network.
	return request.mode === "navigate" ? "page" : "network";
}
