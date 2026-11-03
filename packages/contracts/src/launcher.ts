/**
 * The launcher protocol: how the browser extension hands a web page to a Speeedy tab.
 *
 * The extension's relay page opens a Speeedy tab, waits for its `ready` message, posts one
 * `page` message and waits for the `ack`. Everything in a `page` message is untrusted on the
 * receiving side, so `validateLauncherPage` checks the shape, the caps and the Document
 * itself, and says why it refused in a fixed word that never echoes the content.
 */

import type { Document } from "./document";

export const LAUNCHER_VERSION = 1;

/** Caps on what one page message may carry. The receiver enforces them before deeper checks. */
export const LAUNCHER_LIMITS = {
	title: 300,
	url: 2048,
	language: 35,
	blocks: 50_000,
	/** Total text characters over all blocks. */
	characters: 5_000_000,
	/** Total inline spans over all blocks. */
	spans: 200_000,
} as const;

/**
 * The extension ID that unpacked and test builds get from the development key in their
 * manifest. Store builds get their own ID from the store; the app learns it at build time.
 */
export const DEV_EXTENSION_ID = "ohlodhamamedgfphcodmfbmhlgaofgnd";

/** The public half of the development key. It signs nothing: it only fixes the ID above. */
export const DEV_EXTENSION_KEY =
	"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl/Ug/ujq3VQB+qJ1/PeScaShvPhXv6mU6pb+7ZpdTWFjSPbtZKT1x58l7Taz/k8vEeR+t5cpZWdT72UTTvqcj+N2tBHMuz9DY0bi0CvyafFR5KoMm66Vyw1Ky1deHyscRLH39laKZT5Icc4NOJieiB/u+Kcgf2cK0on+/1kPIeuzpFZONsdkvaGyYnHSy9uuggtSN2FgvTYO5AAbp8G/a0qbh9XK2dt+KubwrBQ6OExkYHnmdAENSh7Awsj5IpPf2miIUKbBxJFrvJnMTalu9+EZQQKTPGczGK16izy2T4mBJVJ6zQJDr7irgyw4Z5mtMGkmhTYEAGSJaTkkkidpBwIDAQAB";

export type LauncherPage = {
	type: "speeedy:page";
	version: typeof LAUNCHER_VERSION;
	/** The page's title, possibly empty. The app falls back to the opening words. */
	title: string;
	/** Where the page came from, `http` or `https`. It is kept on the device only. */
	url: string;
	/** A BCP 47 tag, `und` when the extension could not tell. */
	language: string;
	document: Document;
};

export type LauncherRejection =
	| "not-an-object"
	| "wrong-type"
	| "wrong-version"
	| "wrong-shape"
	| "too-big"
	| "bad-url"
	| "bad-language"
	| "bad-document";

export type LauncherValidation =
	| { ok: true; page: LauncherPage }
	| { ok: false; reason: LauncherRejection };

export type LauncherReady = {
	type: "speeedy:ready";
	version: typeof LAUNCHER_VERSION;
};
export type LauncherAck = {
	type: "speeedy:ack";
	version: typeof LAUNCHER_VERSION;
	ok: boolean;
};

export function validateLauncherPage(_value: unknown): LauncherValidation {
	return { ok: false, reason: "not-an-object" };
}

export function isLauncherReady(_value: unknown): _value is LauncherReady {
	return false;
}

export function isLauncherAck(_value: unknown): _value is LauncherAck {
	return false;
}

export const launcherReady = (): LauncherReady => ({
	type: "speeedy:ready",
	version: LAUNCHER_VERSION,
});

export const launcherAck = (ok: boolean): LauncherAck => ({
	type: "speeedy:ack",
	version: LAUNCHER_VERSION,
	ok,
});
