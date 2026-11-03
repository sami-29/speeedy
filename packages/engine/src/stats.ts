/** Average words per minute over Sessions that have one. 0 when none do. */
export function averageWpm(sessions: readonly { wpm: number }[]): number {
	const timed = sessions.filter((session) => session.wpm > 0);
	if (timed.length === 0) return 0;
	const total = timed.reduce((sum, session) => sum + session.wpm, 0);
	return Math.round(total / timed.length);
}

/** The last `count` non-zero words-per-minute values, oldest first. */
export function recentWpms(
	sessions: readonly { wpm: number }[],
	count = 20,
): number[] {
	return sessions
		.filter((session) => session.wpm > 0)
		.slice(-count)
		.map((session) => session.wpm);
}

/** `45s`, `1m 30s` or `2h 30m`. */
export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

/** `999`, `1.5K` or `2.5M`. */
export function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toString();
}
