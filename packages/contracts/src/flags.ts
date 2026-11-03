/**
 * Speeedy's own feature flags.
 *
 * The Worker serves a small remote config. Each device holds a random bucket that never
 * leaves it. A flag resolves on the device from the bucket and the flag's rollout percent,
 * so a staged rollout or a kill switch needs no deploy and no identifier. Events report the
 * variants that were active as `exp_<name>=<variant>` enums, declared here so the event
 * registry, the Worker's allowlist and the privacy tests cover them.
 */
import type { PropSpec } from "./events.ts";

export interface FlagDef {
	description: string;
	/** Every value the flag can take. Becomes the closed enum on events. */
	variants: readonly [string, ...string[]];
	/** What a device gets when it is not in the rollout, or when there is no config. */
	fallback: string;
}

export type FlagRegistry = Readonly<Record<string, FlagDef>>;

/**
 * Every flag the app can read. A flag must be declared here before the config can switch
 * it on or an event can report it. `pipeline_check` is read by no feature: it keeps the
 * whole path (config, bucket, event enum, allowlist) under test until a real flag exists.
 */
export const FLAGS = {
	pipeline_check: {
		description:
			"Proves flags work end to end. No feature reads it; delete it once a real flag is declared.",
		variants: ["off", "on"],
		fallback: "off",
	},
} as const satisfies FlagRegistry;

export type FlagName = keyof typeof FLAGS;

const FLAG_NAME = /^[a-z][a-z0-9_]*$/;
const VARIANT = /^[A-Za-z0-9_.-]{1,64}$/;

/** Checks the flag registry's own rules. An empty list means it is sound. */
export function flagProblems(flags: FlagRegistry): string[] {
	const problems: string[] = [];
	for (const [name, def] of Object.entries(flags)) {
		const at = (message: string) => problems.push(`${name}: ${message}`);
		if (!FLAG_NAME.test(name)) at("bad flag name");
		if (typeof def.description !== "string" || def.description.trim() === "")
			at("description is required");
		const variants: unknown = def.variants;
		if (!Array.isArray(variants) || variants.length < 2) {
			at("a flag needs at least two variants");
			continue;
		}
		if (new Set(variants).size !== variants.length) at("variants repeat");
		for (const variant of variants) {
			if (typeof variant !== "string" || !VARIANT.test(variant))
				at(`bad variant ${JSON.stringify(variant)}`);
		}
		if (!variants.includes(def.fallback)) at("fallback must be a variant");
	}
	return problems;
}

/** One optional `exp_<name>` enum per flag, to merge into a client event's properties. */
export function experimentProps(flags: FlagRegistry): Record<string, PropSpec> {
	return Object.fromEntries(
		Object.entries(flags).map(([name, def]) => [
			`exp_${name}`,
			{ kind: "enum", optional: true, values: def.variants },
		]),
	);
}

/** Where the Worker serves the config. */
export const FLAG_CONFIG_PATH = "/api/flags";

export interface FlagSetting {
	/** 0 to 100, in steps as fine as 0.01. 0 is a kill switch. */
	percent: number;
	/** What devices inside the rollout get. */
	variant: string;
}

export interface FlagConfig {
	version: 1;
	flags: Readonly<Record<string, FlagSetting>>;
}

