import { checkEvent } from "@speeedy/contracts";
import { ALLOWLIST } from "./allowlist";

export const MAX_EVENTS_PER_BATCH = 20;

/** A Visit ID is a random id the app makes on load; no other shape is accepted. */
const VISIT_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface CleanEvent {
	event: string;
	schemaVersion: number;
	properties: Record<string, string | number | boolean>;
}

export type Validation =
	| { ok: true; visit: string; events: CleanEvent[] }
	| { ok: false; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason: string): Validation {
	return { ok: false, reason };
}

/** Checks a whole batch against the allowlist. One bad event rejects the batch. */
export function validateBatch(body: unknown): Validation {
	if (!isObject(body)) return reject("body_not_object");
	if (typeof body.visit !== "string" || !VISIT_ID.test(body.visit))
		return reject("bad_visit");
	const { events } = body;
	if (!Array.isArray(events) || events.length === 0) return reject("no_events");
	if (events.length > MAX_EVENTS_PER_BATCH) return reject("too_many_events");

	const clean: CleanEvent[] = [];
	for (const item of events) {
		if (!isObject(item)) return reject("bad_event");
		if (
			Object.keys(item).some((key) => key !== "event" && key !== "properties")
		) {
			return reject("bad_event");
		}
		if (typeof item.event !== "string") return reject("unknown_event");
		const checked = checkEvent(ALLOWLIST, item.event, item.properties);
		if (!checked.ok) return reject(checked.reason);
		clean.push({
			event: item.event,
			schemaVersion: checked.schemaVersion,
			properties: checked.properties,
		});
	}
	return { ok: true, visit: body.visit, events: clean };
}
