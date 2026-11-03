// Download the pinned Kokoro model, voice and misaki lexicon into `.cache` for the real-model
// tests and the RTF benchmark. Uses the same resumable, sha256-checked download as the
// browser, with a directory store. Nothing it writes is committed.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	formatBytes,
	KOKORO_ASSETS,
	TOTAL_DOWNLOAD_BYTES,
} from "../src/assets.ts";
import { type AssetStore, downloadAsset } from "../src/download.ts";

const cacheDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");

function dirStore(root: string): AssetStore {
	const path = (key: string) => join(root, key);
	return {
		async get(key) {
			return existsSync(path(key))
				? new Uint8Array(readFileSync(path(key)))
				: undefined;
		},
		async put(key, bytes) {
			mkdirSync(dirname(path(key)), { recursive: true });
			writeFileSync(path(key), bytes);
		},
		async delete(key) {
			rmSync(path(key), { force: true });
		},
		async keys() {
			if (!existsSync(root)) return [];
			return readdirSync(root, { recursive: true })
				.map(String)
				.filter((file) => statSync(join(root, file)).isFile())
				.map((file) => relative(root, join(root, file)));
		},
	};
}

const store = dirStore(cacheDir);
console.log(
	`Kokoro assets: ${formatBytes(TOTAL_DOWNLOAD_BYTES)} into ${cacheDir}`,
);
for (const [name, asset] of Object.entries(KOKORO_ASSETS)) {
	await downloadAsset(asset, { fetch, store });
	console.log(`  ${name}: ${asset.key} ok`);
}
