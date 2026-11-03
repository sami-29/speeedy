// Own feature flags: the registry, the device bucket, deterministic rollouts, the config
// parser and the loader that caches the last good copy.
// Run with: pnpm --filter @speeedy/contracts test:unit
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	BUCKET_KEY,
	CONFIG_KEY,
	createAnalytics,
	EMPTY_FLAG_CONFIG,
	EVENTS,
	experimentProps,
	FLAG_CONFIG_PATH,
	FLAGS,
	type FlagRegistry,
	flagProblems,
	fnv1a,
	injectedFlagConfig,
	inRollout,
	type KeyValueStore,
	loadBucket,
	loadFlags,
	parseFlagConfig,
	privacyCases,
	resolveFlag,
	rolloutPosition,
	validExamples,
} from "../src/index.ts";

const FLAG = "pipeline_check";

const REGISTRY: FlagRegistry = {
	checkout_copy: {
		description: "Two wordings of the checkout button.",
		variants: ["classic", "short"],
		fallback: "classic",
	},
	new_tracer: { description: "x", variants: ["off", "on"], fallback: "off" },
};

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, value),
	};
}

const brokenStore: KeyValueStore = {
	getItem() {
		throw new Error("storage blocked");
	},
	setItem() {
		throw new Error("storage blocked");
	},
};

function config(percent: number, variant = "on") {
	return { version: 1, flags: { [FLAG]: { percent, variant } } };
}

type Init = { method?: string; credentials?: string; headers?: unknown };
function fakeFetch(body: unknown, init: ResponseInit = {}) {
	const calls: { url: string; init?: Init }[] = [];
	const fetch = async (url: string, options?: Init) => {
		calls.push({ url, init: options });
		return Response.json(body, init);
	};
	return { fetch, calls };
}

const offline = async () => {
	throw new TypeError("offline");
};

describe("flag registry", () => {
	it("is sound", () => {
		assert.deepEqual(flagProblems(FLAGS), []);
	});

	it("rejects a bad name, a missing fallback and repeated variants", () => {
		const bad = {
			Bad_Name: { description: "x", variants: ["a", "b"], fallback: "a" },
			no_fallback: { description: "x", variants: ["a", "b"], fallback: "z" },
			repeats: { description: "x", variants: ["a", "a"], fallback: "a" },
			no_text: { description: "", variants: ["a", "b"], fallback: "a" },
			one_variant: { description: "x", variants: ["a"], fallback: "a" },
		} as unknown as FlagRegistry;
		const problems = flagProblems(bad);
		for (const name of [
			"Bad_Name",
			"no_fallback",
			"repeats",
			"no_text",
			"one_variant",
		]) {
			assert.ok(
				problems.some((p) => p.startsWith(name)),
				name,
			);
		}
	});
});

describe("exp_ enums in the event registry", () => {
	it("declares one optional enum per flag", () => {
		const props = experimentProps(REGISTRY);
		assert.deepEqual(props.exp_checkout_copy, {
			kind: "enum",
			optional: true,
			values: ["classic", "short"],
		});
		assert.deepEqual(Object.keys(props), [
			"exp_checkout_copy",
			"exp_new_tracer",
		]);
	});

	it("puts the real flags' exp_ enums on client events and not on server events", () => {
		assert.deepEqual(EVENTS.$pageview.props[`exp_${FLAG}`], {
			kind: "enum",
			optional: true,
			values: FLAGS[FLAG].variants,
		});
		assert.ok(`exp_${FLAG}` in EVENTS.feature_survey_answered.props);
		assert.ok(!(`exp_${FLAG}` in EVENTS.checkout_started.props));
	});

	it("covers the exp_ enums in the generated valid and privacy cases", () => {
		const pageview = validExamples(EVENTS).find((e) => e.event === "$pageview");
		assert.equal(pageview?.properties[`exp_${FLAG}`], FLAGS[FLAG].variants[0]);
		assert.ok(
			privacyCases(EVENTS).some(
				(c) => c.label === `$pageview: canary in enum property exp_${FLAG}`,
			),
		);
	});
});

