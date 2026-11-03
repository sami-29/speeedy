/** The reading speed range, in words per minute. */
export const WPM_MIN = 100;
export const WPM_MAX = 1600;
/** One arrow key, stepper press or 8 pixels of drag. */
export const WPM_STEP = 10;
/** Shift with an arrow, or a Page key. */
export const WPM_BIG_STEP = 50;
/** How far the pointer travels for one step. */
export const WPM_PX_PER_STEP = 8;

const DEFAULT_WPM = 250;

/** A whole number between the minimum and maximum. Anything that is not a number is 250. */
export function clampWpm(value: number): number {
	if (Number.isNaN(value)) return DEFAULT_WPM;
	return Math.min(Math.max(Math.round(value), WPM_MIN), WPM_MAX);
}

/** The speed after `delta` more (or fewer) words per minute. */
export const stepWpm = (current: number, delta: number): number =>
	clampWpm(current + delta);

/**
 * The speed a key sets on the slider, or undefined for a key it does not handle. These
 * are the keys of the ARIA slider pattern: arrows, Page keys, Home and End.
 */
export function wpmForKey(
	event: { key: string; shiftKey: boolean },
	current: number,
): number | undefined {
	const step = event.shiftKey ? WPM_BIG_STEP : WPM_STEP;
	switch (event.key) {
		case "ArrowRight":
		case "ArrowUp":
			return stepWpm(current, step);
		case "ArrowLeft":
		case "ArrowDown":
			return stepWpm(current, -step);
		case "PageUp":
			return stepWpm(current, WPM_BIG_STEP);
		case "PageDown":
			return stepWpm(current, -WPM_BIG_STEP);
		case "Home":
			return WPM_MIN;
		case "End":
			return WPM_MAX;
		default:
			return undefined;
	}
}

/** The speed after dragging `dx` pixels from where the drag started at `startWpm`. */
export function wpmFromDrag(startWpm: number, dx: number): number {
	const steps = Math.round(dx / WPM_PX_PER_STEP);
	return clampWpm(startWpm + steps * WPM_STEP);
}
