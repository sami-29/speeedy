/**
 * The extension's background: the toolbar button and the right-click entry. Either one opens
 * the relay page for the tab the reader is on; the relay does the work. The background holds
 * no page text and makes no requests.
 */

const MENU_ID = "speeedy-send-page";

/** Replaced at build time. True only in the end-to-end build. */
declare const __SPEEEDY_E2E__: boolean;

export function launch(tab: chrome.tabs.Tab | undefined): void {
	if (tab?.id === undefined) return;
	void chrome.tabs.create({
		url: chrome.runtime.getURL(`relay.html?tab=${tab.id}`),
		index: tab.index + 1,
		openerTabId: tab.id,
	});
}

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: MENU_ID,
		title: "Send page to Speeedy",
		contexts: ["page", "action"],
	});
});

chrome.action.onClicked.addListener((tab) => launch(tab));

chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId === MENU_ID) launch(tab);
});

if (__SPEEEDY_E2E__) {
	(globalThis as Record<string, unknown>).speeedyLaunch = launch;
}
