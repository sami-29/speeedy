import {
	type ClientEventName,
	checkEvent,
	clientEvents,
	EVENTS,
	type EventProps,
	pageviewFor,
} from "./events.ts";

/** The most events the Worker accepts in one request. */
export const MAX_EVENTS_PER_BATCH = 20;

const FLUSH_AFTER_MS = 2000;

export interface AnalyticsOptions {
	/** Where batches go. The Worker's `/api/e`. */
	endpoint?: string;
	fetch?: typeof fetch;
	/** Runs `fn` soon. Defaults to a short timer. */
	schedule?: (fn: () => void) => void;
	randomUUID?: () => string;
	/**
	 * The active flag variants as `exp_<name>` properties, read when an event is queued and
	 * added to it. Pass `flags.experiments`.
	 */
	experiments?: () => Readonly<Record<string, string>>;
}

export interface Analytics {
	/** Random per Visit, held in memory only, new on every reload. */
	readonly visitId: string;
	/** Queues a registered event. Returns false, and sends nothing, if it does not fit the registry. */
	track<N extends ClientEventName>(event: N, props: EventProps<N>): boolean;
	/** Queues a pageview for a location. Only the route pattern is kept. */
	trackPageview(location: string): boolean;
	/** Sends what is queued now. Never throws. */
	flush(): Promise<void>;
}

interface Queued {
	event: string;
	properties: Record<string, string | number | boolean>;
}

/**
 * The only way events leave the app. Framework-free: the app creates one instance per
 * Visit and calls `track`. Nothing is stored, no cookie is sent, and a failed request is
 * dropped.
 */
export function createAnalytics(options: AnalyticsOptions = {}): Analytics {
	const endpoint = options.endpoint ?? "/api/e";
	const send = options.fetch ?? ((...args) => globalThis.fetch(...args));
	const schedule =
		options.schedule ?? ((fn) => void setTimeout(fn, FLUSH_AFTER_MS));
	const visitId = (options.randomUUID ?? (() => crypto.randomUUID()))();
	const allowed = clientEvents(EVENTS);

	let queue: Queued[] = [];
	let scheduled = false;

	async function flush(): Promise<void> {
		scheduled = false;
		const batches: Queued[][] = [];
		for (let i = 0; i < queue.length; i += MAX_EVENTS_PER_BATCH) {
			batches.push(queue.slice(i, i + MAX_EVENTS_PER_BATCH));
		}
		queue = [];
		for (const events of batches) {
			try {
				// The browser's fetch takes `credentials`; the Workers type for it does not.
				const init = {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ visit: visitId, events }),
					credentials: "omit",
					referrerPolicy: "no-referrer",
					keepalive: true,
				} as RequestInit;
				await send(endpoint, init);
			} catch {
				// Analytics is best effort; a lost batch is not worth an error.
			}
		}
	}

	function enqueue(event: string, props: unknown): boolean {
		const merged =
			typeof props === "object" && props !== null && !Array.isArray(props)
				? { ...props, ...options.experiments?.() }
				: props;
		const checked = checkEvent(allowed, event, merged);
		if (!checked.ok) return false;
		queue.push({ event, properties: checked.properties });
		if (!scheduled) {
			scheduled = true;
			schedule(() => void flush());
		}
		return true;
	}

	return {
		visitId,
		track: (event, props) => enqueue(event, props),
		trackPageview(location) {
			const view = pageviewFor(location);
			return enqueue(view.event, view.properties);
		},
		flush,
	};
}
