import type { Asset } from "./download";

const MODEL_REPO =
	"https://huggingface.co/mrfakename/Kokoro-7M-Distill-ONNX/resolve/2b3cb7963716406d0596568588ea360da6b168ce";
// misaki's US lexicon (hexgrad/misaki, Apache-2.0 repository; the data files carry no licence
// of their own), so it is fetched at runtime and never committed or bundled.
const LEXICON_REPO =
	"https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data";

/** Everything the on-device voice downloads, pinned by revision and sha256. */
export const KOKORO_ASSETS = {
	model: {
		key: "kokoro-7m/onnx/model.onnx",
		url: `${MODEL_REPO}/onnx/model.onnx`,
		bytes: 30_649_897,
		sha256: "14b6a25d57a05ebf28893f421af4086dd56f86f70ef0f2b74c7539515aeab041",
	},
	voice: {
		key: "kokoro-7m/voices/af_msa.bin",
		url: `${MODEL_REPO}/voices/af_msa.bin`,
		bytes: 522_240,
		sha256: "129d447a7c9bdce1d5b6cb5ecb789bbfd9f427b7775131a97dfa5638583b3b92",
	},
	gold: {
		key: "misaki/us_gold.json",
		url: `${LEXICON_REPO}/us_gold.json`,
		bytes: 3_000_469,
		sha256: "dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f",
	},
	silver: {
		key: "misaki/us_silver.json",
		url: `${LEXICON_REPO}/us_silver.json`,
		bytes: 3_099_517,
		sha256: "de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475",
	},
} as const satisfies Record<string, Asset>;

export type KokoroAssets = { [K in keyof typeof KOKORO_ASSETS]: Asset };

/**
 * The Cache Storage cache the voice keeps its model, lexicon and runtime in. The app's
 * service worker reads the runtime from it and never deletes it.
 */
export const KOKORO_CACHE = "speeedy-kokoro-v1";

/** The voice this build downloads (the model repo also has `af_heart`). */
export const DEFAULT_VOICE = "af_msa";

export const TOTAL_DOWNLOAD_BYTES = Object.values(KOKORO_ASSETS).reduce(
	(sum, asset) => sum + asset.bytes,
	0,
);

/** "37.3 MB": the size the consent prompt shows. */
export const formatBytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
