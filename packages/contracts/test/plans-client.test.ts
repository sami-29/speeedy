// Seam: the app's typed client for the Worker's plan endpoint.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type FetchLike,
	readPlan,
	snapshotHasFeature,
	snapshotLimit,
} from "../src/plans.ts";

const FREE = {
	plan: "free",
	features: { sync: false, serverVoices: false },
	limits: { voiceHoursPerMonth: 0, syncBytes: 0, syncDocumentBytes: 0 },
};
const PLUS = {
	plan: "plus",
	features: { sync: true, serverVoices: true },
	limits: {
		voiceHoursPerMonth: 20,
		syncBytes: 1_000_000_000,
		syncDocumentBytes: 100_000_000,
	},
};

function fetchReturning(
	body: unknown,
	init: ResponseInit = {},
): { fetch: FetchLike; urls: string[] } {
	const urls: string[] = [];
	const fake: FetchLike = async (input) => {
		urls.push(input);
		return Response.json(body, init);
	};
	return { fetch: fake, urls };
}

describe("readPlan", () => {
	it("asks /api/plan and returns the Worker's features and limits", async () => {
		const { fetch, urls } = fetchReturning(PLUS);
		const snapshot = await readPlan(fetch);
		assert.deepEqual(urls, ["/api/plan"]);
		assert.deepEqual(snapshot, PLUS);
		assert.equal(snapshotHasFeature(snapshot, "sync"), true);
		assert.equal(snapshotLimit(snapshot, "voiceHoursPerMonth"), 20);
	});

	it("reads the free plan as no features and zero limits", async () => {
		const snapshot = await readPlan(fetchReturning(FREE).fetch);
		assert.equal(snapshotHasFeature(snapshot, "serverVoices"), false);
		assert.equal(snapshotLimit(snapshot, "syncBytes"), 0);
	});

	it("falls back to the free plan when the request fails", async () => {
		const failing: FetchLike = async () => {
			throw new TypeError("offline");
		};
		assert.deepEqual(await readPlan(failing), FREE);
	});

	it("falls back to the free plan on an error status", async () => {
		const { fetch } = fetchReturning(PLUS, { status: 500 });
		assert.deepEqual(await readPlan(fetch), FREE);
	});

	it("falls back to the free plan when the body is not a plan", async () => {
		for (const body of [
			null,
			"plus",
			{},
			{ plan: "plus" },
			{ ...PLUS, features: { sync: "yes", serverVoices: true } },
			{ ...PLUS, limits: { ...PLUS.limits, voiceHoursPerMonth: -1 } },
			{ ...PLUS, plan: "gold" },
		]) {
			const snapshot = await readPlan(fetchReturning(body).fetch);
			assert.deepEqual(snapshot, FREE, JSON.stringify(body));
		}
	});
});
