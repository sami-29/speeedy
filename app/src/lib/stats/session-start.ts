import {
	daysSinceFirstBucket,
	type EventProps,
	lifetimeSessionsBucket,
} from "@speeedy/contracts";
import { READING_DAY_MS } from "@speeedy/engine";
import type { DocumentSource } from "#lib/library/store.ts";
import type { VisitContext } from "#lib/visit.ts";

/** What the Library already holds of one Session. */
export type PastSession = { date: string; activeMs: number };

export type SessionStartInput = {
	/** Every Session stored before the one that is starting. */
	sessions: readonly PastSession[];
	/** The local calendar date the Session starts on, `YYYY-MM-DD`. */
	today: string;
	source: DocumentSource;
	visit: VisitContext;
};

/** Whole calendar days from `from` to `to`, counted on the dates alone so a clock change is no gap. */
function daysBetween(from: string, to: string): number {
	const at = (date: string) => {
		const [year, month, day] = date.split("-").map(Number) as [
			number,
			number,
			number,
		];
		return Date.UTC(year, month - 1, day);
	};
	return Math.round((at(to) - at(from)) / 86_400_000);
}

/**
 * The properties of `session_started`, computed on the device from the Sessions it keeps.
 * The first Session's date, the count and the month never leave: only their buckets and one
 * flag do. The flag is true while no stored Session this local month reached 60 s, so it
 * marks the Sessions that could be the month's first activation.
 */
export function sessionStartProps({
	sessions,
	today,
	source,
	visit,
}: SessionStartInput): EventProps<"session_started"> {
	const month = today.slice(0, 7);
	const first = sessions.reduce<string | undefined>(
		(earliest, { date }) =>
			earliest === undefined || date < earliest ? date : earliest,
		undefined,
	);
	const activatedThisMonth = sessions.some(
		({ date, activeMs }) =>
			date.slice(0, 7) === month && activeMs >= READING_DAY_MS,
	);
	return {
		source,
		surface: visit.surface,
		...(visit.ref ? { ref: visit.ref } : {}),
		first_this_month: !activatedThisMonth,
		days_since_first: daysSinceFirstBucket(
			first === undefined ? 0 : daysBetween(first, today),
		),
		lifetime_sessions: lifetimeSessionsBucket(sessions.length + 1),
	};
}