describe("the hash", () => {
	it("is FNV-1a, 32 bits", () => {
		assert.equal(fnv1a(""), 0x811c9dc5);
		assert.equal(fnv1a("a"), 0xe40c292c);
		assert.equal(fnv1a("foobar"), 0xbf9cf968);
	});

	it("gives the same position for the same bucket and flag, forever", () => {
		assert.equal(rolloutPosition("bucket-one", FLAG), 3609);
		assert.equal(rolloutPosition("bucket-two", FLAG), 2619);
		assert.equal(
			rolloutPosition("00000000-0000-4000-8000-000000000000", FLAG),
			6644,
		);
		assert.equal(rolloutPosition("bucket-one", "other_flag"), 2757);
	});
});

describe("percentage rollouts", () => {
	it("compare the position with the percent, in hundredths of a percent", () => {
		assert.equal(inRollout("bucket-one", FLAG, 36), false);
		assert.equal(inRollout("bucket-one", FLAG, 36.1), true);
		assert.equal(inRollout("bucket-one", FLAG, 37), true);
	});

	it("0% is off and 100% is on for every bucket", () => {
		for (let i = 0; i < 2000; i++) {
			const bucket = `bucket-${i}-${(i * 7919) % 1000003}`;
			assert.equal(inRollout(bucket, FLAG, 0), false);
			assert.equal(inRollout(bucket, FLAG, 100), true);
		}
	});

	it("put about the asked share of buckets in", () => {
		let hits = 0;
		const total = 20000;
		for (let i = 0; i < total; i++) {
			if (inRollout(`device-${i}`, FLAG, 30)) hits++;
		}
		assert.ok(Math.abs(hits / total - 0.3) < 0.02, String(hits / total));
	});

	it("grow without moving anyone out: a bucket in at 20% stays in at 50%", () => {
		for (let i = 0; i < 2000; i++) {
			const bucket = `device-${i}`;
			if (inRollout(bucket, FLAG, 20)) assert.ok(inRollout(bucket, FLAG, 50));
		}
	});

	it("are independent per flag", () => {
		let differs = false;
		for (let i = 0; i < 200 && !differs; i++) {
			const bucket = `device-${i}`;
			differs =
				inRollout(bucket, "flag_a", 50) !== inRollout(bucket, "flag_b", 50);
		}
		assert.ok(differs);
	});
});

describe("resolveFlag", () => {
	function parse(percent: number, variant: string) {
		return parseFlagConfig(
			{ version: 1, flags: { checkout_copy: { percent, variant } } },
			REGISTRY,
		);
	}

	it("serves the config's variant to buckets in the rollout and the fallback to the rest", () => {
		assert.equal(
			resolveFlag(REGISTRY, parse(100, "short"), "bucket-one", "checkout_copy"),
			"short",
		);
		assert.equal(
			resolveFlag(REGISTRY, parse(0, "short"), "bucket-one", "checkout_copy"),
			"classic",
		);
	});

	it("serves the fallback when the config has no entry for the flag", () => {
		assert.equal(
			resolveFlag(REGISTRY, EMPTY_FLAG_CONFIG, "bucket-one", "checkout_copy"),
			"classic",
		);
	});
});

describe("parseFlagConfig", () => {
	it("keeps a good entry", () => {
		assert.deepEqual(parseFlagConfig(config(25)), config(25));
	});

	it("defaults the variant to the flag's last declared variant", () => {
		const parsed = parseFlagConfig({
			version: 1,
			flags: { [FLAG]: { percent: 5 } },
		});
		assert.deepEqual(parsed, config(5, "on"));
	});

	it("drops unknown flags, unknown variants and out-of-range percents, one by one", () => {
		assert.deepEqual(
			parseFlagConfig({
				version: 1,
				flags: {
					ghost_flag: { percent: 50, variant: "on" },
					[FLAG]: { percent: 101, variant: "on" },
				},
			}),
			EMPTY_FLAG_CONFIG,
		);
		assert.deepEqual(
			parseFlagConfig({
				version: 1,
				flags: { [FLAG]: { percent: 10, variant: "purple" } },
			}),
			EMPTY_FLAG_CONFIG,
		);
		assert.deepEqual(
			parseFlagConfig({
				version: 1,
				flags: { [FLAG]: { percent: Number.NaN, variant: "on" } },
			}),
			EMPTY_FLAG_CONFIG,
		);
	});

	it("gives the empty config for anything else", () => {
		for (const value of [
			null,
			"x",
			[],
			{},
			{ version: 2, flags: {} },
			{ version: 1, flags: [] },
			{ version: 1 },
		]) {
			assert.deepEqual(parseFlagConfig(value), EMPTY_FLAG_CONFIG);
		}
	});
});

