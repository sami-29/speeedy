import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	KOKORO_ASSETS,
	type KokoroSession,
	Lexicon,
	type LexiconData,
	type SessionInput,
} from "../src/index";

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const cacheDir = join(packageRoot, ".cache");

/**
 * A hand-written lexicon in misaki's notation, so unit tests run offline. The letter entries
 * match misaki's gold lexicon for those letters (checked against misaki 0.9.4).
 */
export const fixtureLexicon: LexiconData = {
	gold: {
		hello: "həlˈO",
		world: "wˈɜɹld",
		the: "ðə",
		cat: "kˈæt",
		sat: "sˈæt",
		on: "ˌɔn",
		mat: "mˈæt",
		apple: "ˈæpᵊl",
		stop: "stˈɑp",
		she: "ʃi",
		said: "sˈɛd",
		A: "ˈA",
		B: "bˈi",
		C: "sˈi",
		Q: "kjˈu",
		V: "vˈi",
		X: "ˈɛks",
		Y: "wˈI",
		Z: "zˈi",
	},
	silver: {},
};

/** Read a cached asset, downloading and checking it first when it is missing. */
export async function cachedAsset(
	name: keyof typeof KOKORO_ASSETS,
): Promise<Uint8Array> {
	const asset = KOKORO_ASSETS[name];
	const path = join(cacheDir, asset.key);
	if (!existsSync(path)) {
		const response = await fetch(asset.url);
		if (!response.ok) throw new Error(`${asset.url}: HTTP ${response.status}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, bytes);
	}
	const bytes = new Uint8Array(readFileSync(path));
	const sha = createHash("sha256").update(bytes).digest("hex");
	if (sha !== asset.sha256) throw new Error(`${asset.key}: sha256 ${sha}`);
	return bytes;
}

export const isCached = (name: keyof typeof KOKORO_ASSETS): boolean =>
	existsSync(join(cacheDir, KOKORO_ASSETS[name].key));

export async function realLexicon(): Promise<Lexicon> {
	const decode = (bytes: Uint8Array) =>
		JSON.parse(new TextDecoder().decode(bytes));
	return new Lexicon({
		gold: decode(await cachedAsset("gold")),
		silver: decode(await cachedAsset("silver")),
	});
}

/** A voice pack whose row r is filled with the value r, so a test can see which row was used. */
export function rowVoice(): Float32Array {
	const pack = new Float32Array(510 * 256);
	for (let row = 0; row < 510; row++)
		pack.fill(row, row * 256, (row + 1) * 256);
	return pack;
}

export type StubSession = KokoroSession & { calls: SessionInput[] };

/**
 * A recorded stand-in for the ONNX session: every token lasts `frames` duration frames
 * (the pads too), and the waveform has 600 samples per frame, as the real model does.
 */
export function stubSession(frames = 2): StubSession {
	const calls: SessionInput[] = [];
	return {
		calls,
		async run(input) {
			calls.push(input);
			const durations = Array.from(input.inputIds, () => frames);
			const total = durations.reduce((a, b) => a + b, 0);
			return {
				waveform: new Float32Array(total * 600),
				durations: BigInt64Array.from(durations.map(BigInt)),
			};
		},
	};
}
