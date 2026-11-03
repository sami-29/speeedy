/**
 * Public routes that other pages already link to but that are built by later tickets (the
 * route table in wayfinder ticket 34). Until a route is built, prerendering would stop on
 * the 404 for a link to it, so the build lets exactly these through. Delete a route from
 * this list when its page lands; a link to any other missing page still fails the build.
 */
export const PLANNED_PUBLIC_ROUTES: readonly string[] = [];

/** The build's answer to a prerender 404: let a planned route through, stop on the rest. */
export function handlePrerenderError(error: {
	status: number;
	path: string;
	message: string;
}): void {
	if (error.status === 404 && PLANNED_PUBLIC_ROUTES.includes(error.path))
		return;
	throw new Error(error.message);
}
