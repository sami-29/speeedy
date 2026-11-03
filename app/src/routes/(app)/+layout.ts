// App routes are client-only: SvelteKit prerenders an empty shell for each one (the root
// layout turns prerendering on) and the browser does the rest. `src/hooks.server.ts` puts
// `noindex` into those shells, and `static/_headers` adds it for URLs served from the
// fallback page.
export const ssr = false;
