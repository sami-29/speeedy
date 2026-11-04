import { LAUNCHER_LIMITS } from "@speeedy/contracts";

/**
 * What the OS share sheet leaves in the address bar. The manifest's `share_target` is a GET
 * to `/reader` with `title`, `text` and `url`, so a share arrives as a query string. It is
 * read once, then removed from the address bar; nothing here sends it anywhere.
 *
 * Android Chrome usually puts the page's address in `text`, so a bare URL there is the source
 * URL, and a URL at the end of a longer text is split off it. Speeedy never fetches the page
 * (the privacy promise, and the web would refuse anyway), so a share that holds only a link
 * has no text to read.
 */
export type ShareIntake =
	| { kind: "text"; title: string | null; text: string; url: string | null }
	| { kind: "link-only"; title: string | null; url: string };

/** The address if it is http(s) and within the length the Library keeps, else null. */
function webAddress(value: string | null | undefined): string | null {
	const candidate = value?.trim();
	if (!candidate || candidate.length > LAUNCHER_LIMITS.url) return null;
	try {
		const { protocol } = new URL(candidate);
		return protocol === "http:" || protocol === "https:" ? candidate : null;
	} catch {
		return null;
	}
}

export function readShareTarget(
	search: string | URLSearchParams,
): ShareIntake | null {
	const params =
		typeof search === "string" ? new URLSearchParams(search) : search;
	const title = params.get("title")?.trim().slice(0, LAUNCHER_LIMITS.title);
	let text = params.get("text")?.trim() ?? "";
	let url = webAddress(params.get("url"));
	if (!url) {
		// A link at the start or the end of the text is the page's address; one in the middle
		// of a sentence belongs to the text. Split by hand: a pattern over a hostile query
		// string could backtrack for a very long time.
		const words = text.split(/\s+/);
		const first = words[0] ?? "";
		const last = words.at(-1) ?? "";
		if (webAddress(first)) {
			url = first;
			text = text.slice(first.length).trim();
		} else if (webAddress(last)) {
			url = last;
			text = text.slice(0, text.length - last.length).trim();
		}
	} else if (text === url) {
		text = "";
	}

	if (text === "") {
		return url ? { kind: "link-only", title: title || null, url } : null;
	}
	return { kind: "text", title: title || null, text, url };
}
