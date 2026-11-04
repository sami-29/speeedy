export type NoiseKind = "white" | "pink" | "brown";

/** How much of the end is blended into the start so the loop has no seam, in samples at most. */
const SEAM_FRACTION = 0.1;

/**
 * Fill `data` with a loop of noise. White is flat hiss, pink falls off 3 dB an octave, brown
 * 6 dB: rain, wind, a distant roar. Each kind is levelled to a similar loudness, and the end
 * is blended into the start so the loop repeats without a click. `random` stands in for
 * `Math.random` in tests.
 */
export function fillNoise(
	kind: NoiseKind,
	data: Float32Array,
	random: () => number = Math.random,
): void {
	const length = data.length;
	const seam = Math.floor(length * SEAM_FRACTION);
	// Make `seam` extra samples past the end: they are blended into the start, so the
	// stream runs on from the last sample into the first without a step.
	const stream = new Float32Array(length + seam);
	generate(kind, stream, random);
	for (let i = 0; i < length; i++) data[i] = stream[i] ?? 0;
	for (let i = 0; i < seam; i++) {
		const fadeIn = i / seam;
		data[i] =
			(stream[i] ?? 0) * fadeIn + (stream[length + i] ?? 0) * (1 - fadeIn);
	}
	for (let i = 0; i < length; i++) {
		data[i] = Math.min(Math.max(data[i] ?? 0, -1), 1);
	}
}

function generate(
	kind: NoiseKind,
	out: Float32Array,
	random: () => number,
): void {
	if (kind === "white") {
		for (let i = 0; i < out.length; i++) out[i] = (random() * 2 - 1) * 0.5;
		return;
	}
	if (kind === "pink") {
		// Paul Kellet's filter over white noise.
		let b0 = 0;
		let b1 = 0;
		let b2 = 0;
		let b3 = 0;
		let b4 = 0;
		let b5 = 0;
		let b6 = 0;
		for (let i = 0; i < out.length; i++) {
			const white = random() * 2 - 1;
			b0 = 0.99886 * b0 + white * 0.0555179;
			b1 = 0.99332 * b1 + white * 0.0750759;
			b2 = 0.969 * b2 + white * 0.153852;
			b3 = 0.8665 * b3 + white * 0.3104856;
			b4 = 0.55 * b4 + white * 0.5329522;
			b5 = -0.7616 * b5 - white * 0.016898;
			out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
			b6 = white * 0.115926;
		}
		return;
	}
	// Brown: white noise through a leaky integrator.
	let last = 0;
	for (let i = 0; i < out.length; i++) {
		const white = random() * 2 - 1;
		last = (last + 0.02 * white) / 1.02;
		out[i] = last * 3.5;
	}
}
