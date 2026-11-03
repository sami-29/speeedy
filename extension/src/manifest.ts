import { DEV_EXTENSION_KEY } from "@speeedy/contracts/launcher";

export type Target = "chrome" | "edge" | "firefox";

export const TARGETS: readonly Target[] = ["chrome", "edge", "firefox"];

/** The `ref` each store listing and the options page links carry (the store entries of the ref list). */
export const STORE_REF: Record<Target, string> = {
	chrome: "chrome-store",
	edge: "edge-store",
	firefox: "amo",
};

export type Manifest = Record<string, unknown>;

export type ManifestOptions = {
	/** One to four dot-separated numbers, which is what all three stores accept. */
	version: string;
	/** A dev build carries the development key, so its ID is fixed. */
	dev: boolean;
	/**
	 * Only the end-to-end build sets this: Playwright cannot click the toolbar button, so it
	 * needs site access to run what the click would. Never set in a store build.
	 */
	hostPermissions?: readonly string[];
};

/** The add-on ID Firefox needs. It cannot change once a listing exists. */
export const FIREFOX_ADDON_ID = "launcher@speeedy.app";

/** First Firefox with `data_collection_permissions`, which new AMO submissions must declare. */
const FIREFOX_MIN_VERSION = "140.0";

/**
 * Pages of the extension may run their own scripts and styles and nothing else, and may open
 * no network connection: `connect-src 'none'` keeps the "no network calls of its own" promise
 * even if a script is ever changed.
 */
const PAGE_CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self'",
	"img-src 'self'",
	"font-src 'self'",
	"connect-src 'none'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

export function buildManifest(
	target: Target,
	options: ManifestOptions,
): Manifest {
	const manifest: Manifest = {
		manifest_version: 3,
		name: "Speeedy",
		short_name: "Speeedy",
		version: options.version,
		description:
			"Send the page you are reading to Speeedy and read it fast. Nothing leaves your browser except the page you send.",
		icons: {
			"16": "icons/icon-16.png",
			"32": "icons/icon-32.png",
			"48": "icons/icon-48.png",
			"128": "icons/icon-128.png",
		},
		permissions: ["activeTab", "scripting", "contextMenus"],
		action: {
			default_title: "Send this page to Speeedy",
			default_icon: {
				"16": "icons/icon-16.png",
				"32": "icons/icon-32.png",
			},
		},
		options_ui: { page: "options.html", open_in_tab: true },
		content_security_policy: { extension_pages: PAGE_CSP },
		background:
			target === "firefox"
				? { scripts: ["background.js"] }
				: { service_worker: "background.js" },
	};
	if (options.hostPermissions?.length) {
		manifest.host_permissions = [...options.hostPermissions];
	}
	if (target === "firefox") {
		manifest.browser_specific_settings = {
			gecko: {
				id: FIREFOX_ADDON_ID,
				strict_min_version: FIREFOX_MIN_VERSION,
				data_collection_permissions: { required: ["none"] },
			},
		};
	} else if (options.dev) {
		manifest.key = DEV_EXTENSION_KEY;
	}
	return manifest;
}
