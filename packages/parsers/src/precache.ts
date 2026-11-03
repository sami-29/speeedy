/**
 * The files the build emits for pdf.js: its API chunk (`assets/pdf-<hash>.js`) and its worker
 * (`assets/pdf.worker.min-<hash>.mjs`, with a loader chunk beside it), plus source maps. They
 * are large (about 130 KB and 375 KB gzipped) and only a reader who opens a PDF needs them, so
 * the service worker's precache must leave them out; they are fetched when the first PDF is
 * opened.
 *
 * Match this against each emitted asset path when building the precache list. The hash is
 * the eight characters Vite puts in a file name, so a page module that merely starts with
 * "pdf" (a `pdf-speed-reader` route, say) is not caught.
 */
export const PDF_PRECACHE_EXCLUDE =
	/(?:^|\/)pdf(?:\.worker(?:\.min)?)?-[\w-]{8}\.m?js(?:\.map)?$/;
