/**
 * The relay page. It is the extension's own page, opened in a tab by the toolbar button or the
 * right-click entry. It reads the tab the reader was on, opens a Speeedy tab (which makes this
 * page that tab's opener) and posts the page to it once the tab says it is ready. The page
 * text goes nowhere else.
 */

import { type LauncherPage, validateLauncherPage } from "@speeedy/contracts";
import { type DeliverEnv, deliverPage, type Peer } from "./deliver.ts";
import type { ExtractFailure, ExtractResult } from "./extract.ts";
import { EXTRACTED } from "./messages.ts";

/** Replaced at build time with the Speeedy site this build sends pages to. */
declare const __SPEEEDY_ORIGIN__: string;

const WAIT_MS = 20_000;

const MESSAGES: Record<
	ExtractFailure | "no-access" | "refused" | "timeout",
	string
> = {
	"not-web-page":
		"Speeedy can only read web pages, not browser pages or files.",
	"no-access":
		"Speeedy could not read this tab. Click the Speeedy button again while you are on the page.",
	empty: "There is no text on this page to read.",
	"too-big": "This page is too large for Speeedy to open.",
	refused: "Speeedy could not keep this page.",
	timeout: "Speeedy did not answer. Check that it opened, then try again.",
};

const status = document.getElementById("status") as HTMLElement;
const action = document.getElementById("action") as HTMLButtonElement;

function show(text: string, button?: { label: string; run: () => void }) {
	status.textContent = text;
	if (button) {
		action.hidden = false;
		action.textContent = button.label;
		action.onclick = () => {
			action.hidden = true;
			button.run();
		};
		action.focus();
	} else {
		action.hidden = true;
	}
}

/** Run the extraction script in the tab and wait for the one message it sends back. */
function readTab(
	tabId: number,
): Promise<ExtractResult | { ok: false; reason: "no-access" }> {
	return new Promise((resolve) => {
		const onMessage = (
			message: unknown,
			sender: chrome.runtime.MessageSender,
		) => {
			// Only this extension's script in the tab being read counts.
			if (sender.id !== chrome.runtime.id || sender.tab?.id !== tabId) return;
			const body = message as { type?: unknown; result?: ExtractResult };
			if (body?.type !== EXTRACTED || !body.result) return;
			chrome.runtime.onMessage.removeListener(onMessage);
			resolve(body.result);
		};
		chrome.runtime.onMessage.addListener(onMessage);
		chrome.scripting
			.executeScript({ target: { tabId }, files: ["extract.js"] })
			.catch(() => {
				chrome.runtime.onMessage.removeListener(onMessage);
				resolve({ ok: false, reason: "no-access" });
			});
	});
}

const env: DeliverEnv = {
	open: () =>
		window.open(`${__SPEEEDY_ORIGIN__}/library`, "_blank") as Peer | null,
	addEventListener: (type, listener) => window.addEventListener(type, listener),
	removeEventListener: (type, listener) =>
		window.removeEventListener(type, listener),
};

async function send(page: LauncherPage): Promise<void> {
	show("Opening Speeedy…");
	const outcome = await deliverPage({
		env,
		targetOrigin: __SPEEEDY_ORIGIN__,
		page,
		timeoutMs: WAIT_MS,
	});
	if (outcome === "delivered") {
		show("Sent to Speeedy.");
		const current = await chrome.tabs.getCurrent();
		if (current?.id !== undefined) await chrome.tabs.remove(current.id);
		return;
	}
	if (outcome === "blocked") {
		// The browser held back the new tab because nothing here was a click. A click opens it.
		show("Your browser needs a click to open Speeedy.", {
			label: "Open Speeedy",
			run: () => void send(page),
		});
		return;
	}
	show(MESSAGES[outcome], { label: "Try again", run: () => void send(page) });
}

async function main(): Promise<void> {
	const tabId = Number(new URLSearchParams(location.search).get("tab"));
	if (!Number.isInteger(tabId) || tabId < 0) {
		show(MESSAGES["no-access"]);
		return;
	}
	show("Reading the page…");
	const result = await readTab(tabId);
	if (!result.ok) {
		show(MESSAGES[result.reason]);
		return;
	}
	// The page came from an injected script, so it is checked like anything else.
	const checked = validateLauncherPage(result.page);
	if (!checked.ok) {
		show(MESSAGES[checked.reason === "too-big" ? "too-big" : "empty"]);
		return;
	}
	await send(checked.page);
}

void main();
