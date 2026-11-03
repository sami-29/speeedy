/**
 * The newsletter's fixed choices. The signup form, the Worker's `/api/newsletter` route and
 * the `newsletter_signup` event all read these lists, so a page or topic cannot drift apart.
 */

/**
 * What the reader signed up for. "Speeedy" is the subscription itself and has no box;
 * "What I'm building" is an unticked box, so `speeedy_building` means they ticked it.
 */
export const NEWSLETTER_TOPICS = ["speeedy", "speeedy_building"] as const;
export type NewsletterTopic = (typeof NEWSLETTER_TOPICS)[number];

/** The page a signup form sat on. Never a URL, so a path or query cannot reach analytics. */
export const NEWSLETTER_PAGES = [
	"home",
	"library",
	"stats",
	"account",
	"support",
	"about",
	"changelog",
	"other",
] as const;
export type NewsletterPage = (typeof NEWSLETTER_PAGES)[number];
