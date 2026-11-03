// `/account/*` has no fixed list of URLs (sign-in, delete, email change), so these are not
// prerendered. The host serves 200.html for them; see static/_redirects.
export const prerender = false;
