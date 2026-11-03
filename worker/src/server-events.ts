import {
	checkEvent,
	EVENTS,
	type EventProps,
	type ServerEventName,
	serverEvents,
} from "@speeedy/contracts";
import { PostHog } from "posthog-node";

export interface ServerEvents {
	/** A random id for this request only. It is never an Account ID and is not stored. */
	readonly id: string;
	/**
	 * Sends a registered server event to PostHog after the response, with no person
	 * profile. Returns false, and sends nothing, if the event does not fit the registry.
	 */
	capture<N extends ServerEventName>(event: N, props: EventProps<N>): boolean;
}

/**
 * The Worker's way to send analytics. Call it once per request: the random id it makes
 * ties that request's events together and nothing else. The client event allowlist is not
 * involved; only events the registry marks `server` can be sent here.
 */
export function createServerEvents(
	env: Env,
	ctx: ExecutionContext,
): ServerEvents {
	const id = crypto.randomUUID();
	const allowed = serverEvents(EVENTS);
	let client: PostHog | undefined;

	return {
		id,
		capture(event, props) {
			const checked = checkEvent(allowed, event, props);
			if (!checked.ok || !env.POSTHOG_PROJECT_TOKEN) return false;
			client ??= new PostHog(env.POSTHOG_PROJECT_TOKEN, {
				host: env.POSTHOG_HOST,
				// Isolates are short-lived: send each event now, not on a timer.
				flushAt: 1,
				flushInterval: 0,
				disableGeoip: true,
			});
			ctx.waitUntil(
				client
					.captureImmediate({
						distinctId: id,
						event,
						properties: {
							...checked.properties,
							schema_version: checked.schemaVersion,
							$process_person_profile: false,
						},
						disableGeoip: true,
					})
					.catch(() => {
						// Analytics is best effort; a lost event is not worth an error.
					}),
			);
			return true;
		},
	};
}
