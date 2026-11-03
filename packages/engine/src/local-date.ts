/** The local calendar day an instant falls on, as `YYYY-MM-DD`. Defaults to the reader's own zone. */
export function localDate(epochMs: number, timeZone?: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		...(timeZone ? { timeZone } : {}),
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(epochMs);
	const part = (type: string) =>
		parts.find((candidate) => candidate.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The date `days` calendar days after `date` (before, when negative). It counts whole
 * calendar days on the date alone, so a 23 or 25 hour day around a clock change is one day
 * like any other.
 */
export function shiftDate(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number) as [
		number,
		number,
		number,
	];
	return new Date(Date.UTC(year, month - 1, day + days))
		.toISOString()
		.slice(0, 10);
}
