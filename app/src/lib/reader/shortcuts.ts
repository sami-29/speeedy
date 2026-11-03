import type { BackUnit } from "@speeedy/engine";
import { WPM_BIG_STEP, WPM_STEP } from "./wpm.ts";

/** What a key press asks the reader to do. */
export type ReaderCommand =
	| { kind: "toggle" }
	| { kind: "back"; unit: BackUnit }
	| { kind: "speed"; delta: number }
	| { kind: "mode"; step: 1 | -1 }
	| { kind: "help" };

/** The part of the event target that decides whether a key is ours. */
export type KeyTarget = {
	tagName?: string;
	role?: string | null;
	isContentEditable?: boolean;
};

export type KeyInput = {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	target?: KeyTarget;
};

const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Space presses these, so the reader leaves Space to them. */
const PRESSABLE = new Set(["BUTTON", "A", "SUMMARY"]);
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * The reader command for a key press, or undefined when the key is not ours: held with
 * Ctrl, Meta or Alt; typed into a field; Space on a focused button or link, which presses
 * it; the arrows on a focused slider, which moves it.
 */
export function commandForKey(event: KeyInput): ReaderCommand | undefined {
	if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
	const tag = event.target?.tagName?.toUpperCase() ?? "";
	if (FIELDS.has(tag) || event.target?.isContentEditable) return undefined;
	const { key, shiftKey } = event;

	if (key === " " || key === "Spacebar") {
		return PRESSABLE.has(tag) ? undefined : { kind: "toggle" };
	}
	if (key === "k" || key === "K") return { kind: "toggle" };
	if (key === "m" || key === "M") {
		return { kind: "mode", step: shiftKey ? -1 : 1 };
	}
	if (key === "?") return { kind: "help" };

	if (ARROWS.has(key) && event.target?.role === "slider") return undefined;
	switch (key) {
		case "ArrowLeft":
			return { kind: "back", unit: shiftKey ? "paragraph" : "sentence" };
		case "ArrowUp":
			return { kind: "speed", delta: shiftKey ? WPM_BIG_STEP : WPM_STEP };
		case "ArrowDown":
			return { kind: "speed", delta: -(shiftKey ? WPM_BIG_STEP : WPM_STEP) };
		default:
			return undefined;
	}
}

export type ShortcutId =
	| "toggle"
	| "back"
	| "back_paragraph"
	| "speed"
	| "speed_big"
	| "mode"
	| "help";

/** The shortcuts the list shows, in order. The reader supplies the wording. */
export const SHORTCUTS: readonly { id: ShortcutId; keys: string[] }[] = [
	{ id: "toggle", keys: ["Space", "K"] },
	{ id: "back", keys: ["←"] },
	{ id: "back_paragraph", keys: ["Shift", "←"] },
	{ id: "speed", keys: ["↑", "↓"] },
	{ id: "speed_big", keys: ["Shift", "↑", "↓"] },
	{ id: "mode", keys: ["M"] },
	{ id: "help", keys: ["?"] },
];

/** The id of the mode `step` places after `current`, wrapping around. */
export function nextMode(
	ids: readonly string[],
	current: string,
	step: 1 | -1,
): string {
	const at = ids.indexOf(current);
	if (at < 0) return ids[0] ?? current;
	return ids[(at + step + ids.length) % ids.length] ?? current;
}
