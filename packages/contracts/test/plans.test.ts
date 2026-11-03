// Seam: the plans module's public functions. Run with: node --test packages/contracts/test/
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type EntitlementAccount,
	hasFeature,
	limit,
	PLANS,
	planSnapshot,
} from "../src/plans.ts";

// A stub entitlement. The real one arrives with Accounts (#46, #48).
const plusAccount: EntitlementAccount = {
	entitlement: { plan: "plus", status: "active" },
};
const endedPlus: EntitlementAccount = {
	entitlement: { plan: "plus", status: "ended" },
};

describe("the plans table", () => {
	it("holds exactly free and plus", () => {
		assert.deepEqual(Object.keys(PLANS).sort(), ["free", "plus"]);
	});

	it("gives plus 20 Voice Hours a month, 1 GB of sync and 100 MB per synced document", () => {
		assert.equal(PLANS.plus.limits.voiceHoursPerMonth, 20);
		assert.equal(PLANS.plus.limits.syncBytes, 1_000_000_000);
		assert.equal(PLANS.plus.limits.syncDocumentBytes, 100_000_000);
	});

	it("gives plus Sync and Server Voices, and free neither", () => {
		assert.equal(PLANS.plus.features.sync, true);
		assert.equal(PLANS.plus.features.serverVoices, true);
		assert.equal(PLANS.free.features.sync, false);
		assert.equal(PLANS.free.features.serverVoices, false);
	});

	it("prices plus per provider: $6 monthly, $60 annual, $40 annual in the launch window", () => {
		for (const provider of ["polar", "stripe"] as const) {
			const prices = PLANS.plus.prices[provider];
			assert.ok(prices, `plus has prices for ${provider}`);
			assert.equal(prices.monthly.usdCents, 600);
			assert.equal(prices.annual.usdCents, 6000);
			assert.equal(prices.annualLaunch.usdCents, 4000);
		}
	});

	it("gives every price a non-empty provider product ID, all different", () => {
		const ids: string[] = [];
		for (const prices of Object.values(PLANS.plus.prices)) {
			for (const price of [
				prices.monthly,
				prices.annual,
				prices.annualLaunch,
			]) {
				assert.equal(typeof price.productId, "string");
				assert.notEqual(price.productId.length, 0);
				ids.push(price.productId);
			}
		}
		assert.equal(ids.length, 6);
		assert.equal(new Set(ids).size, ids.length);
	});

	it("sells no prices for free", () => {
		assert.deepEqual(PLANS.free.prices, {});
	});
});

describe("hasFeature and limit", () => {
	it("apply the free plan when there is no Account", () => {
		for (const account of [null, undefined]) {
			assert.equal(hasFeature(account, "sync"), false);
			assert.equal(hasFeature(account, "serverVoices"), false);
			assert.equal(limit(account, "voiceHoursPerMonth"), 0);
			assert.equal(limit(account, "syncBytes"), 0);
			assert.equal(limit(account, "syncDocumentBytes"), 0);
		}
	});

	it("apply the plus plan to an Account with an active plus entitlement", () => {
		assert.equal(hasFeature(plusAccount, "sync"), true);
		assert.equal(hasFeature(plusAccount, "serverVoices"), true);
		assert.equal(limit(plusAccount, "voiceHoursPerMonth"), 20);
		assert.equal(limit(plusAccount, "syncBytes"), 1_000_000_000);
		assert.equal(limit(plusAccount, "syncDocumentBytes"), 100_000_000);
	});

	it("apply the free plan once the entitlement has ended", () => {
		assert.equal(hasFeature(endedPlus, "sync"), false);
		assert.equal(limit(endedPlus, "voiceHoursPerMonth"), 0);
	});

	it("apply the free plan to an entitlement naming a plan that does not exist", () => {
		const unknown = {
			entitlement: { plan: "gold", status: "active" },
		} as unknown as EntitlementAccount;
		assert.equal(hasFeature(unknown, "sync"), false);
		assert.equal(limit(unknown, "syncBytes"), 0);
	});

	it("do not read inherited object keys as plans", () => {
		const sneaky = {
			entitlement: { plan: "constructor", status: "active" },
		} as unknown as EntitlementAccount;
		assert.equal(hasFeature(sneaky, "sync"), false);
	});
});

describe("planSnapshot", () => {
	it("is the free plan's features and limits for no Account", () => {
		assert.deepEqual(planSnapshot(null), {
			plan: "free",
			features: { sync: false, serverVoices: false },
			limits: { voiceHoursPerMonth: 0, syncBytes: 0, syncDocumentBytes: 0 },
		});
	});

	it("is the plus plan's features and limits for an active plus entitlement", () => {
		assert.deepEqual(planSnapshot(plusAccount), {
			plan: "plus",
			features: { sync: true, serverVoices: true },
			limits: {
				voiceHoursPerMonth: 20,
				syncBytes: 1_000_000_000,
				syncDocumentBytes: 100_000_000,
			},
		});
	});

	it("carries no prices or product IDs", () => {
		const text = JSON.stringify(planSnapshot(plusAccount));
		assert.equal(text.includes("price"), false);
		assert.equal(text.includes("product"), false);
	});
});
