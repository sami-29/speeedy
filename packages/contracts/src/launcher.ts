/**
 * The launcher protocol: how the browser extension hands a web page to a Speeedy tab.
 *
 * The extension's relay page opens a Speeedy tab, waits for its `ready` message, posts one
 * `page` message and waits for the `ack`. Everything in a `page` message is untrusted on the
 * receiving side, so `validateLauncherPage` checks the shape, the caps and the Document
 * itself, and says why it refused in a fixed word that never echoes the content.
 */

import { type Document, validateDocument } from "./document.ts";

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

export type LauncherLimits = { [K in keyof typeof LAUNCHER_LIMITS]: number };

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

const PAGE_KEYS = ["type", "version", "title", "url", "language", "document"];
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const fail = (reason: LauncherRejection): LauncherValidation => ({
	ok: false,
	reason,
});

/** The scheme a browser would read from a link target, which ignores spaces and controls. */
function linkScheme(href: string): string | null {
	let cleaned = "";
	for (const char of href.length > 200 ? href.slice(0, 200) : href) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 32 || (code >= 127 && code <= 159)) continue;
		if (code === 0x200b || code === 0xfeff || code === 0x2060) continue;
		cleaned += char;
	}
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned.slice(0, 40));
	return scheme?.[1]?.toLowerCase() ?? null;
}

/**
 * The cheap size checks, run before the Document is read deeply: a hostile message must not
 * cost more to refuse than to send. `blocks` is an array whose length is already capped.
 */
function overCaps(blocks: unknown[]): boolean {
	let characters = 0;
	let spans = 0;
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (!isRecord(block)) continue;
		const text = block.kind === "image-placeholder" ? block.alt : block.text;
		if (typeof text === "string") characters += text.length;
		if (Array.isArray(block.spans)) spans += block.spans.length;
		if (
			characters > LAUNCHER_LIMITS.characters ||
			spans > LAUNCHER_LIMITS.spans
		) {
			return true;
		}
	}
	return false;
}

function hasUnsafeLink(document: Document): boolean {
	for (const block of document.blocks) {
		if (block.kind === "image-placeholder") continue;
		for (const span of block.spans) {
			if (span.kind !== "link") continue;
			const scheme = linkScheme(span.href);
			if (scheme !== null && !LINK_SCHEMES.has(scheme)) return true;
		}
	}
	return false;
}

/**
 * Check an unknown value as a launcher page message. Never throws, and answers with a fixed
 * reason that holds none of the message. Anything unexpected, including unknown fields, fails.
 */
export function validateLauncherPage(value: unknown): LauncherValidation {
	try {
		if (!isRecord(value)) return fail("not-an-object");
		if (value.type !== "speeedy:page") return fail("wrong-type");
		if (value.version !== LAUNCHER_VERSION) return fail("wrong-version");
		const keys = Object.keys(value);
		if (
			keys.length !== PAGE_KEYS.length ||
			!keys.every((key) => PAGE_KEYS.includes(key))
		) {
			return fail("wrong-shape");
		}
		const { title, url, language, document } = value;
		if (
			typeof title !== "string" ||
			typeof url !== "string" ||
			typeof language !== "string" ||
			!isRecord(document)
		) {
			return fail("wrong-shape");
		}
		if (
			title.length > LAUNCHER_LIMITS.title ||
			url.length > LAUNCHER_LIMITS.url ||
			language.length > LAUNCHER_LIMITS.language
		) {
			return fail("too-big");
		}
		let address: URL;
		try {
			address = new URL(url);
		} catch {
			return fail("bad-url");
		}
		if (address.protocol !== "http:" && address.protocol !== "https:") {
			return fail("bad-url");
		}
		address.username = "";
		address.password = "";
		if (!LANGUAGE_TAG.test(language)) return fail("bad-language");

		const blocks = document.blocks;
		if (Array.isArray(blocks)) {
			if (blocks.length > LAUNCHER_LIMITS.blocks) return fail("too-big");
			if (overCaps(blocks)) return fail("too-big");
		}
		const checked = validateDocument(document);
		if (!checked.ok) return fail("bad-document");
		if (hasUnsafeLink(checked.document)) return fail("bad-document");

		return {
			ok: true,
			page: {
				type: "speeedy:page",
				version: LAUNCHER_VERSION,
				title,
				url: address.href,
				language,
				document: checked.document,
			},
		};
	} catch {
		return fail("wrong-shape");
	}
}

const isReadyOrAck = (
	value: unknown,
	type: string,
): value is Record<string, unknown> =>
	isRecord(value) && value.type === type && value.version === LAUNCHER_VERSION;

export function isLauncherReady(value: unknown): value is LauncherReady {
	try {
		return (
			isReadyOrAck(value, "speeedy:ready") && Object.keys(value).length === 2
		);
	} catch {
		return false;
	}
}

export function isLauncherAck(value: unknown): value is LauncherAck {
	try {
		return (
			isReadyOrAck(value, "speeedy:ack") &&
			typeof value.ok === "boolean" &&
			Object.keys(value).length === 3
		);
	} catch {
		return false;
	}
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
