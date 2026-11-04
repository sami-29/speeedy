import { type UpdateWatcher, watchForUpdate } from "./update.ts";

/** Whether a newer version of the app is installed and waiting for the reader to switch. */
export const updates = $state({ ready: false });

let watcher: UpdateWatcher | undefined;

/** Ask the waiting worker to take over. The page reloads once it has. */
export function applyUpdate(): void {
	watcher?.apply();
}

/**
 * Watch for a new version for as long as the page is open: when it finishes installing, and
 * whenever the reader comes back to the tab. Returns the cleanup.
 */
export function startUpdateWatch(): () => void {
	if (!("serviceWorker" in navigator)) return () => {};
	const current = watchForUpdate(navigator.serviceWorker, {
		onChange: (ready) => {
			updates.ready = ready;
		},
	});
	watcher = current;
	const onVisible = () => {
		if (document.visibilityState === "visible") void current.check();
	};
	document.addEventListener("visibilitychange", onVisible);
	return () => {
		document.removeEventListener("visibilitychange", onVisible);
		if (watcher === current) watcher = undefined;
	};
}
