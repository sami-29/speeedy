import {
	isLauncherAck,
	isLauncherReady,
	type LauncherPage,
} from "@speeedy/contracts";

export type Peer = {
	postMessage(message: unknown, targetOrigin: string): void;
};

type Incoming = { data: unknown; origin: string; source: unknown };

export type DeliverEnv = {
	/** Open the Speeedy tab. Null when the browser blocked it. */
	open(): Peer | null;
	addEventListener(type: "message", listener: (event: Incoming) => void): void;
	removeEventListener(
		type: "message",
		listener: (event: Incoming) => void,
	): void;
};

export type DeliveryOutcome = "delivered" | "refused" | "blocked" | "timeout";

/**
 * Hand a page to a new Speeedy tab. The tab says it is ready, the page goes to Speeedy's
 * origin and nowhere else, and the tab answers with an ack. Only messages from the tab this
 * function opened, at Speeedy's origin, count. The page is never posted with a wildcard target,
 * so it cannot reach another site if the tab has moved on.
 */
export function deliverPage(options: {
	env: DeliverEnv;
	targetOrigin: string;
	page: LauncherPage;
	timeoutMs: number;
}): Promise<DeliveryOutcome> {
	const { env, targetOrigin, page, timeoutMs } = options;
	return new Promise((resolve) => {
		let child: Peer | null = null;
		let sent = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const finish = (outcome: DeliveryOutcome) => {
			clearTimeout(timer);
			env.removeEventListener("message", onMessage);
			resolve(outcome);
		};

		const onMessage = (event: Incoming) => {
			if (child === null || event.source !== child) return;
			if (event.origin !== targetOrigin) return;
			if (isLauncherReady(event.data)) {
				if (!sent) {
					sent = true;
					child.postMessage(page, targetOrigin);
				}
				return;
			}
			if (sent && isLauncherAck(event.data)) {
				finish(event.data.ok ? "delivered" : "refused");
			}
		};

		env.addEventListener("message", onMessage);
		child = env.open();
		if (child === null) {
			finish("blocked");
			return;
		}
		timer = setTimeout(() => finish("timeout"), timeoutMs);
	});
}
