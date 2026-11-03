/**
 * The files the build emits for pdf.js, which the service worker's precache must leave out.
 * They are large (the library is about 130 KB gzipped, its worker about 375 KB) and only a
 * reader who opens a PDF needs them; they are fetched when the first PDF is opened.
 *
 * Two build layouts are covered:
 *
 * - A plain Vite build names them after pdf.js: `assets/pdf-<hash>.js` (the library),
 *   `assets/pdf.worker.min-<hash>.mjs` (its worker) and a loader chunk beside it.
 * - SvelteKit names worker chunks by hash alone, so the library and the PDF code land in
 *   `_app/immutable/workers/chunks/<hash>.js`, and the worker file in `.../workers/assets/`
 *   and `_app/immutable/assets/` (as `pdf.worker.min.<hash>.mjs`). Nothing else is emitted
 *   into those two worker folders, and the parser worker itself is
 *   `_app/immutable/workers/worker-<hash>.js`, which stays precached.
 *
 * The hash is the eight characters the bundler puts in a file name, so a page module that
 * merely starts with "pdf" (a `pdf-speed-reader` route, say) is not caught.
 */
export const PDF_PRECACHE_EXCLUDE =
	/(?:^|\/)pdf(?:\.worker(?:\.min)?)?[.-][\w-]{8}\.m?js(?:\.map)?$|_app\/immutable\/workers\/(?:chunks|assets)\//;
