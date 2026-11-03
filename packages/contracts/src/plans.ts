// Plans as data. This is the only module that names a plan. Everything else asks
// `hasFeature(account, feature)` or `limit(account, name)`; a test fails on any direct
// plan check elsewhere. The Worker's entitlement row (#46, #48) names the plan; the app
// reads the resulting features and limits from the Worker with `readPlan`.

export const PLAN_IDS = ["free", "plus"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const FEATURES = ["sync", "serverVoices"] as const;
export type Feature = (typeof FEATURES)[number];

export const LIMIT_NAMES = [
	"voiceHoursPerMonth",
	"syncBytes",
	"syncDocumentBytes",
] as const;
export type LimitName = (typeof LIMIT_NAMES)[number];

export const PROVIDERS = ["polar", "stripe"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface Price {
	/** The provider's product or price ID. Placeholders until the provider tickets land. */
	productId: string;
	usdCents: number;
}

export interface ProviderPrices {
	monthly: Price;
	annual: Price;
	/** The first-year annual price during the launch window. */
	annualLaunch: Price;
}

export interface Plan {
	features: Readonly<Record<Feature, boolean>>;
	limits: Readonly<Record<LimitName, number>>;
	prices: Readonly<Partial<Record<Provider, ProviderPrices>>>;
}

export const PLANS = {
	free: {
		features: { sync: false, serverVoices: false },
		limits: { voiceHoursPerMonth: 0, syncBytes: 0, syncDocumentBytes: 0 },
		prices: {},
	},
	plus: {
		features: { sync: true, serverVoices: true },
		limits: {
			voiceHoursPerMonth: 20,
			syncBytes: 1_000_000_000,
			syncDocumentBytes: 100_000_000,
		},
		// Product IDs are placeholders. The real ones come from the Polar and Stripe
		// dashboards (a human step) and are not secrets.
		prices: {
			polar: {
				monthly: { productId: "polar_plus_monthly_placeholder", usdCents: 600 },
				annual: { productId: "polar_plus_annual_placeholder", usdCents: 6000 },
				annualLaunch: {
					productId: "polar_plus_annual_launch_placeholder",
					usdCents: 4000,
				},
			},
			stripe: {
				monthly: {
					productId: "stripe_plus_monthly_placeholder",
					usdCents: 600,
				},
				annual: { productId: "stripe_plus_annual_placeholder", usdCents: 6000 },
				annualLaunch: {
					productId: "stripe_plus_annual_launch_placeholder",
					usdCents: 4000,
				},
			},
		},
	},
} as const satisfies Record<PlanId, Plan>;

/** What the Worker's entitlement row says about an Account. */
export interface Entitlement {
	plan: PlanId;
	status: "active" | "ended";
}

/** The part of an Account that plan lookups read. No Account means the free plan. */
export type EntitlementAccount =
	| { entitlement: Entitlement }
	| null
	| undefined;

function isPlanId(value: unknown): value is PlanId {
	return (
		typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value)
	);
}

function planIdFor(account: EntitlementAccount): PlanId {
	const entitlement = account?.entitlement;
	if (entitlement?.status === "active" && isPlanId(entitlement.plan)) {
		return entitlement.plan;
	}
	return "free";
}

export function hasFeature(
	account: EntitlementAccount,
	feature: Feature,
): boolean {
	return PLANS[planIdFor(account)].features[feature];
}

export function limit(account: EntitlementAccount, name: LimitName): number {
	return PLANS[planIdFor(account)].limits[name];
}

/** What the Worker tells the app about the current Account. No prices or product IDs. */
export interface PlanSnapshot {
	plan: PlanId;
	features: Record<Feature, boolean>;
	limits: Record<LimitName, number>;
}

export function planSnapshot(account: EntitlementAccount): PlanSnapshot {
	const plan = planIdFor(account);
	return {
		plan,
		features: { ...PLANS[plan].features },
		limits: { ...PLANS[plan].limits },
	};
}

export function snapshotHasFeature(
	snapshot: PlanSnapshot,
	feature: Feature,
): boolean {
	return snapshot.features[feature];
}

export function snapshotLimit(snapshot: PlanSnapshot, name: LimitName): number {
	return snapshot.limits[name];
}

export const PLAN_PATH = "/api/plan";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanSnapshot(value: unknown): value is PlanSnapshot {
	if (!isRecord(value) || !isPlanId(value.plan)) return false;
	const { features, limits } = value;
	if (!isRecord(features) || !isRecord(limits)) return false;
	return (
		FEATURES.every((name) => typeof features[name] === "boolean") &&
		LIMIT_NAMES.every((name) => {
			const amount = limits[name];
			return (
				typeof amount === "number" && Number.isFinite(amount) && amount >= 0
			);
		})
	);
}

/** The slice of `fetch` that `readPlan` needs. The app passes the global `fetch`. */
export type FetchLike = (
	input: string,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * The app's read of the current Account's plan. Any failure (offline, error status, a body
 * that is not a plan) gives the free plan, so a broken endpoint never unlocks a feature.
 */
export async function readPlan(fetchImpl: FetchLike): Promise<PlanSnapshot> {
	try {
		const response = await fetchImpl(PLAN_PATH);
		if (!response.ok) return planSnapshot(null);
		const body: unknown = await response.json();
		return isPlanSnapshot(body) ? body : planSnapshot(null);
	} catch {
		return planSnapshot(null);
	}
}
