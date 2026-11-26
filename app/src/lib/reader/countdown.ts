/** The count before RSVP starts, as in 1.x: 3, 2, 1, each up for 800 ms. */
export const COUNTDOWN_STEPS = 3;
export const COUNTDOWN_STEP_MS = 800;

export type Countdown = {
	/** Show 3 at once, then 2 and 1, then call `onDone`. Starting a running count restarts it. */
	start(): void;
	/** Stop counting. The count is cleared and `onDone` is not called. */
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

export function createCountdown(_options: CountdownOptions): Countdown {
	return {
		start() {},
		cancel() {},
		running: false,
	};
}
