/**
 * The receiving end of the launcher extension. The extension's relay page opens this tab, so
 * `window.opener` is that page; a message counts only when it comes from that window and from
 * a trusted extension origin. Both checks matter: a web page can also open this tab and post
 * to it, but its origin is its own, and a frame or popup of another window is not the opener.
 *
 * What passes both checks is still untrusted data. It goes through `validateLauncherPage`,
 * which enforces the shape, the caps and the Document model, before anything is saved. An
 * untrusted sender gets no reply, so it learns nothing from this tab. One page is taken per
 * load: the extension sends one, and a second would only be a flood.
 */

import {
	isLauncherAck,
	isLauncherReady,
	type LauncherPage,
	launcherAck,
	launcherReady,
	validateLauncherPage,
} from "@speeedy/contracts";

export type Peer = {
	postMessage(message: unknown, targetOrigin: string): void;
};

export type IncomingMessage = {
	data: unknown;
	origin: string;
	source: unknown;
};

/** The slice of `window` the receiver uses, so tests can stand in for it. */
export type LauncherWindow = {
	opener: Peer | null;
	addEventListener(
		type: "message",
		listener: (event: IncomingMessage) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: IncomingMessage) => void,
	): void;
};

/** Firefox gives every install its own random UUID, so its origin can only be matched by shape. */
const FIREFOX_ANY = "moz-extension://*";
const FIREFOX_ORIGIN =
	/^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether `origin` is on the trusted list: an exact `chrome-extension://<id>` entry, or the
 * Firefox pattern `moz-extension://*`, which matches a well-formed Firefox extension origin.
 */
export function isTrustedOrigin(
	origin: string,
	trusted: readonly string[],
): boolean {
	return trusted.some((entry) =>
		entry === FIREFOX_ANY ? FIREFOX_ORIGIN.test(origin) : entry === origin,
	);
}

export type Trust = "auto" | "confirm";

export function trustOf(
	_origin: string,
	_trusted: readonly string[],
): Trust | null {
	return null;
}

export function startLauncherReceiver(options: {
	window: LauncherWindow;
	trusted: readonly string[];
	/** Keep the page. A throw is answered as a refusal. */
	save: (page: LauncherPage) => Promise<void>;
	/** Ask the reader whether to keep a page from a sender that cannot be pinned. */
	confirm?: (page: LauncherPage) => Promise<boolean>;
	/** Runs after the page was kept and acknowledged, for example to open the reader. */
	saved?: () => void;
}): { stop(): void } {
	const { window, trusted, save, saved } = options;
	void options.confirm;
	let taken = false;

	const onMessage = (event: IncomingMessage) => {
		if (taken) return;
		const opener = window.opener;
		if (!opener || event.source !== opener) return;
		if (!isTrustedOrigin(event.origin, trusted)) return;
		// The extension's own handshake messages are not pages, and not worth a refusal.
		if (isLauncherReady(event.data) || isLauncherAck(event.data)) return;

		const reply = (ok: boolean) =>
			opener.postMessage(launcherAck(ok), event.origin);
		const checked = validateLauncherPage(event.data);
		if (!checked.ok) {
			reply(false);
			return;
		}
		taken = true;
		save(checked.page).then(
			() => {
				reply(true);
				saved?.();
			},
			() => {
				taken = false;
				reply(false);
			},
		);
	};

	window.addEventListener("message", onMessage);
	// The opener's origin is unknown here, so the target is `*`. The message holds nothing.
	window.opener?.postMessage(launcherReady(), "*");

	return {
		stop() {
			window.removeEventListener("message", onMessage);
		},
	};
}
