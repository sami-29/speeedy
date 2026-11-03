import type { LauncherPage } from "@speeedy/contracts";
import type { LibraryStore } from "../library/store.ts";
import { documentTitle } from "../library/title.ts";

/**
 * Keep a page the extension sent as a Library document and make it the one the reader
 * resumes. The source URL goes into the Library record and stays on the device: nothing here
 * sends it, or any text, anywhere.
 */
export async function saveLauncherPage(
	store: LibraryStore,
	page: LauncherPage,
): Promise<{ id: string; duplicate: boolean }> {
	const { meta, duplicate } = await store.addDocument({
		document: page.document,
		title: documentTitle(page.title, page.document),
		language: page.language,
		sourceUrl: page.url,
	});
	await store.setCurrent(meta.id);
	return { id: meta.id, duplicate };
}
