/**
 * Windows-1252 by table. `TextDecoder("windows-1252")` is the right tool in a browser, but
 * Node answers that label with plain Latin-1 (bytes 0x80 to 0x9f come out as control
 * characters, not as curly quotes and dashes), and the parsers run under both. A table gives
 * the same text everywhere.
 */

/** Characters for bytes 0x80 to 0x9f. The five bytes Windows-1252 leaves undefined give U+FFFD. */
const HIGH = "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž�" + "�‘’“”•–—˜™š›œ�žŸ";

const CHUNK = 8192;

export function decodeWindows1252(bytes: Uint8Array): string {
	let out = "";
	for (let from = 0; from < bytes.length; from += CHUNK) {
		const end = Math.min(from + CHUNK, bytes.length);
		const units: number[] = new Array(end - from);
		for (let i = from; i < end; i++) {
			const byte = bytes[i] as number;
			units[i - from] =
				byte >= 0x80 && byte <= 0x9f ? HIGH.charCodeAt(byte - 0x80) : byte;
		}
		out += String.fromCharCode.apply(null, units);
	}
	return out;
}
