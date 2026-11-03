/**
 * Text clean-up shared by every text format. All loops are single pass and copy by runs,
 * so a 100 MB file costs one scan and clean text comes back untouched.
 */

const FLUSH_AT = 8192;

/**
 * Normalise decoded text:
 * - CRLF, lone CR, form feed, NEL, U+2028 and U+2029 become `\n`
 * - other control characters, zero-width space, BOM and word joiner are dropped
 * - lone surrogates become U+FFFD so the result is always well-formed
 * Tabs, ZWJ and ZWNJ stay (ZWNJ matters in Persian).
 */
export function normalizeText(input: string): string {
	const length = input.length;
	let parts: string[] = [];
	let done = "";
	let runStart = 0;
	let changed = false;

	for (let i = 0; i < length; i++) {
		const code = input.charCodeAt(i);
		let replacement: string;
		let extra = 0;
		if (code < 32) {
			if (code === 10 || code === 9) continue;
			if (code === 13) {
				replacement = "\n";
				if (input.charCodeAt(i + 1) === 10) extra = 1;
			} else if (code === 12) {
				replacement = "\n";
			} else if (code === 11) {
				replacement = " ";
			} else {
				replacement = "";
			}
		} else if (code < 127) {
			continue;
		} else if (code <= 159) {
			replacement = code === 133 ? "\n" : "";
		} else if (code === 0x2028) {
			replacement = "\n";
		} else if (code === 0x2029) {
			replacement = "\n\n";
		} else if (code === 0x200b || code === 0xfeff || code === 0x2060) {
			replacement = "";
		} else if (code >= 0xd800 && code <= 0xdbff) {
			const next = input.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				i++;
				continue;
			}
			replacement = "�";
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			replacement = "�";
		} else {
			continue;
		}
		changed = true;
		parts.push(input.slice(runStart, i), replacement);
		i += extra;
		runStart = i + 1;
		if (parts.length >= FLUSH_AT) {
			done += parts.join("");
			parts = [];
		}
	}
	if (!changed) return input;
	parts.push(input.slice(runStart));
	return done + parts.join("");
}

export type ControlScan = { controls: number; nul: boolean };

/** Counts C0 control characters other than tab, line feed, carriage return and form feed. */
export function scanControls(text: string): ControlScan {
	let controls = 0;
	let nul = false;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code >= 32) continue;
		if (code === 9 || code === 10 || code === 13 || code === 12) continue;
		controls++;
		if (code === 0) nul = true;
	}
	return { controls, nul };
}

/** Collapse runs of spaces and tabs to one space (no regex backtracking, linear). */
export function collapseSpaces(text: string): string {
	return text.replace(/[ \t]+/g, " ");
}

/** True when the line has nothing but spaces and tabs. */
export function isBlank(line: string): boolean {
	for (let i = 0; i < line.length; i++) {
		const code = line.charCodeAt(i);
		if (code !== 32 && code !== 9) return false;
	}
	return true;
}

/** Replace control characters and whitespace runs with a single space, then trim. */
export function tidyLine(text: string): string {
	let out = "";
	let pendingSpace = false;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		const isSpace =
			code <= 32 || (code >= 127 && code <= 159) || code === 0x2028;
		if (isSpace) {
			pendingSpace = out.length > 0;
			continue;
		}
		if (code === 0x200b || code === 0xfeff || code === 0x2060) continue;
		if (pendingSpace) out += " ";
		pendingSpace = false;
		out += char;
	}
	return out;
}

/** Cut to at most `max` UTF-16 units without leaving half of a surrogate pair. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	let end = max;
	const last = text.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end--;
	return text.slice(0, end);
}
