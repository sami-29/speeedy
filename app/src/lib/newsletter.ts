import type { NewsletterPage } from "@speeedy/contracts";

/**
 * Routes that put a reader in front of text. The newsletter form never appears on them, as
 * a footer or as anything else.
 */
export const READING_ROUTES = ["/reader", "/training", "/s"] as const;

/**
 * Pages that carry the full signup block themselves, so the layout leaves its compact
 * footer form off them. Each is a route that does not exist yet; its ticket adds the block.
 */
export const FULL_BLOCK_ROUTES = ["/support", "/about", "/changelog"] as const;

const under = (pathname: string, route: string): boolean =>
	pathname === route || pathname.startsWith(`${route}/`);

/** Whether the layout shows the compact footer form on this path (no locale prefix). */
export const showsFooterForm = (pathname: string): boolean =>
	![...READING_ROUTES, ...FULL_BLOCK_ROUTES].some((route) =>
		under(pathname, route),
	);

/** The `page` value a signup sent from this path carries. Never the path itself. */
export function newsletterPageFor(pathname: string): NewsletterPage {
	if (pathname === "/") return "home";
	for (const page of [
		"library",
		"stats",
		"account",
		"support",
		"about",
		"changelog",
	] as const) {
		if (under(pathname, `/${page}`)) return page;
	}
	return "other";
}

export type SignupResult = "sent" | "rate_limited" | "failed";

/**
 * Posts the signup to the same-origin Worker. The browser never talks to Buttondown, and
 * `credentials: "omit"` keeps any cookie out of the request.
 */
export async function sendSignup(
	signup: {
		email: string;
		building: boolean;
		page: NewsletterPage;
		website: string;
	},
	fetcher: typeof fetch = fetch,
): Promise<SignupResult> {
	try {
		const response = await fetcher("/api/newsletter", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(signup),
			credentials: "omit",
			referrerPolicy: "no-referrer",
		});
		if (response.status === 202) return "sent";
		return response.status === 429 ? "rate_limited" : "failed";
	} catch {
		return "failed";
	}
}
