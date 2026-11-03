/**
 * The ONNX Runtime adapter behind `KokoroSession`. It takes the runtime module as an argument
 * (`onnxruntime-web/wasm` in the worker, `onnxruntime-web` in Node tests) so nothing here
 * pulls the runtime into a bundle that does not need it.
 */
import { KokoroError, type KokoroSession } from "./generate";

type OrtTensor = { data: unknown; dims: readonly number[] };
type OrtSession = {
	readonly inputNames: readonly string[];
	readonly outputNames: readonly string[];
	run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
};
/** The slice of onnxruntime-web this adapter uses. */
export type OrtModule = {
	Tensor: new (
		type: "int64" | "float32",
		data: BigInt64Array | Float32Array,
		dims: readonly number[],
	) => OrtTensor;
	InferenceSession: {
		create(
			model: Uint8Array,
			options?: Record<string, unknown>,
		): Promise<OrtSession>;
	};
};

const INPUTS = ["input_ids", "style", "speed"];
const STYLE_SIZE = 256;

export async function createOrtSession(
	ort: OrtModule,
	model: Uint8Array,
	{ threads }: { threads: number },
): Promise<KokoroSession> {
	const session = await ort.InferenceSession.create(model, {
		executionProviders: ["wasm"],
		graphOptimizationLevel: "all",
		enableMemPattern: false,
		intraOpNumThreads: threads,
	});
	const missing = INPUTS.filter((name) => !session.inputNames.includes(name));
	if (missing.length) {
		throw new KokoroError(
			"bad-output",
			`model has no input ${missing.join(", ")}`,
		);
	}
	const waveformName = session.outputNames.find((name) =>
		/waveform|audio/.test(name),
	);
	const durationName = session.outputNames.find((name) =>
		/duration/.test(name),
	);
	if (!waveformName || !durationName) {
		throw new KokoroError(
			"bad-output",
			`model outputs ${session.outputNames.join(", ")}, expected a waveform and durations`,
		);
	}
	return {
		async run({ inputIds, style, speed }) {
			const outputs = await session.run({
				input_ids: new ort.Tensor("int64", inputIds, [1, inputIds.length]),
				style: new ort.Tensor("float32", style, [1, STYLE_SIZE]),
				speed: new ort.Tensor("float32", Float32Array.of(speed), [1]),
			});
			const waveform = outputs[waveformName]?.data;
			const durations = outputs[durationName]?.data;
			if (
				!(waveform instanceof Float32Array) ||
				!(durations instanceof BigInt64Array)
			) {
				throw new KokoroError("bad-output", "unexpected output tensor types");
			}
			return { waveform, durations };
		},
	};
}
