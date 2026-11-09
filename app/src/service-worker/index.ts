/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// The offline free core. The worker precaches the app shell and the parsers (see
// `src/lib/pwa/precache.ts` for what is in and out) and answers those requests from the
// cache. It caches nothing else: PDF code goes to the network, so a PDF offline fails the
// way it would in any browser, with a message. The on-device voice's worker and runtime are
// served from the voice's own cache (`VOICE_CACHE`), which the voice fills when the reader
// agrees to its download and which this worker only reads, never fills or deletes.
//
// A new version installs and then waits. It takes over only when the reader chooses to
// switch (the page sends SKIP_WAITING) or when every tab has closed, so a page never loses
// the scripts it was loaded with.
import { version } from "$app/env";
import { assets, immutable, prerendered } from "$app/manifest";
import { self as scope } from "$app/service-worker";
import {
	cacheNameFor,
	FALLBACK_PAGE,
	isStaleCache,
	precacheList,
	VOICE_CACHE,
} from "../lib/pwa/precache.ts";
import { cacheKeyFor, routeFor } from "../lib/pwa/route.ts";
import { SKIP_WAITING } from "../lib/pwa/worker-message.ts";

const cacheName = cacheNameFor(version);
const paths = precacheList({
	immutable: immutable.map((file) => file.path),
	assets: assets.map((file) => file.path),
	prerendered: prerendered.map((file) => file.path),
});
const precached = new Set(paths);

scope.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(cacheName)
			// `reload` skips the HTTP cache, so the precache holds what the server has now.
			// `addAll` is all or nothing: a build that cannot be fully cached never installs.
			.then((cache) =>
				cache.addAll(
					paths.map((path) => new Request(path, { cache: "reload" })),
				),
			),
	);
});

scope.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			for (const name of await caches.keys())
				if (isStaleCache(name, cacheName)) await caches.delete(name);
			// Serve the page that was open when the worker first installed, so the app is
			// offline-ready without a second visit.
			await scope.clients.claim();
		})(),
	);
});

scope.addEventListener("message", (event) => {
	if ((event.data as { type?: unknown } | null)?.type === SKIP_WAITING)
		void scope.skipWaiting();
});

/**
 * A response the browser will accept for a navigation. One that followed a redirect (a host
 * that serves `/reader.html` at `/reader`) is refused for navigations, so it is rebuilt with
 * the same body and headers, which keeps the isolation and `noindex` headers it was cached
 * with.
 */
function usable(response: Response): Response {
	if (!response.redirected) return response;
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

async function fromPrecache(request: Request): Promise<Response> {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(cacheKeyFor(new URL(request.url)), {
		ignoreVary: true,
	});
	return hit ? usable(hit) : fetch(request);
}

/** The voice's worker or runtime, as the voice kept it at download; else the network. */
async function fromVoiceCache(request: Request): Promise<Response> {
	try {
		const cache = await caches.open(VOICE_CACHE);
		const hit = await cache.match(request.url, { ignoreVary: true });
		if (hit) return hit;
	} catch {
		// No cache to read: the network answers as it would without this worker.
	}
	return fetch(request);
}

/** A page the precache does not hold: the network, then the cached fallback page offline. */
async function pageOrFallback(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch (error) {
		const cache = await caches.open(cacheName);
		const fallback = await cache.match(FALLBACK_PAGE, { ignoreVary: true });
		if (fallback) return usable(fallback);
		throw error;
	}
}

scope.addEventListener("fetch", (event) => {
	const route = routeFor(event.request, {
		origin: scope.location.origin,
		precached,
	});
	if (route === "network") return;
	event.respondWith(
		route === "precache"
			? fromPrecache(event.request)
			: route === "voice"
				? fromVoiceCache(event.request)
				: pageOrFallback(event.request),
	);
});
