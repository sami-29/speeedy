import type { Engine } from "@speeedy/engine";

/** The page whose visibility is watched. */
export type VisibilityPage = {
	document: EventTarget & { readonly visibilityState: string };
};

/**
 * Pauses the Engine whenever the tab is hidden, and leaves it paused when the tab comes
 * back, so the reader presses Play from the text they last saw. A tab that is already
 * hidden pauses at once. Returns a function that stops watching.
 */
export function pauseWhenHidden(
	engine: Pick<Engine, "pause">,
	page: VisibilityPage,
): () => void {
	const check = () => {
		if (page.document.visibilityState === "hidden") engine.pause();
	};
	page.document.addEventListener("visibilitychange", check);
	check();
	return () => {
		page.document.removeEventListener("visibilitychange", check);
	};
}
