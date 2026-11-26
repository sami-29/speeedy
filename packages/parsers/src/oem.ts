/**
 * The IBM PC ("OEM") code pages 437 and 850 by table, for RTF's `\pc` and `\pca` and for an
 * `\ansicpgN` naming either. `TextDecoder` has no label for them: the Encoding Standard's only
 * DOS code page is 866, which RTF reads through `TextDecoder("ibm866")`.
 *
 * Source: the Unicode Consortium's copies of Microsoft's tables,
 * https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT and CP850.TXT (table
 * version 2.00, 04/24/96). In both, bytes 0x00 to 0x7f map to the same code point, and the
 * strings below are bytes 0x80 to 0xff in order, generated from those files and compared with
 * them entry by entry. The same check showed that `TextDecoder("ibm866")` matches CP866.TXT for
 * every byte from 0x80 to 0xff.
 */

const CP437 =
	"ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +
	"áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
	"└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
	"αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

const CP850 =
	"ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒ" +
	"áíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
	"└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" +
	"ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

const CHUNK = 8192;

function decodeHigh(bytes: Uint8Array, high: string): string {
	let out = "";
	for (let from = 0; from < bytes.length; from += CHUNK) {
		const end = Math.min(from + CHUNK, bytes.length);
		const units: number[] = new Array(end - from);
		for (let i = from; i < end; i++) {
			const byte = bytes[i] as number;
			units[i - from] = byte >= 0x80 ? high.charCodeAt(byte - 0x80) : byte;
		}
		out += String.fromCharCode.apply(null, units);
	}
	return out;
}

export function decodeCp437(bytes: Uint8Array): string {
	return decodeHigh(bytes, CP437);
}

export function decodeCp850(bytes: Uint8Array): string {
	return decodeHigh(bytes, CP850);
}
