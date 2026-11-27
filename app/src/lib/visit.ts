/** Where this Visit runs, and the launch channel that sent the reader, read once on the first pageview. */
export type VisitContext = {
	surface: string;
	ref?: string;
};

export type VisitEnv = {
	/** `location.href` of the first pageview. */
	href: string;
	/** `document.referrer`. */
	referrer: string;
	/** True for an installed app window (display-mode standalone, or iOS `navigator.standalone`). */
	standalone: boolean;
};

/**
 * Reads the Visit's context from the first pageview. `cleanHref` is the address without the
 * `ref` parameter when there was one, for `history.replaceState`; every other parameter and
 * the hash stay.
 */
export function readVisit(_env: VisitEnv): {
	context: VisitContext;
	cleanHref: string | undefined;
} {
	throw new Error("not implemented");
}
