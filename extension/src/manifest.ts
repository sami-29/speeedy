export type Target = "chrome" | "edge" | "firefox";

export const TARGETS: readonly Target[] = ["chrome", "edge", "firefox"];

/** The `ref` each store listing and the options page link carries. */
export const STORE_REF: Record<Target, string> = {
	chrome: "chrome-store",
	edge: "edge-store",
	firefox: "amo",
};

export type Manifest = Record<string, unknown>;

export function buildManifest(
	_target: Target,
	_options: { version: string; dev: boolean },
): Manifest {
	return {};
}
