import {
	type Analytics,
	type ClientEventName,
	createAnalytics,
	type EventProps,
	type Flags,
	injectedFlagConfig,
	installErrorCapture,
	loadFlags,
} from "@speeedy/contracts";

type Telemetry = { flags: Flags; analytics: Analytics };

let started: Promise<Telemetry> | undefined;

/**
 * Starts once per page load: flags first (an injected config wins, which is how the e2e
 * tests switch a flag on), then analytics, so every event carries the active variants.
 */
function start(): Promise<Telemetry> {
	started ??= loadFlags({ override: injectedFlagConfig(globalThis) }).then(
		(flags) => ({
			flags,
			analytics: createAnalytics({ experiments: () => flags.experiments() }),
		}),
	);
	return started;
}

/** The flags for this page load. */
export const appFlags = (): Promise<Flags> => start().then((t) => t.flags);

/** Queues a `$pageview` for a path. Only the route pattern leaves the page. */
export function trackPageview(pathname: string): void {
	void start().then((t) => t.analytics.trackPageview(pathname));
}

/**
 * Reports uncaught errors and unhandled promise rejections as `$exception` events: an error
 * code and stack frames, never the message. Call once from the root layout; the returned
 * function stops it.
 */
export function startErrorCapture(): () => void {
	return installErrorCapture(window, {
		trackError: (error, code) => {
			void start().then((t) => t.analytics.trackError(error, code));
			return true;
		},
	});
}

/** Queues a registered event. Properties are enums and bounded numbers, checked by the registry. */
export function trackEvent<N extends ClientEventName>(
	event: N,
	props: EventProps<N>,
): void {
	void start().then((t) => t.analytics.track(event, props));
}
