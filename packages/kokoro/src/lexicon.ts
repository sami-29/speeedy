/**
 * The lexicon half of misaki's US-English G2P (hexgrad/misaki `en.py`, Apache-2.0), ported
 * to TypeScript: dictionary growth, gold/silver lookup, stress rules, -s/-ed/-ing stemming,
 * letter spelling and number words. spaCy's part-of-speech tags are replaced by the
 * heuristic tags in `g2p.ts`. There is no espeak fallback: unknown words go to `oov()`.
 */

export type LexiconEntry = string | Record<string, string | null>;
export type LexiconData = {
	gold: Record<string, LexiconEntry>;
	silver: Record<string, LexiconEntry>;
};

/** What the lexicon needs to know about one token (or merged span of tokens). */
export type LexToken = {
	text: string;
	tag: string | null;
	isHead: boolean;
	currency?: string;
	stress?: number;
};

export type Context = { futureVowel: boolean | null; futureTo: boolean };

type Result = [string | null, number | null];
const NONE: Result = [null, null];

export const PRIMARY = "ˈ";
export const SECONDARY = "ˌ";
const STRESSES = "ˌˈ";
export const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");
export const CONSONANTS = new Set("bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ");
const US_TAUS = new Set("AIOWYiuæɑəɛɪɹʊʌ");
const DIPHTHONGS = new Set("AIOQWYʤʧ");
export const CURRENCIES: Record<string, [string, string]> = {
	$: ["dollar", "cent"],
	"£": ["pound", "pence"],
	"€": ["euro", "cent"],
};
const ORDINALS = new Set(["st", "nd", "rd", "th"]);
const SYMBOLS: Record<string, string> = {
	"%": "percent",
	"&": "and",
	"+": "plus",
	"@": "at",
};

const has = (d: object, key: string) => Object.hasOwn(d, key);
const lower = (s: string) => s.toLowerCase();
const upper = (s: string) => s.toUpperCase();
const capitalize = (s: string) =>
	s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
/** Python's str.isalpha(): non-empty and letters only. */
export const isAlpha = (s: string) => /^\p{L}+$/u.test(s);
const isDigit = (s: string) => /^[0-9]+$/.test(s);
/** Python's LEXICON_ORDS: apostrophe, hyphen and ASCII letters. */
const isLexChars = (s: string) => /^[A-Za-z'-]*$/.test(s);

function restress(ps: string): string {
	const chars = Array.from(ps);
	const keyed = chars.map((char, i) => ({ key: i, char }));
	chars.forEach((char, i) => {
		if (!STRESSES.includes(char)) return;
		const vowel = chars.findIndex((c, j) => j >= i && VOWELS.has(c));
		if (vowel >= 0) keyed[i] = { key: vowel - 0.5, char };
	});
	return keyed
		.sort(
			(a, b) =>
				a.key - b.key || (a.char < b.char ? -1 : a.char > b.char ? 1 : 0),
		)
		.map((k) => k.char)
		.join("");
}

export function applyStress(
	ps: string | null,
	stress: number | null | undefined,
): string | null {
	if (stress == null || ps == null) return ps;
	const hasPrimary = ps.includes(PRIMARY);
	const hasSecondary = ps.includes(SECONDARY);
	const hasVowel = Array.from(ps).some((c) => VOWELS.has(c));
	if (stress < -1) return ps.replaceAll(PRIMARY, "").replaceAll(SECONDARY, "");
	if (stress === -1 || ((stress === 0 || stress === -0.5) && hasPrimary)) {
		return ps.replaceAll(SECONDARY, "").replaceAll(PRIMARY, SECONDARY);
	}
	if ([0, 0.5, 1].includes(stress) && !hasPrimary && !hasSecondary) {
		return hasVowel ? restress(SECONDARY + ps) : ps;
	}
	if (stress >= 1 && !hasPrimary && hasSecondary) {
		return ps.replaceAll(SECONDARY, PRIMARY);
	}
	if (stress > 1 && !hasPrimary && !hasSecondary) {
		return hasVowel ? restress(PRIMARY + ps) : ps;
	}
	return ps;
}

export const stressWeight = (ps: string | null) =>
	ps ? Array.from(ps).reduce((a, c) => a + (DIPHTHONGS.has(c) ? 2 : 1), 0) : 0;

// num2words (English), as far as misaki uses it.
const ONES = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];
const TENS = [
	"",
	"",
	"twenty",
	"thirty",
	"forty",
	"fifty",
	"sixty",
	"seventy",
	"eighty",
	"ninety",
];
const SCALES: [number, string][] = [
	[1e12, "trillion"],
	[1e9, "billion"],
	[1e6, "million"],
	[1e3, "thousand"],
];