export const EMPTY_FLAG_CONFIG: FlagConfig = { version: 1, flags: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a config of unknown origin. A flag the registry does not declare, an unknown
 * variant or a percent outside 0 to 100 drops that one entry, so the flag keeps its
 * fallback. Anything that is not a version 1 config is the empty config.
 */
export function parseFlagConfig(
	value: unknown,
	registry: FlagRegistry = FLAGS,
): FlagConfig {
	if (!isRecord(value) || value.version !== 1 || !isRecord(value.flags))
		return EMPTY_FLAG_CONFIG;
	const flags: Record<string, FlagSetting> = {};
	for (const [name, setting] of Object.entries(value.flags)) {
		if (!Object.hasOwn(registry, name) || !isRecord(setting)) continue;
		const def = registry[name];
		const { percent } = setting;
		if (
			typeof percent !== "number" ||
			!Number.isFinite(percent) ||
			percent < 0 ||
			percent > 100
		)
			continue;
		const variant = setting.variant ?? def.variants[def.variants.length - 1];
		if (typeof variant !== "string" || !def.variants.includes(variant))
			continue;
		flags[name] = { percent, variant };
	}
	return { version: 1, flags };
}

/** 32-bit FNV-1a over the UTF-8 bytes. Synchronous and dependency-free. */
export function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(text)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/**
 * Where a bucket sits for a flag, 0 to 9999. The hash is fixed, so the same bucket and
 * flag always land in the same place: growing a rollout never moves a device out.
 */
export function rolloutPosition(bucket: string, flag: string): number {
	return fnv1a(`${bucket}:${flag}`) % 10000;
}

/** Whether a bucket is inside a flag's rollout of `percent` (0 to 100). */
export function inRollout(
	bucket: string,
	flag: string,
	percent: number,
): boolean {
	// Round to hundredths of a percent first, so 36.1 does not turn into 3609.9999.
	return rolloutPosition(bucket, flag) < Math.round(percent * 100);
}

/** The variant a device gets for one flag. */
export function resolveFlag(
	registry: FlagRegistry,
	config: FlagConfig,
	bucket: string,
	name: string,
): string {
	const def = registry[name];
	const setting = Object.hasOwn(config.flags, name)
		? config.flags[name]
		: undefined;
	if (setting && inRollout(bucket, name, setting.percent))
		return setting.variant;
	return def.fallback;
}

/** The slice of `localStorage` the flags need. Anything with these two works. */
export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const BUCKET_KEY = "speeedy.flags.bucket";
export const CONFIG_KEY = "speeedy.flags.config";

const BUCKET_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The device's random bucket. It is made once, kept in local storage and used only to
 * resolve flags here. Nothing in this module sends it. If storage is blocked, the bucket
 * lasts for this load only.
 */
export function loadBucket(
	store: KeyValueStore | null,
	randomUUID: () => string = () => crypto.randomUUID(),
): string {
	try {
		const stored = store?.getItem(BUCKET_KEY);
		if (stored && BUCKET_SHAPE.test(stored)) return stored;
	} catch {
		// Blocked storage: fall through to a fresh bucket.
	}
	const bucket = randomUUID();
	try {
		store?.setItem(BUCKET_KEY, bucket);
	} catch {
		// Not stored; the bucket is good for this load.
	}
	return bucket;
}

/** The flags as resolved for this load. */
export interface Flags {
	variant<N extends FlagName>(name: N): (typeof FLAGS)[N]["variants"][number];
	/** The active variants as `exp_<name>` properties, ready for the analytics module. */
	experiments(): Record<string, string>;
}

/** The slice of `fetch` the loader needs. */
export type FlagFetch = (
	input: string,
	init?: {
		method?: string;
		credentials?: "omit";
		referrerPolicy?: "no-referrer";
		signal?: AbortSignal;
	},
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface LoadFlagsOptions {
	fetch?: FlagFetch;
	/** `localStorage` in the app. `null` means no storage. */
	store?: KeyValueStore | null;
	randomUUID?: () => string;
	/**
	 * A config to use instead of the network and the cache. This is the hook tests use to
	 * inject a remote config. It is not cached, so it never outlives the page.
	 */
	override?: unknown;
	registry?: FlagRegistry;
	/** How long to wait for the config before using the cached copy. Default 3000. */
	timeoutMs?: number;
}

/**
 * Where a test puts a config before the app loads, for example with Playwright's
 * `page.addInitScript`. The app passes `injectedFlagConfig(globalThis)` as `override`.
 */
export const INJECTED_CONFIG_KEY = "__speeedyFlags";

export function injectedFlagConfig(scope: object): unknown {
	return (scope as Record<string, unknown>)[INJECTED_CONFIG_KEY];
}

async function fetchConfig(
	fetchImpl: FlagFetch,
	timeoutMs: number,
): Promise<unknown | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(FLAG_CONFIG_PATH, {
			method: "GET",
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		return await response.json();
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

function isConfig(value: unknown): boolean {
	return isRecord(value) && value.version === 1 && isRecord(value.flags);
}

function readCached(store: KeyValueStore | null): unknown | undefined {
	try {
		const text = store?.getItem(CONFIG_KEY);
		return text ? JSON.parse(text) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Loads the flags for this page load. Order: an injected override, then the config the
 * Worker serves (cached as the last good copy), then the cached copy, then the built-in
 * defaults. The request carries nothing about the device. It never throws.
 */
export async function loadFlags(
	options: LoadFlagsOptions = {},
): Promise<Flags> {
	const registry = options.registry ?? FLAGS;
	const store = options.store === undefined ? defaultStore() : options.store;
	const bucket = loadBucket(store, options.randomUUID);

	let raw: unknown;
	if (options.override !== undefined) {
		raw = options.override;
	} else {
		const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
		const fetched = await fetchConfig(fetchImpl, options.timeoutMs ?? 3000);
		if (isConfig(fetched)) {
			raw = fetched;
			try {
				store?.setItem(CONFIG_KEY, JSON.stringify(fetched));
			} catch {
				// Not cached; this load still has the config.
			}
		} else {
			raw = readCached(store);
		}
	}

	const config = parseFlagConfig(raw, registry);
	const resolved = Object.fromEntries(
		Object.keys(registry).map((name) => [
			name,
			resolveFlag(registry, config, bucket, name),
		]),
	);
	return {
		variant: ((name: string) => resolved[name]) as Flags["variant"],
		experiments: () =>
			Object.fromEntries(
				Object.entries(resolved).map(([name, variant]) => [
					`exp_${name}`,
					variant,
				]),
			),
	};
}

function defaultStore(): KeyValueStore | null {
	try {
		return (
			(globalThis as { localStorage?: KeyValueStore }).localStorage ?? null
		);
	} catch {
		return null;
	}
}