describe("the device bucket", () => {
	it("is random, and stored so the next load reuses it", () => {
		const store = memoryStore();
		const first = loadBucket(
			store,
			() => "11111111-aaaa-4aaa-8aaa-111111111111",
		);
		assert.equal(first, "11111111-aaaa-4aaa-8aaa-111111111111");
		assert.equal(store.data.get(BUCKET_KEY), first);
		assert.equal(
			loadBucket(store, () => "never-used-bucket-value"),
			first,
		);
	});

	it("differs between devices by default", () => {
		assert.notEqual(loadBucket(memoryStore()), loadBucket(memoryStore()));
	});

	it("replaces a stored value that does not look like a bucket", () => {
		const store = memoryStore();
		store.data.set(BUCKET_KEY, "<script>alert(1)</script>");
		const bucket = loadBucket(
			store,
			() => "22222222-bbbb-4bbb-8bbb-222222222222",
		);
		assert.equal(bucket, "22222222-bbbb-4bbb-8bbb-222222222222");
	});

	it("still works when storage throws", () => {
		assert.match(loadBucket(brokenStore), /^[A-Za-z0-9-]{8,64}$/);
		assert.match(loadBucket(null), /^[A-Za-z0-9-]{8,64}$/);
	});
});

describe("loadFlags", () => {
	it("fetches the config from /api/flags and caches the last good copy", async () => {
		const store = memoryStore();
		const { fetch, calls } = fakeFetch(config(100));
		const flags = await loadFlags({ fetch, store });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, FLAG_CONFIG_PATH);
		assert.equal(flags.variant(FLAG), "on");
		assert.deepEqual(
			JSON.parse(store.data.get(CONFIG_KEY) ?? "null"),
			config(100),
		);
	});

	it("sends nothing about the device: no query, no body, no custom headers, no credentials", async () => {
		const store = memoryStore();
		const { fetch, calls } = fakeFetch(config(100));
		await loadFlags({ fetch, store });
		const bucket = store.data.get(BUCKET_KEY) ?? "";
		assert.ok(bucket.length > 0);
		const [{ url, init }] = calls;
		assert.equal(url, "/api/flags");
		assert.ok(!JSON.stringify([url, init]).includes(bucket));
		assert.equal(init?.method ?? "GET", "GET");
		assert.equal(init?.credentials, "omit");
		assert.equal(init?.headers, undefined);
		assert.ok(!("body" in (init ?? {})));
	});

	it("uses the cached copy when the fetch fails", async () => {
		const store = memoryStore();
		await loadFlags({ fetch: fakeFetch(config(100)).fetch, store });
		const flags = await loadFlags({ fetch: offline, store });
		assert.equal(flags.variant(FLAG), "on");
	});

	it("uses the cached copy when the status is not ok or the body is not JSON", async () => {
		const store = memoryStore();
		await loadFlags({ fetch: fakeFetch(config(100)).fetch, store });
		const down = fakeFetch({ error: "x" }, { status: 503 }).fetch;
		assert.equal((await loadFlags({ fetch: down, store })).variant(FLAG), "on");
		const html = async () => new Response("<html>", { status: 200 });
		assert.equal((await loadFlags({ fetch: html, store })).variant(FLAG), "on");
	});

	it("applies the built-in defaults when there is no config and no cache", async () => {
		const flags = await loadFlags({ fetch: offline, store: memoryStore() });
		assert.equal(flags.variant(FLAG), FLAGS[FLAG].fallback);
		assert.deepEqual(flags.experiments(), {
			[`exp_${FLAG}`]: FLAGS[FLAG].fallback,
		});
	});

	it("applies the built-in defaults when there is no fetch and no storage at all", async () => {
		const flags = await loadFlags({ fetch: offline, store: null });
		assert.equal(flags.variant(FLAG), FLAGS[FLAG].fallback);
	});

	it("does not wait forever for a hung request", async () => {
		const hung = (_url: string, init?: { signal?: AbortSignal }) =>
			new Promise<never>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("aborted")),
				);
			});
		const flags = await loadFlags({ fetch: hung, store: null, timeoutMs: 20 });
		assert.equal(flags.variant(FLAG), FLAGS[FLAG].fallback);
	});

	it("turns a feature off on the next load when the kill switch sets it to 0%", async () => {
		const store = memoryStore();
		const on = await loadFlags({ fetch: fakeFetch(config(100)).fetch, store });
		assert.equal(on.variant(FLAG), "on");
		const off = await loadFlags({ fetch: fakeFetch(config(0)).fetch, store });
		assert.equal(off.variant(FLAG), "off");
		// The 0% copy is now the cached one, so an offline load stays off.
		const later = await loadFlags({ fetch: offline, store });
		assert.equal(later.variant(FLAG), "off");
	});

	it("keeps one bucket across loads, so a device stays in its rollout", async () => {
		const store = memoryStore();
		await loadFlags({ fetch: fakeFetch(config(50)).fetch, store });
		const bucket = store.data.get(BUCKET_KEY);
		await loadFlags({ fetch: fakeFetch(config(60)).fetch, store });
		assert.equal(store.data.get(BUCKET_KEY), bucket);
	});

	it("resolves each flag from the bucket it holds", async () => {
		const store = memoryStore();
		store.data.set(BUCKET_KEY, "bucket-one");
		const at37 = await loadFlags({ fetch: fakeFetch(config(37)).fetch, store });
		const at36 = await loadFlags({ fetch: fakeFetch(config(36)).fetch, store });
		assert.equal(at37.variant(FLAG), "on");
		assert.equal(at36.variant(FLAG), "off");
	});

	it("never puts the bucket in the active variants", async () => {
		const store = memoryStore();
		store.data.set(BUCKET_KEY, "bucket-one");
		const flags = await loadFlags({
			fetch: fakeFetch(config(100)).fetch,
			store,
		});
		assert.ok(!JSON.stringify(flags.experiments()).includes("bucket-one"));
	});
});

