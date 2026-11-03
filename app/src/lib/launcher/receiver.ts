import type { LauncherPage } from "@speeedy/contracts";

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

export function isTrustedOrigin(
	_origin: string,
	_trusted: readonly string[],
): boolean {
	return false;
}

export function startLauncherReceiver(_options: {
	window: LauncherWindow;
	trusted: readonly string[];
	save: (page: LauncherPage) => Promise<void>;
}): { stop(): void } {
	return { stop() {} };
}
