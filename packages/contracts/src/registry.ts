/**
 * The plugin contract for Reading Modes and Training drills.
 *
 * RSVP, Pacer, Listen and each drill register one Descriptor. The reader shell knows only
 * the registry, so adding a mode or drill touches no engine code. The registry is
 * contracts-only and framework-free: the `view` is a type parameter so the app can use a
 * component type without this package depending on a UI library.
 */

/** Which Clock drives the Cursor: the timer, the audio output clock, or Web Speech events. */
export const CLOCK_KINDS = ["timer", "audio", "web-speech"] as const;
export type ClockKind = (typeof CLOCK_KINDS)[number];

/**
 * Pacing rules the engine implements, by id. A Descriptor lists the ones it uses; they
 * are applied in the listed order (base WPM first).
 */
export const PACING_RULE_IDS = [
	"base-wpm",
	"smart-speed",
	"punctuation-pauses",
	"ramp",
	"sprints",
] as const;
export type PacingRuleId = (typeof PACING_RULE_IDS)[number];

export type DescriptorKind = "mode" | "drill";

export type Descriptor<TView = unknown> = {
	/** A Reading Mode or a Training drill. */
	kind: DescriptorKind;
	/** Unique, lowercase kebab-case. Used in routes and the registry. */
	id: string;
	/** The value analytics events carry for this mode or drill. Unique, snake_case. */
	analyticsValue: string;
	/** What the reader sees. Opaque to the registry. */
	view: TView;
	pacingRules: readonly PacingRuleId[];
	clock: ClockKind;
	/** Names of the reading settings this mode or drill reads. */
	settingsUsed: readonly string[];
};

export type Registry<TView = unknown> = {
	/** Add a mode or drill. Throws RegistryError on an invalid or duplicate descriptor. */
	register(descriptor: Descriptor<TView>): void;
	get(id: string): Descriptor<TView> | undefined;
	/** Everything registered, in registration order. */
	list(): Descriptor<TView>[];
	modes(): Descriptor<TView>[];
	drills(): Descriptor<TView>[];
};

export class RegistryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RegistryError";
	}
}

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ANALYTICS_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function checkDescriptor(descriptor: Descriptor<unknown>): void {
	const { kind, id, analyticsValue, clock, pacingRules, settingsUsed } =
		descriptor;
	if (kind !== "mode" && kind !== "drill") {
		throw new RegistryError(`unknown kind ${String(kind)}`);
	}
	if (typeof id !== "string" || !ID_PATTERN.test(id)) {
		throw new RegistryError(`invalid id ${JSON.stringify(id)}`);
	}
	if (
		typeof analyticsValue !== "string" ||
		!ANALYTICS_PATTERN.test(analyticsValue)
	) {
		throw new RegistryError(
			`invalid analytics value ${JSON.stringify(analyticsValue)} for ${id}`,
		);
	}
	if (!(CLOCK_KINDS as readonly unknown[]).includes(clock)) {
		throw new RegistryError(`unknown clock ${String(clock)} for ${id}`);
	}
	if (!Array.isArray(pacingRules)) {
		throw new RegistryError(`pacingRules must be a list for ${id}`);
	}
	for (const rule of pacingRules) {
		if (!(PACING_RULE_IDS as readonly unknown[]).includes(rule)) {
			throw new RegistryError(`unknown pacing rule ${String(rule)} for ${id}`);
		}
	}
	if (new Set(pacingRules).size !== pacingRules.length) {
		throw new RegistryError(`duplicate pacing rule for ${id}`);
	}
	if (
		!Array.isArray(settingsUsed) ||
		settingsUsed.some((name) => typeof name !== "string" || name === "")
	) {
		throw new RegistryError(`settingsUsed must be a list of names for ${id}`);
	}
}

export function createRegistry<TView = unknown>(): Registry<TView> {
	const entries = new Map<string, Descriptor<TView>>();

	const only = (kind: DescriptorKind) =>
		[...entries.values()].filter((entry) => entry.kind === kind);

	return {
		register(descriptor) {
			checkDescriptor(descriptor);
			if (entries.has(descriptor.id)) {
				throw new RegistryError(`id ${descriptor.id} is already registered`);
			}
			for (const entry of entries.values()) {
				if (entry.analyticsValue === descriptor.analyticsValue) {
					throw new RegistryError(
						`analytics value ${descriptor.analyticsValue} is already used by ${entry.id}`,
					);
				}
			}
			entries.set(
				descriptor.id,
				Object.freeze({
					...descriptor,
					pacingRules: Object.freeze([...descriptor.pacingRules]),
					settingsUsed: Object.freeze([...descriptor.settingsUsed]),
				}),
			);
		},
		get: (id) => entries.get(id),
		list: () => [...entries.values()],
		modes: () => only("mode"),
		drills: () => only("drill"),
	};
}