describe("injecting a remote config", () => {
	it("an override replaces the fetch and the cache", async () => {
		const store = memoryStore();
		const { fetch, calls } = fakeFetch(config(0));
		const flags = await loadFlags({ fetch, store, override: config(100) });
		assert.equal(flags.variant(FLAG), "on");
		assert.equal(calls.length, 0);
		assert.equal(store.data.has(CONFIG_KEY), false);
	});

	it("an override is parsed like any config", async () => {
		const flags = await loadFlags({
			fetch: offline,
			store: null,
			override: {
				version: 1,
				flags: { [FLAG]: { percent: 500, variant: "on" } },
			},
		});
		assert.equal(flags.variant(FLAG), "off");
	});

	it("reads the config a test put on the page before the app loaded", () => {
		assert.deepEqual(
			injectedFlagConfig({ __speeedyFlags: config(100) }),
			config(100),
		);
		assert.equal(injectedFlagConfig({}), undefined);
	});
});

describe("events carry the active variants", () => {
	it("attaches exp_<name>=<variant> to a tracked event and a pageview", async () => {
		const bodies: { visit: string; events: { properties: object }[] }[] = [];
		const analytics = createAnalytics({
			fetch: async (_url, init) => {
				bodies.push(JSON.parse(String(init?.body)));
				return new Response(null, { status: 202 });
			},
			schedule: () => {},
			experiments: () => ({ [`exp_${FLAG}`]: "on" }),
		});
		assert.equal(analytics.trackPageview("/reader"), true);
		assert.equal(
			analytics.track("feature_survey_answered", { idea_sync: true }),
			true,
		);
		await analytics.flush();
		const [{ events }] = bodies;
		assert.deepEqual(events[0].properties, {
			route: "/reader",
			[`exp_${FLAG}`]: "on",
		});
		assert.deepEqual(events[1].properties, {
			idea_sync: true,
			[`exp_${FLAG}`]: "on",
		});
	});

	it("drops an event whose variant is not a declared one", () => {
		const analytics = createAnalytics({
			fetch: offline,
			schedule: () => {},
			experiments: () => ({ [`exp_${FLAG}`]: "purple" }),
		});
		assert.equal(analytics.trackPageview("/reader"), false);
	});
});
