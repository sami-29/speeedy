import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot } from "./helpers";

const sources = readdirSync(join(packageRoot, "src"), { recursive: true })
	.map(String)
	.filter((file) => /\.ts$/.test(file))
	.map((file) => ({
		file,
		text: readFileSync(join(packageRoot, "src", file), "utf8"),
	}));

describe("source rules", () => {
	it("never changes speed through playbackRate; speed is set at generation", () => {
		expect(sources.filter(({ text }) => /playbackRate/.test(text))).toEqual([]);
	});

	it("imports no GPL phonemizer (eSpeak, phonemizer, kokoro-js)", () => {
		const banned =
			/from\s+["'](?:[^"']*espeak[^"']*|phonemizer|kokoro-js)["']/i;
		expect(
			sources.filter(({ text }) => banned.test(text)).map((s) => s.file),
		).toEqual([]);
		const pkg = JSON.parse(
			readFileSync(join(packageRoot, "package.json"), "utf8"),
		);
		const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
		expect(deps.filter((d) => /espeak|phonemizer|kokoro-js/i.test(d))).toEqual(
			[],
		);
	});

	it("does not commit the model or the lexicon data", () => {
		const files = readdirSync(packageRoot, { recursive: true })
			.map(String)
			.filter((f) => !f.startsWith("node_modules") && !f.startsWith(".cache"));
		expect(
			files.filter((f) => /\.(onnx|bin)$|us_(gold|silver)\.json$/.test(f)),
		).toEqual([]);
	});
});
