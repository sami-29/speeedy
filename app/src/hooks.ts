import type { Reroute } from "@sveltejs/kit/hooks";
import { deLocalizeUrl } from "#lib/paraglide/runtime.js";

// Strips a future `/<lang>/` prefix so `/de/reader` resolves to the `/reader` route.
export const reroute: Reroute = (request) =>
	deLocalizeUrl(request.url).pathname;
