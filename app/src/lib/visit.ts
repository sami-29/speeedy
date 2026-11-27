import {
	pageviewFor,
	type Ref,
	refFor,
	type Surface,
} from "@speeedy/contracts";

/** Where this Visit runs, and the launch channel that sent the reader, read once on the first pageview. */
export type VisitContext = {
	surface: Surface;
	/** Left out when the first address had no `ref`. */
	ref?: Ref;
};

export type VisitEnv = {
	/** `location.href` of the first pageview. */
	href: string;
	/** `document.referrer`. */
	referrer: string;
	/** True for an installed app window (display-mode standalone, or iOS `navigator.standalone`). */
	standalone: boolean;
};

/** Chrome sets the referrer of a Trusted Web Activity's first load to the Android app. */
const TWA_REFERRER = "android-app://";

function surfaceFor({ href, referrer, standalone }: VisitEnv): Surface {
	if (referrer.startsWith(TWA_REFERRER)) return "twa";
	if (standalone) return "pwa";
	return pageviewFor(href).properties.route === "/s" ? "share-link" : "web";
}

/**
 * Reads the Visit's context from the first pageview. `cleanHref` is the address without the
 * `ref` parameter when there was one, for `history.replaceState`; every other parameter and
 * the hash stay. The raw `ref` value is not kept: only the allowlisted enum is.
 */
export function readVisit(env: VisitEnv): {
	context: VisitContext;
	cleanHref: string | undefined;
} {
	const surface = surfaceFor(env);
	let url: URL;
	try {
		url = new URL(env.href);
	} catch {
		return { context: { surface }, cleanHref: undefined };
	}
	if (!url.searchParams.has("ref")) {
		return { context: { surface }, cleanHref: undefined };
	}
	const ref = refFor(url.searchParams.get("ref"));
	url.searchParams.delete("ref");
	return {
		context: ref === undefined ? { surface } : { surface, ref },
		cleanHref: url.href,
	};
}

/** What the browser says about this page. */
function browserEnv(): VisitEnv {
	const standalone =
		(typeof matchMedia === "function" &&
			matchMedia("(display-mode: standalone)").matches) ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
	return {
		href: location.href,
		referrer: document.referrer,
		standalone,
	};
}

let visit: VisitContext | undefined;

/**
 * The Visit's context. The first call reads it from the page and takes `ref` out of the
 * address; later calls return the same context, held in memory only until the page reloads.
 */
export function visitContext(): VisitContext {
	if (visit) return visit;
	const { context, cleanHref } = readVisit(browserEnv());
	visit = context;
	if (cleanHref) {
		try {
			history.replaceState(history.state, "", cleanHref);
		} catch {
			// The address keeps the parameter; nothing leaves because of it.
		}
	}
	return visit;
}
