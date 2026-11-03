/**
 * The analytics event registry: the one list of what Speeedy may send to analytics.
 *
 * Every event declares its properties as enums, bounded numbers or booleans, plus a schema
 * version. Free text is allowed only on a client event of kind `survey`. The app's typed send
 * function, the Worker's `/api/e` allowlist, the published event list and the privacy test
 * cases are all derived from `EVENTS`, so a new event cannot leak data by accident.
 */

import { GOAL_MINUTES_BUCKETS, STREAK_DAYS_BUCKETS } from "./daily-goal.ts";
import {
	experimentProps,
	FLAGS,
	type FlagName,
	type FlagRegistry,
} from "./flags.ts";
import { NEWSLETTER_PAGES, NEWSLETTER_TOPICS } from "./newsletter.ts";

export type PropSpec = { optional?: boolean } & (
	| { kind: "enum"; values: readonly string[] }
	| { kind: "int"; min: number; max: number }
	| { kind: "bool" }
	| { kind: "text"; max: number }
);

export interface EventDef {
	/** `client` events arrive through `/api/e`; `server` events are sent by the Worker. */
	origin: "client" | "server";
	/** Only a `survey` event may carry free text. */
	kind: "product" | "survey";
	schemaVersion: number;
	description: string;
	props: Readonly<Record<string, PropSpec>>;
}

export type EventRegistry = Readonly<Record<string, EventDef>>;

/** Route patterns a pageview may carry. Anything else is sent as `other`. */
export const ROUTES = [
	"/",
	"/reader",
	"/library",
	"/stats",
	"/training",
	"/s",
	"/account/[page]",
	"/reading-speed-test",
	"/pdf-speed-reader",
	"/epub-speed-reader",
	"/adhd-reading-tool",
	"/text-to-speech-reader",
	"/spreeder-alternative",
	"/learn",
	"/learn/[slug]",
	"/share-link",
	"/support",
	"/plus",
	"/privacy",
	"/terms",
	"/changelog",
	"other",
] as const;

export type Route = (typeof ROUTES)[number];

const answer = { kind: "bool", optional: true } as const;

const DECLARED_EVENTS = {
	$pageview: {
		origin: "client",
		kind: "product",
		schemaVersion: 1,
		description:
			"A page or screen was opened. Carries the route pattern only: no query, no hash, no title.",
		props: { route: { kind: "enum", values: ROUTES } },
	},
	feature_survey_answered: {
		origin: "client",
		kind: "survey",
		schemaVersion: 1,
		description:
			"One answer sheet of the feature survey: a yes or no per idea, what the reader reads, and an optional own idea in free text.",
		props: {
			// The 11 ideas of the 1.x feature survey, each a yes or no.
			idea_listen_voices: answer,
			idea_sync: answer,
			idea_browser_button: answer,
			idea_speed_training: answer,
			idea_comprehension_check: answer,
			idea_photo_to_text: answer,
			idea_read_later: answer,
			idea_focus_settings: answer,
			idea_classroom: answer,
			idea_bilingual: answer,
			idea_ai_help: answer,
			// The one free-text property; only the survey form sends it.
			own_idea: { kind: "text", max: 500, optional: true },
			reads: {
				kind: "enum",
				optional: true,
				values: [
					"articles",
					"books",
					"papers",
					"documents",
					"fiction",
					"news",
					"other",
				],
			},
		},
	},
	daily_goal_met: {
		origin: "client",
		kind: "product",
		schemaVersion: 1,
		description:
			"A reader's reading for the day reached their Daily Goal. Carries the goal and the Streak as buckets only, never exact numbers, a date or any text.",
		props: {
			goal_minutes: { kind: "enum", values: GOAL_MINUTES_BUCKETS },
			streak_days: { kind: "enum", values: STREAK_DAYS_BUCKETS },
		},
	},
	checkout_started: {
		origin: "server",
		kind: "product",
		schemaVersion: 1,
		description:
			"The Worker opened a hosted checkout for the Plus plan. Carries the billing interval only.",
		props: { interval: { kind: "enum", values: ["monthly", "annual"] } },
	},
	newsletter_signup: {
		origin: "server",
		kind: "product",
		schemaVersion: 1,
		description:
			"A reader asked to join the newsletter and the signup was passed on for confirmation. Carries the topic and the page of the form only, never the address.",
		props: {
			topic: { kind: "enum", values: NEWSLETTER_TOPICS },
			page: { kind: "enum", values: NEWSLETTER_PAGES },
		},
	},
} as const satisfies EventRegistry;

