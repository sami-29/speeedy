import { PDF_PRECACHE_EXCLUDE } from "@speeedy/parsers/precache";

/**
 * What the service worker precaches: the offline free core, and nothing else. Every path is
 * named; there is no glob, so a new heavy file in the build is not cached by accident.
 *
 * In: the app pages, their scripts and styles, the parser and Timeline workers, fonts, brand
 * and icons. Out: pdf.js and its worker (`PDF_PRECACHE_EXCLUDE`, fetched when a PDF is first
 * opened), the on-device voice (its worker, the ONNX runtime's WASM, and any model, voice or
 * lexicon file, which have their own opt-in download and cache), source maps and the public
 * pages, which a reader reaches online.
 */

/** The prerendered app pages: the reader's front door and the client-only app routes. */
export const SHELL_PAGES = [
	"/",
	"/reader",
	"/library",
	"/stats",
	"/training",
	"/s",
] as const;

/**
 * SvelteKit's fallback page, which draws any other route in the browser. `static/_redirects`
 * serves it for every `/account/*` address, so this is a URL that returns it on any host
 * (`/200.html` itself is not served the same way everywhere, and the preview server 404s it).
 */
export const FALLBACK_PAGE = "/account/offline";

/**
 * The voice worker and every model-like file, wherever the build puts them. None is
 * precached; the voice's worker and runtime are served from `VOICE_CACHE` instead.
 */
export const VOICE_FILES =
	/(?:^|\/)kokoro\.worker-[\w-]{8}\.m?js$|\.(?:wasm|onnx|bin|ort)$/;

/**
 * The on-device voice's own cache: its model, voice and lexicon, and the runtime (the voice
 * worker and the ONNX runtime's WASM), all filled when the reader agrees to the download. It
 * is not a precache, so no update ever deletes it. The same name as `KOKORO_CACHE`, written
 * out so the service worker does not bundle the voice.
 */
export const VOICE_CACHE = "speeedy-kokoro-v1";
const SOURCE_MAP = /\.map$/;

/** The static files the app shell, the header and the install flow use. */
const STATIC_FILES =
	/^\/(?:fonts\/[\w.-]+\.woff2|brand\/[\w.-]+\.svg|icons\/[\w.-]+\.png|favicon\.(?:svg|ico)|apple-touch-icon\.png|manifest\.webmanifest)$/;

const slashed = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export type BuildFiles = {
	/** Hashed build output under `/_app/immutable`. */
	immutable: readonly string[];
	/** The `static` folder. */
	assets: readonly string[];
	/** Every prerendered page and endpoint. */
	prerendered: readonly string[];
};

/** The paths to precache, sorted and without duplicates. */
export function precacheList(build: BuildFiles): string[] {
	const wanted = new Set<string>();
	for (const path of build.immutable.map(slashed)) {
		if (
			SOURCE_MAP.test(path) ||
			PDF_PRECACHE_EXCLUDE.test(path) ||
			VOICE_FILES.test(path)
		)
			continue;
		wanted.add(path);
	}
	for (const path of build.assets.map(slashed))
		if (STATIC_FILES.test(path)) wanted.add(path);
	// The shell pages are part of the app whether or not the build reported them.
	for (const page of SHELL_PAGES) wanted.add(page);
	wanted.add(FALLBACK_PAGE);
	return [...wanted].sort();
}

const PREFIX = "speeedy-precache-";

/** The cache one build's precache lives in. */
export const cacheNameFor = (version: string): string => `${PREFIX}${version}`;

/**
 * An older build's precache. Only this service worker's own caches count: the on-device
 * voice keeps its model in a cache of its own, which must survive every update.
 */
export const isStaleCache = (name: string, current: string): boolean =>
	name.startsWith(PREFIX) && name !== current;
