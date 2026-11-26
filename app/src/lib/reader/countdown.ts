/** The count before RSVP starts, as in 1.x: 3, 2, 1, each up for 800 ms. */
export const COUNTDOWN_STEPS = 3;
export const COUNTDOWN_STEP_MS = 800;

export type Countdown = {
	/** Show 3 at once, then 2 and 1, then call `ondone`. Starting a running count restarts it. */
	start(): void;
	/** Stop counting. The count is cleared and `ondone` is not called. */
	cancel(): void;
	readonly running: boolean;
};

export type CountdownOptions = {
	/** The number on show, or null when the count is over or stopped. */
	oncount: (count: number | null) => void;
	/** The count ran out: time to play. */
	ondone: () => void;
	steps?: number;
	stepMs?: number;
};

/** A count that runs on timers and tells its owner what to show. Nothing else reads it. */
export function createCountdown({
	oncount,
	ondone,
	steps = COUNTDOWN_STEPS,
	stepMs = COUNTDOWN_STEP_MS,
}: CountdownOptions): Countdown {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let count: number | null = null;

	const stop = () => {
		clearTimeout(timer);
		timer = undefined;
		count = null;
	};

	const tick = () => {
		if (count === null) return;
		if (count > 1) {
			count -= 1;
			oncount(count);
			timer = setTimeout(tick, stepMs);
			return;
		}
		stop();
		oncount(null);
		ondone();
	};

	return {
		start() {
			stop();
			count = steps;
			oncount(count);
			timer = setTimeout(tick, stepMs);
		},
		cancel() {
			if (count === null) return;
			stop();
			oncount(null);
		},
		get running() {
			return count !== null;
		},
	};
}
