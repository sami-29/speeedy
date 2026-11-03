// The client-only app routes. They are `noindex`, left out of the sitemap and not blocked in
// robots.txt. The same list appears in src/app.html (pre-paint theme) and static/_headers
// (noindex for URLs the host serves from the fallback page).
export const APP_ROUTES = [
	"/reader",
	"/library",
	"/stats",
	"/training",
	"/s",
	"/account",
] as const;

export const isAppPath = (pathname: string): boolean =>
	APP_ROUTES.some(
		(route) => pathname === route || pathname.startsWith(`${route}/`),
	);
