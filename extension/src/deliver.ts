import type { LauncherPage } from "@speeedy/contracts";

export type Peer = {
	postMessage(message: unknown, targetOrigin: string): void;
};

export type DeliverEnv = {
	/** Open the Speeedy tab. Null when the browser blocked it. */
	open(): Peer | null;
	addEventListener(
		type: "message",
		listener: (event: {
			data: unknown;
			origin: string;
			source: unknown;
		}) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: {
			data: unknown;
			origin: string;
			source: unknown;
		}) => void,
	): void;
};

export type DeliveryOutcome = "delivered" | "refused" | "blocked" | "timeout";

export async function deliverPage(_options: {
	env: DeliverEnv;
	targetOrigin: string;
	page: LauncherPage;
	timeoutMs: number;
}): Promise<DeliveryOutcome> {
	return "timeout";
}