/** The `exp_<flag>` enums, one per declared flag, typed from `FLAGS`. */
type ExperimentProps = {
	readonly [N in FlagName as `exp_${N}`]: {
		readonly kind: "enum";
		readonly optional: true;
		readonly values: (typeof FLAGS)[N]["variants"];
	};
};

type WithExperiments<E> = {
	readonly [N in keyof E]: E[N] extends { origin: "client"; props: infer P }
		? Omit<E[N], "props"> & { readonly props: P & ExperimentProps }
		: E[N];
};

/**
 * Adds the `exp_<flag>` enums to every client event, so an event can report which variants
 * were active. Server events do not know a device's flags and get none.
 */
export function withExperiments(
	events: EventRegistry,
	flags: FlagRegistry,
): EventRegistry {
	const extra = experimentProps(flags);
	return Object.fromEntries(
		Object.entries(events).map(([name, def]) => [
			name,
			def.origin === "client"
				? { ...def, props: { ...def.props, ...extra } }
				: def,
		]),
	);
}

/** The registry the app, the Worker and the tests all use: declared events plus `exp_` enums. */
export const EVENTS = withExperiments(
	DECLARED_EVENTS,
	FLAGS,
) as WithExperiments<typeof DECLARED_EVENTS>;

export type EventName = keyof typeof DECLARED_EVENTS;

export type ClientEventName = {
	[N in EventName]: (typeof DECLARED_EVENTS)[N]["origin"] extends "client"
		? N
		: never;
}[EventName];

export type ServerEventName = Exclude<EventName, ClientEventName>;

type ValueOf<P> = P extends { kind: "enum"; values: readonly (infer V)[] }
	? V
	: P extends { kind: "int" }
		? number
		: P extends { kind: "bool" }
			? boolean
			: string;

type OptionalKeys<P> = {
	[K in keyof P]: P[K] extends { optional: true } ? K : never;
}[keyof P];

type PropsOf<P> = {
	-readonly [K in Exclude<keyof P, OptionalKeys<P>>]: ValueOf<P[K]>;
} & {
	-readonly [K in OptionalKeys<P>]?: ValueOf<P[K]>;
};

/** The properties an event may carry, typed from its declaration. */
export type EventProps<N extends EventName> = PropsOf<
	(typeof EVENTS)[N]["props"]
>;

const NAME = /^\$?[a-z][a-z0-9_]*$/;
const PROP_NAME = /^[a-z][a-z0-9_]*$/;
const ENUM_VALUE = /^[A-Za-z0-9_./[\]:-]{1,64}$/;
const MAX_TEXT = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks the registry's own rules. An empty list means the registry is sound. */
export function registryProblems(registry: EventRegistry): string[] {
	const problems: string[] = [];
	for (const [name, def] of Object.entries(registry)) {
		const at = (message: string) => problems.push(`${name}: ${message}`);
		if (!NAME.test(name)) at("bad event name");
		if (!isRecord(def)) {
			at("not an object");
			continue;
		}
		if (def.origin !== "client" && def.origin !== "server")
			at("origin must be client or server");
		if (def.kind !== "product" && def.kind !== "survey")
			at("kind must be product or survey");
		if (!Number.isInteger(def.schemaVersion) || def.schemaVersion < 1)
			at("schemaVersion must be a positive integer");
		if (typeof def.description !== "string" || def.description.trim() === "")
			at("description is required");
		if (!isRecord(def.props)) {
			at("props must be an object");
			continue;
		}
		for (const [prop, spec] of Object.entries(def.props)) {
			const where = (message: string) => at(`${prop}: ${message}`);
			if (!PROP_NAME.test(prop)) where("bad property name");
			if (!isRecord(spec)) {
				where("not an object");
				continue;
			}
			switch (spec.kind) {
				case "enum": {
					const values: unknown = spec.values;
					if (!Array.isArray(values) || values.length === 0) {
						where("enum needs at least one value");
						break;
					}
					if (new Set(values).size !== values.length)
						where("enum values repeat");
					for (const value of values) {
						if (typeof value !== "string" || !ENUM_VALUE.test(value))
							where(`bad enum value ${JSON.stringify(value)}`);
					}
					break;
				}
				case "int":
					if (
						!Number.isInteger(spec.min) ||
						!Number.isInteger(spec.max) ||
						(spec.min as number) > (spec.max as number)
					)
						where("int needs finite integer bounds with min <= max");
					break;
				case "bool":
					break;
				case "text":
					if (def.kind !== "survey" || def.origin !== "client")
						where("text is allowed only on a client survey event");
					if (
						!Number.isInteger(spec.max) ||
						(spec.max as number) < 1 ||
						(spec.max as number) > MAX_TEXT
					)
						where(`text needs a max of 1 to ${MAX_TEXT}`);
					break;
				default:
					where(
						`unknown property kind ${JSON.stringify((spec as { kind?: unknown }).kind)}`,
					);
			}
		}
	}
	return problems;
}

