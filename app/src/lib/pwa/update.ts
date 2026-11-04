/**
 * The page's side of a service worker update. A new worker installs in the background and then
 * waits: if it took over at once, the open page would be left with scripts the new worker's
 * cache no longer holds. So the reader is told in a plain line, and chooses when to switch.
 * `apply` tells the waiting worker to take over and reloads once it has.
 */

import { SKIP_WAITING } from "./worker-message.ts";

export { SKIP_WAITING };

export type WorkerLike = {
	state: string;
	postMessage(message: unknown): void;
	addEventListener(type: "statechange", listener: () => void): void;
};

export type RegistrationLike = {
	waiting: WorkerLike | null;
	installing: WorkerLike | null;
	update(): Promise<unknown>;
	addEventListener(type: "updatefound", listener: () => void): void;
};

export type ContainerLike = {
	/** Set when a worker already controls this page; null on the very first visit. */
	controller: unknown;
	/** Resolves once a worker is active, so a registration made after the page opened counts too. */
	readonly ready: Promise<RegistrationLike>;
	addEventListener(type: "controllerchange", listener: () => void): void;
};

export type UpdateWatcher = {
	/** Ask the browser to look for a newer worker now. */
	check(): Promise<void>;
	/** Switch to the waiting worker and reload. */
	apply(): void;
};

export function watchForUpdate(
	container: ContainerLike,
	options: {
		onChange(ready: boolean): void;
		reload?: () => void;
	},
): UpdateWatcher {
	let registration: RegistrationLike | undefined;
	let applying = false;

	const announce = (worker: WorkerLike | null) => {
		// On the first visit the worker that finishes installing is the app itself, not an update.
		if (worker && container.controller) options.onChange(true);
	};

	const ready = container.ready.then((found) => {
		registration = found;
		announce(found.waiting);
		found.addEventListener("updatefound", () => {
			const installing = found.installing;
			installing?.addEventListener("statechange", () => {
				if (installing.state === "installed") announce(found.waiting);
			});
		});
	});

	container.addEventListener("controllerchange", () => {
		// Only a takeover the reader asked for reloads the page, and only once.
		if (!applying) return;
		applying = false;
		(options.reload ?? (() => location.reload()))();
	});

	return {
		async check() {
			await ready;
			await registration?.update();
		},
		apply() {
			const waiting = registration?.waiting;
			if (!waiting) return;
			applying = true;
			waiting.postMessage({ type: SKIP_WAITING });
		},
	};
}
