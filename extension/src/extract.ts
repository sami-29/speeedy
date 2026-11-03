import type { LAUNCHER_LIMITS, LauncherPage } from "@speeedy/contracts";

export type ExtractFailure = "not-web-page" | "empty" | "too-big";

export type ExtractResult =
	| { ok: true; page: LauncherPage }
	| { ok: false; reason: ExtractFailure };

export async function extractPage(
	_source: { dom: globalThis.Document; url: string },
	_options?: { limits?: Partial<typeof LAUNCHER_LIMITS> },
): Promise<ExtractResult> {
	return { ok: false, reason: "empty" };
}