function isValidValue(spec: PropSpec, value: unknown): boolean {
	switch (spec.kind) {
		case "enum":
			return typeof value === "string" && spec.values.includes(value);
		case "int":
			return (
				typeof value === "number" &&
				Number.isInteger(value) &&
				value >= spec.min &&
				value <= spec.max
			);
		case "bool":
			return typeof value === "boolean";
		case "text":
			return typeof value === "string" && Array.from(value).length <= spec.max;
	}
}

export type CheckResult =
	| {
			ok: true;
			schemaVersion: number;
			properties: Record<string, string | number | boolean>;
	  }
	| {
			ok: false;
			reason:
				| "unknown_event"
				| "bad_properties"
				| "unknown_property"
				| "bad_property_value"
				| "missing_property";
	  };

/** Checks one event against a registry. Both the app and the Worker use this. */
export function checkEvent(
	registry: EventRegistry,
	name: string,
	props: unknown,
): CheckResult {
	if (!Object.hasOwn(registry, name))
		return { ok: false, reason: "unknown_event" };
	const def = registry[name];
	const given = props ?? {};
	if (!isRecord(given)) return { ok: false, reason: "bad_properties" };

	const properties: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(given)) {
		if (!Object.hasOwn(def.props, key))
			return { ok: false, reason: "unknown_property" };
		if (!isValidValue(def.props[key], value))
			return { ok: false, reason: "bad_property_value" };
		properties[key] = value as string | number | boolean;
	}
	for (const [key, spec] of Object.entries(def.props)) {
		if (!spec.optional && !Object.hasOwn(properties, key))
			return { ok: false, reason: "missing_property" };
	}
	return { ok: true, schemaVersion: def.schemaVersion, properties };
}

function byOrigin(
	registry: EventRegistry,
	origin: EventDef["origin"],
): EventRegistry {
	return Object.fromEntries(
		Object.entries(registry).filter(([, def]) => def.origin === origin),
	);
}

/** The events a client may send. The Worker's `/api/e` allowlist is exactly this. */
export function clientEvents(registry: EventRegistry): EventRegistry {
	return byOrigin(registry, "client");
}

/** The events only the Worker may send. */
export function serverEvents(registry: EventRegistry): EventRegistry {
	return byOrigin(registry, "server");
}

/** Maps a location to a route pattern. Query, hash and unknown paths never get through. */
export function pageviewFor(location: string): {
	event: "$pageview";
	properties: { route: Route };
} {
	let path = location.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
	path = path.split(/[?#]/, 1)[0];
	if (!path.startsWith("/")) path = `/${path}`;
	if (path.length > 1) path = path.replace(/\/+$/, "");
	return { event: "$pageview", properties: { route: routeFor(path) } };
}

function routeFor(path: string): Route {
	const known = ROUTES.filter((route) => route !== "other");
	const exact = known.find((route) => route === path);
	if (exact) return exact;
	const segments = path.split("/");
	const dynamic = known.find((route) => {
		const parts = route.split("/");
		return (
			parts.length === segments.length &&
			parts.every(
				(part, i) =>
					(part.startsWith("[") && segments[i] !== "") || part === segments[i],
			)
		);
	});
	return dynamic ?? "other";
}
