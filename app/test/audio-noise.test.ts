import { describe, expect, it } from "vitest";
import { fillNoise, type NoiseKind } from "../src/lib/audio/noise.ts";

/** A repeatable stream in [0, 1): a small linear congruential generator. */
function seeded(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

const make = (kind: NoiseKind, length = 48_000) => {
	const data = new Float32Array(length);
	fillNoise(kind, data, seeded(7));
	return data;
};

const rms = (data: Float32Array) =>
	Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);

/** Mean absolute step between neighbours: high for hiss, low for rumble. */
const roughness = (data: Float32Array) => {
	let sum = 0;
	for (let i = 1; i < data.length; i++) {
		sum += Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0));
	}
	return sum / (data.length - 1);
};

describe("noise", () => {
	for (const kind of ["white", "pink", "brown"] as const) {
		it(`${kind} noise fills the buffer, stays inside [-1, 1] and is audible`, () => {
			const data = make(kind);
			expect(data.every((x) => x >= -1 && x <= 1)).toBe(true);
			expect(rms(data)).toBeGreaterThan(0.05);
		});

		it(`${kind} noise loops without a step at the seam`, () => {
			const data = make(kind);
			const seam = Math.abs((data[0] ?? 0) - (data[data.length - 1] ?? 0));
			// The step across the seam is no bigger than a typical step inside the noise.
			expect(seam).toBeLessThan(roughness(data) * 6);
		});

		it(`${kind} noise is the same for the same random stream`, () => {
			expect(make(kind)).toEqual(make(kind));
		});
	}

	it("gets smoother from white to pink to brown", () => {
		const white = roughness(make("white"));
		const pink = roughness(make("pink"));
		const brown = roughness(make("brown"));
		expect(white).toBeGreaterThan(pink);
		expect(pink).toBeGreaterThan(brown);
	});

	it("balances the kinds so that none is much louder than another", () => {
		const levels = (["white", "pink", "brown"] as const).map((k) =>
			rms(make(k)),
		);
		expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(3);
	});

	it("handles a buffer too short to crossfade", () => {
		const data = new Float32Array(8);
		expect(() => fillNoise("white", data, seeded(1))).not.toThrow();
	});
});
