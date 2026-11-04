/**
 * The rows of the Privacy Policy's tables. The text of every cell is a message
 * (`privacy_proc_<id>_*`, `privacy_keep_<id>_*`, `privacy_play_<id>_*`); this file holds the
 * structure so a test can check each row has its text and no row is missing.
 */

export type ProcessorId =
	| "cloudflare"
	| "modal"
	| "posthog"
	| "buttondown"
	| "polar";

export interface Processor {
	id: ProcessorId;
	/** The company's name as the row shows it. */
	name: string;
	/**
	 * Where the repository shows Speeedy using this company: a file, and text that file must
	 * contain. A unit test reads each file, so a row cannot outlive the thing it describes.
	 */
	evidence: readonly { file: string; includes: string }[];
}

/**
 * One row per processor, in the order the policy lists them. Stripe is Polar's payment
 * processor and gets no row of its own; the Managed Payments fallback is built but off, and a
 * second row appears only if it is switched on.
 */
export const PROCESSORS: readonly Processor[] = [
	{
		id: "cloudflare",
		name: "Cloudflare",
		evidence: [{ file: "worker/wrangler.jsonc", includes: '"speeedy-worker"' }],
	},
	{
		id: "modal",
		name: "Modal",
		evidence: [
			{ file: "voice-server/package.json", includes: "@speeedy/voice-server" },
		],
	},
	{
		id: "posthog",
		name: "PostHog",
		evidence: [
			{
				file: "worker/wrangler.jsonc",
				includes: '"POSTHOG_HOST": "https://us.i.posthog.com"',
			},
		],
	},
	{
		id: "buttondown",
		name: "Buttondown",
		evidence: [
			{
				file: "worker/wrangler.jsonc",
				includes: '"BUTTONDOWN_HOST": "https://api.buttondown.com"',
			},
		],
	},
	{
		id: "polar",
		name: "Polar",
		evidence: [
			{ file: "packages/contracts/src/plans.ts", includes: "polar: {" },
		],
	},
];

/** How long each kind of data is kept, in the policy's order. */
export const RETENTION_ROWS = [
	"codes",
	"sessions",
	"unpaid",
	"ended",
	"deleted",
	"feedback",
	"newsletter",
	"analytics",
	"payments",
] as const;

/** The Android app's Data safety declarations, in the order the form lists them. */
export const PLAY_ROWS = [
	"email",
	"content",
	"activity",
	"crash",
	"none",
] as const;
