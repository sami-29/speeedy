import { localizeHref } from "#lib/paraglide/runtime.js";
import { goto } from "$app/navigation";
import { handOff } from "./handoff.ts";
import type { ReaderSource } from "./open.ts";
import type { ReaderPreset } from "./settings.ts";

/**
 * Sends what a public page's paste or drop box collected to /reader. It goes through memory,
 * never through the URL, so the text cannot reach a server or a log.
 */
export function startReader(source: ReaderSource, preset?: ReaderPreset): void {
	handOff(
		source.kind === "text"
			? { text: source.text, source: "own", preset }
			: { file: source.file, source: "own", preset },
	);
	void goto(localizeHref("/reader"));
}