function under1000(n: number): string {
	const out: string[] = [];
	if (n >= 100) {
		out.push(`${ONES[Math.floor(n / 100)]} hundred`);
		n %= 100;
		if (n) out.push("and");
	}
	if (n >= 20)
		out.push(`${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`);
	else if (n > 0 || out.length === 0) out.push(ONES[n] ?? "");
	return out.join(" ");
}

export function cardinal(n: number): string {
	n = Math.floor(n);
	if (n < 0) return `minus ${cardinal(-n)}`;
	if (n < 1000) return under1000(n);
	const parts: string[] = [];
	for (const [value, name] of SCALES) {
		if (n >= value) {
			parts.push(`${cardinal(Math.floor(n / value))} ${name}`);
			n %= value;
		}
	}
	if (n) parts.push(`${n < 100 ? "and " : ""}${under1000(n)}`);
	return parts.join(", ");
}

const IRREGULAR_ORDINALS: Record<string, string> = {
	one: "first",
	two: "second",
	three: "third",
	five: "fifth",
	eight: "eighth",
	nine: "ninth",
	twelve: "twelfth",
};

export function ordinal(n: number): string {
	const words = cardinal(n);
	const last = /([a-z]+)$/.exec(words)?.[1] ?? "";
	const ord =
		IRREGULAR_ORDINALS[last] ??
		(last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
	return words.slice(0, words.length - last.length) + ord;
}

/** num2words' `to='year'`: 1984 is "nineteen eighty-four", 2005 "two thousand and five". */
export function year(n: number): string {
	const hi = Math.floor(n / 100);
	const lo = n % 100;
	if (hi === 0 || (hi % 10 === 0 && lo < 10) || hi >= 100) return cardinal(n);
	if (lo === 0) return `${cardinal(hi)} hundred`;
	return `${cardinal(hi)} ${lo < 10 ? `oh-${cardinal(lo)}` : cardinal(lo)}`;
}

function decimal(text: string): string {
	// num2words(float(text)): Python's float drops trailing zeros ("12.50" is 12.5).
	const [whole = "0", fraction = ""] = String(Number.parseFloat(text)).split(
		".",
	);
	const head = cardinal(Number.parseInt(whole, 10));
	if (!fraction) return head;
	return `${head} point ${Array.from(fraction, (d) => ONES[Number(d)]).join(" ")}`;
}

export class Lexicon {
	readonly golds: Record<string, LexiconEntry>;
	readonly silvers: Record<string, LexiconEntry>;
	private readonly capStresses = [0.5, 2] as const;

	constructor(data: LexiconData) {
		this.golds = Lexicon.grow(data.gold);
		this.silvers = Lexicon.grow(data.silver);
	}

	/** Add the capitalised form of lowercase keys and the lowercase form of capitalised ones. */
	static grow(d: Record<string, LexiconEntry>): Record<string, LexiconEntry> {
		const grown: Record<string, LexiconEntry> = {};
		for (const [k, v] of Object.entries(d)) {
			if (k.length < 2) continue;
			if (k === lower(k)) {
				if (k !== capitalize(k)) grown[capitalize(k)] = v;
			} else if (k === capitalize(lower(k))) grown[lower(k)] = v;
		}
		return Object.assign(grown, d);
	}

	hasGold(word: string): boolean {
		return has(this.golds, word);
	}

	/** Spell a word letter by letter from the gold letter entries (misaki's get_NNP). */
	getNNP(word: string): Result {
		const ps: string[] = [];
		for (const c of word) {
			if (!isAlpha(c)) continue;
			const p = has(this.golds, upper(c)) ? this.golds[upper(c)] : undefined;
			if (typeof p !== "string") return NONE;
			ps.push(p);
		}
		const s = applyStress(ps.join(""), 0) ?? "";
		const i = s.lastIndexOf(SECONDARY);
		return [i < 0 ? s : s.slice(0, i) + PRIMARY + s.slice(i + 1), 3];
	}

	private getSpecial(
		word: string,
		tag: string | null,
		stress: number | null,
		ctx: Context,
	): Result {
		const t = tag ?? "";
		if (has(SYMBOLS, word))
			return this.lookup(SYMBOLS[word] ?? "", null, null, ctx);
		if (
			word.replace(/^\.+|\.+$/g, "").includes(".") &&
			isAlpha(word.replaceAll(".", "")) &&
			Math.max(...word.split(".").map((x) => x.length)) < 3
		) {
			return this.getNNP(word);
		}
		if (word === "a" || word === "A") return [t === "DT" ? "ɐ" : "ˈA", 4];
		if (["am", "Am", "AM"].includes(word)) {
			if (t.startsWith("NN")) return this.getNNP(word);
			if (ctx.futureVowel == null || word !== "am" || (stress && stress > 0)) {
				return [this.entry(this.golds.am, null), 4];
			}
			return ["ɐm", 4];
		}
		if (["an", "An", "AN"].includes(word)) {
			if (word === "AN" && t.startsWith("NN")) return this.getNNP(word);
			return ["ɐn", 4];
		}
		if (word === "I" && t === "PRP") return [`${SECONDARY}I`, 4];
		if (["by", "By", "BY"].includes(word) && Lexicon.parentTag(tag) === "ADV") {
			return ["bˈI", 4];
		}
		if (
			word === "to" ||
			word === "To" ||
			(word === "TO" && ["TO", "IN"].includes(t))
		) {
			if (ctx.futureVowel == null) return [this.entry(this.golds.to, null), 4];
			return [ctx.futureVowel ? "tʊ" : "tə", 4];
		}
		if (word === "in" || word === "In" || (word === "IN" && t !== "NNP")) {
			return [`${ctx.futureVowel == null || t !== "IN" ? PRIMARY : ""}ɪn`, 4];
		}
		if (word === "the" || word === "The" || (word === "THE" && t === "DT")) {
			return [ctx.futureVowel === true ? "ði" : "ðə", 4];
		}
		if (t === "IN" && /^vs\.?$/i.test(word)) {
			return this.lookup("versus", null, null, ctx);
		}
		if (["used", "Used", "USED"].includes(word)) {
			const used = this.golds.used;
			const key = ["VBD", "JJ"].includes(t) && ctx.futureTo ? "VBD" : "DEFAULT";
			return [
				typeof used === "object" ? (used[key] ?? null) : (used ?? null),
				4,
			];
		}
		return NONE;
	}

	private entry(
		value: LexiconEntry | undefined,
		tag: string | null,
	): string | null {
		if (value == null) return null;
		if (typeof value === "string") return value;
		return (
			(tag != null && has(value, tag) ? value[tag] : value.DEFAULT) ?? null
		);
	}

	static parentTag(tag: string | null): string | null {
		if (tag == null) return tag;
		if (tag.startsWith("VB")) return "VERB";
		if (tag.startsWith("NN")) return "NOUN";
		if (tag.startsWith("ADV") || tag.startsWith("RB")) return "ADV";
		if (tag.startsWith("ADJ") || tag.startsWith("JJ")) return "ADJ";
		return tag;
	}

	isKnown(word: string): boolean {
		if (
			has(this.golds, word) ||
			has(SYMBOLS, word) ||
			has(this.silvers, word)
		) {
			return true;
		}
		if (!isAlpha(word) || !isLexChars(word)) return false;
		if (word.length === 1) return true;
		if (word === upper(word) && has(this.golds, lower(word))) return true;
		return word.slice(1) === upper(word.slice(1));
	}

	lookup(
		word: string,
		tag: string | null,
		stress: number | null,
		ctx: Context | null,
	): Result {
		let isNNP: boolean | null = null;
		if (word === upper(word) && !has(this.golds, word)) {
			word = lower(word);
			isNNP = tag === "NNP";
		}
		let ps: LexiconEntry | null = has(this.golds, word)
			? (this.golds[word] ?? null)
			: null;
		let rating = 4;
		if (ps == null && !isNNP) {
			ps = has(this.silvers, word) ? (this.silvers[word] ?? null) : null;
			rating = 3;
		}
		let phonemes: string | null;
		if (ps != null && typeof ps === "object") {
			let key = tag;
			if (ctx && ctx.futureVowel == null && has(ps, "None")) key = "None";
			else if (key == null || !has(ps, key)) key = Lexicon.parentTag(tag);
			phonemes = this.entry(ps, key);
		} else phonemes = ps;
		if (phonemes == null || (isNNP && !phonemes.includes(PRIMARY))) {
			const spelled = this.getNNP(word);
			if (spelled[0] != null) return spelled;
		}
		return [applyStress(phonemes, stress), rating];
	}

	private s(stem: string | null): string | null {
		if (!stem) return null;
		const last = stem.at(-1) ?? "";
		if ("ptkfθ".includes(last)) return `${stem}s`;
		if ("szʃʒʧʤ".includes(last)) return `${stem}ᵻz`;
		return `${stem}z`;
	}

	stemS(
		word: string,
		tag: string | null,
		stress: number | null,
		ctx: Context | null,
	): Result {
		if (word.length < 3 || !word.endsWith("s")) return NONE;
		let stem: string;
		if (!word.endsWith("ss") && this.isKnown(word.slice(0, -1)))
			stem = word.slice(0, -1);
		else if (
			(word.endsWith("'s") ||
				(word.length > 4 && word.endsWith("es") && !word.endsWith("ies"))) &&
			this.isKnown(word.slice(0, -2))
		) {
			stem = word.slice(0, -2);
		} else if (
			word.length > 4 &&
			word.endsWith("ies") &&
			this.isKnown(`${word.slice(0, -3)}y`)
		) {
			stem = `${word.slice(0, -3)}y`;
		} else return NONE;
		const [ps, rating] = this.lookup(stem, tag, stress, ctx);
		return [this.s(ps), rating];
	}

	private ed(stem: string | null): string | null {
		if (!stem) return null;
		const last = stem.at(-1) ?? "";
		if ("pkfθʃsʧ".includes(last)) return `${stem}t`;
		if (last === "d") return `${stem}ᵻd`;
		if (last !== "t") return `${stem}d`;
		if (stem.length < 2) return `${stem}ɪd`;
		if (US_TAUS.has(stem.at(-2) ?? "")) return `${stem.slice(0, -1)}ɾᵻd`;
		return `${stem}ᵻd`;
	}

	private stemEd(
		word: string,
		tag: string | null,
		stress: number | null,
		ctx: Context,
	): Result {
		if (word.length < 4 || !word.endsWith("d")) return NONE;
		let stem: string;
		if (!word.endsWith("dd") && this.isKnown(word.slice(0, -1)))
			stem = word.slice(0, -1);
		else if (
			word.length > 4 &&
			word.endsWith("ed") &&
			!word.endsWith("eed") &&
			this.isKnown(word.slice(0, -2))
		) {
			stem = word.slice(0, -2);
		} else return NONE;
		const [ps, rating] = this.lookup(stem, tag, stress, ctx);
		return [this.ed(ps), rating];
	}

	private ing(stem: string | null): string | null {
		if (!stem) return null;
		if (
			stem.length > 1 &&
			stem.at(-1) === "t" &&
			US_TAUS.has(stem.at(-2) ?? "")
		) {
			return `${stem.slice(0, -1)}ɾɪŋ`;
		}
		return `${stem}ɪŋ`;
	}

	private stemIng(
		word: string,
		tag: string | null,
		stress: number | null,
		ctx: Context,
	): Result {
		if (word.length < 5 || !word.endsWith("ing")) return NONE;
		let stem: string;
		if (word.length > 5 && this.isKnown(word.slice(0, -3)))
			stem = word.slice(0, -3);
		else if (this.isKnown(`${word.slice(0, -3)}e`))
			stem = `${word.slice(0, -3)}e`;
		else if (
			word.length > 5 &&
			/([bcdgklmnprstvxz])\1ing$|cking$/.test(word) &&
			this.isKnown(word.slice(0, -4))
		) {
			stem = word.slice(0, -4);
		} else return NONE;
		const [ps, rating] = this.lookup(stem, tag, stress, ctx);
		return [this.ing(ps), rating];
	}

	private getWord(
		word: string,
		tag: string | null,
		stress: number | null,
		ctx: Context,
	): Result {
		const special = this.getSpecial(word, tag, stress, ctx);
		if (special[0] != null) return special;
		const wl = lower(word);
		if (
			word.length > 1 &&
			isAlpha(word.replaceAll("'", "")) &&
			word !== wl &&
			(tag !== "NNP" || word.length > 7) &&
			!has(this.golds, word) &&
			!has(this.silvers, word) &&
			(word === upper(word) || word.slice(1) === lower(word.slice(1))) &&
			(has(this.golds, wl) ||
				has(this.silvers, wl) ||
				this.stemS(wl, tag, stress, ctx)[0] ||
				this.stemEd(wl, tag, stress, ctx)[0] ||
				this.stemIng(wl, tag, stress, ctx)[0])
		) {
			word = wl;
		}
		if (this.isKnown(word)) return this.lookup(word, tag, stress, ctx);
		if (word.endsWith("s'") && this.isKnown(`${word.slice(0, -2)}'s`)) {
			return this.lookup(`${word.slice(0, -2)}'s`, tag, stress, ctx);
		}
		if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) {
			return this.lookup(word.slice(0, -1), tag, stress, ctx);
		}
		for (const result of [
			this.stemS(word, tag, stress, ctx),
			this.stemEd(word, tag, stress, ctx),
			this.stemIng(word, tag, stress ?? 0.5, ctx),
		]) {
			if (result[0] != null) return result;
		}
		return NONE;
	}

	private static isCurrency(word: string): boolean {
		if (!word.includes(".")) return true;
		const parts = word.split(".");
		if (parts.length > 2) return false;
		return (parts[1] ?? "").length < 3;
	}

	private getNumber(
		word: string,
		currency: string | undefined,
		isHead: boolean,
	): Result {
		const suffix = /[a-z']+$/.exec(word)?.[0] ?? null;
		if (suffix) word = word.slice(0, -suffix.length);
		const result: Result[] = [];
		if (word.startsWith("-")) {
			result.push(this.lookup("minus", null, null, null));
			word = word.slice(1);
		}
		const extendWords = (words: string) => {
			for (const w of words.split(/[^a-z]+/)) {
				if (!w || w === "and") continue;
				result.push(this.lookup(w, null, w === "point" ? -2 : null, null));
			}
		};
		const extendNum = (n: string | number) => extendWords(cardinal(Number(n)));
		const isMoney = currency != null && has(CURRENCIES, currency);

		if (isDigit(word) && suffix != null && ORDINALS.has(suffix)) {
			extendWords(ordinal(Number(word)));
		} else if (
			result.length === 0 &&
			word.length === 4 &&
			!isMoney &&
			isDigit(word)
		) {
			extendWords(year(Number(word)));
		} else if (!isHead && !word.includes(".")) {
			const num = word.replaceAll(",", "");
			if (num[0] === "0" || num.length > 3) for (const d of num) extendNum(d);
			else if (num.length === 3 && !num.endsWith("00")) {
				extendNum(num[0] ?? "0");
				if (num[1] === "0") {
					result.push(this.lookup("O", null, -2, null));
					extendNum(num[2] ?? "0");
				} else extendNum(num.slice(1));
			} else extendNum(num);
		} else if (word.split(".").length > 2 || !isHead) {
			for (const num of word.replaceAll(",", "").split(".")) {
				if (!num) continue;
				if (
					num[0] === "0" ||
					(num.length !== 2 && Array.from(num.slice(1)).some((n) => n !== "0"))
				) {
					for (const d of num) extendNum(d);
				} else extendNum(num);
			}
		} else if (isMoney && Lexicon.isCurrency(word)) {
			const units = CURRENCIES[currency] as [string, string];
			let pairs = word
				.replaceAll(",", "")
				.split(".")
				.slice(0, 2)
				.map(
					(n, i) =>
						[n ? Number.parseInt(n, 10) : 0, units[i] as string] as const,
				);
			if (pairs.length > 1) {
				if (pairs[1]?.[0] === 0) pairs = pairs.slice(0, 1);
				else if (pairs[0]?.[0] === 0) pairs = pairs.slice(1);
			}
			pairs.forEach(([num, unit], i) => {
				if (i > 0) result.push(this.lookup("and", null, null, null));
				extendNum(num);
				result.push(
					Math.abs(num) !== 1 && unit !== "pence"
						? this.stemS(`${unit}s`, null, null, null)
						: this.lookup(unit, null, null, null),
				);
			});
		} else {
			const clean = word.replaceAll(",", "");
			if (isDigit(clean)) {
				extendWords(
					suffix != null && ORDINALS.has(suffix)
						? ordinal(Number(clean))
						: cardinal(Number(clean)),
				);
			} else if (clean.startsWith(".")) {
				extendWords(
					`point ${Array.from(clean.slice(1), (d) => ONES[Number(d)]).join(" ")}`,
				);
			} else if (/^\d+\.\d+$/.test(clean)) extendWords(decimal(clean));
			else return NONE;
		}
		if (result.length === 0 || result.some(([p]) => p == null)) return NONE;
		let ps: string | null = result.map(([p]) => p).join(" ");
		const rating = Math.min(...result.map(([, r]) => r ?? 0));
		if (suffix === "s" || suffix === "'s") ps = this.s(ps);
		else if (suffix === "ed" || suffix === "'d") ps = this.ed(ps);
		else if (suffix === "ing") ps = this.ing(ps);
		return [ps, rating];
	}

	private static isNumber(word: string, isHead: boolean): boolean {
		if (!/[0-9]/.test(word)) return false;
		for (const suffix of [
			"ing",
			"'d",
			"ed",
			"'s",
			"st",
			"nd",
			"rd",
			"th",
			"s",
		]) {
			if (word.endsWith(suffix)) {
				word = word.slice(0, -suffix.length);
				break;
			}
		}
		return Array.from(word).every(
			(c, i) => /[0-9,.]/.test(c) || (isHead && i === 0 && c === "-"),
		);
	}

	private appendCurrency(ps: string, currency: string | undefined): string {
		if (!currency || !has(CURRENCIES, currency)) return ps;
		const unit = this.stemS(
			`${CURRENCIES[currency]?.[0]}s`,
			null,
			null,
			null,
		)[0];
		return unit ? `${ps} ${unit}` : ps;
	}

	/** Pronounce one token in context, or return null when the lexicon does not know it. */
	call(tk: LexToken, ctx: Context): string | null {
		const word = tk.text
			.replaceAll("‘", "'")
			.replaceAll("’", "'")
			.normalize("NFKC");
		const stress =
			word === lower(word)
				? null
				: this.capStresses[word === upper(word) ? 1 : 0];
		const [ps] = this.getWord(word, tk.tag, stress, ctx);
		if (ps != null)
			return applyStress(this.appendCurrency(ps, tk.currency), tk.stress);
		if (Lexicon.isNumber(word, tk.isHead)) {
			return applyStress(
				this.getNumber(word, tk.currency, tk.isHead)[0],
				tk.stress,
			);
		}
		return null;
	}
}
