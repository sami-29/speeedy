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

/** The properties of `session_started`, computed on the device from the Sessions it keeps. */
export function sessionStartProps(
	_input: SessionStartInput,
): Record<string, string | boolean> {
	throw new Error("not implemented");
}
