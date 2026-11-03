import { describe, expect, it } from "vitest";
import {
	bucketFor,
	createSpeedTrace,
	TRACE_BUCKETS,
} from "../src/lib/reader/speed-trace.ts";

describe("speed trace buckets", () => {
	it("splits the text into equal stretches, the end in the last one", () => {
		expect(bucketFor(0, 10)).toBe(0);
		expect(bucketFor(0.099, 10)).toBe(0);
		expect(bucketFor(0.1, 10)).toBe(1);
		expect(bucketFor(0.999, 10)).toBe(9);
		expect(bucketFor(1, 10)).toBe(9);
	});

	it("clamps progress outside 0 to 1", () => {
		expect(bucketFor(-3, 10)).toBe(0);
		expect(bucketFor(7, 10)).toBe(9);
		expect(bucketFor(Number.NaN, 10)).toBe(0);
	});
});

describe("the speed trace", () => {
	it("starts empty, with the default number of stretches", () => {
		const values = createSpeedTrace().values();
		expect(values).toHaveLength(TRACE_BUCKETS);
		expect(values.every((value) => value === null)).toBe(true);
	});

	it("keeps the speed a stretch was read at", () => {
		const trace = createSpeedTrace(4);
		trace.record(0.05, 250);
		trace.record(0.3, 400);
		expect(trace.values()).toEqual([250, 400, null, null]);
	});

	it("tells whether a record changed anything", () => {
		const trace = createSpeedTrace(4);
		expect(trace.record(0.1, 250)).toBe(true);
		expect(trace.record(0.2, 250)).toBe(false);
		expect(trace.record(0.2, 300)).toBe(true);
	});

	it("reads a stretch again at the new speed after a rewind", () => {
		const trace = createSpeedTrace(4);
		trace.record(0.1, 200);
		trace.record(0.6, 200);
		trace.record(0.1, 500);
		expect(trace.values()).toEqual([500, null, 200, null]);
	});

	it("returns a copy, so a caller cannot change the trace", () => {
		const trace = createSpeedTrace(2);
		trace.record(0, 250);
		const values = trace.values();
		values[0] = 1;
		expect(trace.values()[0]).toBe(250);
	});

	it("starts over on reset", () => {
		const trace = createSpeedTrace(2);
		trace.record(0.9, 250);
		trace.reset();
		expect(trace.values()).toEqual([null, null]);
	});
});
