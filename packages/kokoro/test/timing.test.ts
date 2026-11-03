import { describe, expect, it } from "vitest";
import { joinTimestamps } from "../src/index";
import cases from "./fixtures/join-timestamps.json" with { type: "json" };

describe("joinTimestamps", () => {
	// Expected values come from Kokoro's own `KPipeline.join_timestamps`, run in Python
	// over the same tokens and durations.
	for (const [n, testCase] of cases.entries()) {
		it(`matches the Python join_timestamps on case ${n + 1}`, () => {
			const got = joinTimestamps(testCase.tokens, testCase.durations);
			expect(got).toHaveLength(testCase.expected.length);
			got.forEach((span, i) => {
				expect(span.start).toBeCloseTo(testCase.expected[i]?.start ?? NaN, 9);
				expect(span.end).toBeCloseTo(testCase.expected[i]?.end ?? NaN, 9);
			});
		});
	}

	it("gives each token a non-decreasing span", () => {
		for (const testCase of cases) {
			let last = 0;
			for (const span of joinTimestamps(testCase.tokens, testCase.durations)) {
				expect(span.start).toBeGreaterThanOrEqual(last);
				expect(span.end).toBeGreaterThanOrEqual(span.start);
				last = span.end;
			}
		}
	});
});
