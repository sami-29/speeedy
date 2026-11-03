import type { Target } from "../src/manifest.ts";

export type BuildOptions = {
	outDir: string;
	/** The Speeedy site this build sends pages to, for example `https://speeedy.app`. */
	origin: string;
	/** Dev builds carry the development key. Release builds leave the ID to the store. */
	dev: boolean;
	targets?: readonly Target[];
};

export async function buildExtension(_options: BuildOptions): Promise<void> {
	throw new Error("not implemented");
}
