import type { LauncherPage } from "@speeedy/contracts";
import type { LibraryStore } from "../library/store.ts";

export async function saveLauncherPage(
	_store: LibraryStore,
	_page: LauncherPage,
): Promise<{ id: string; duplicate: boolean }> {
	throw new Error("not implemented");
}
