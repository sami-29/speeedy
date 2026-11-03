/**
 * The script the relay page injects into the tab the reader is on. It runs in the extension's
 * isolated world, reads the page with Readability and hands the result to the extension's own
 * relay page. Nothing here talks to a network.
 */

import { extractPage } from "./extract.ts";
import { EXTRACTED } from "./messages.ts";

void extractPage({ dom: document, url: location.href }).then(
	(result) =>
		chrome.runtime.sendMessage({ type: EXTRACTED, result }).catch(() => {}),
	() =>
		chrome.runtime
			.sendMessage({
				type: EXTRACTED,
				result: { ok: false, reason: "empty" },
			})
			.catch(() => {}),
);
