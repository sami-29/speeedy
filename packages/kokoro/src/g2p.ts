/**
 * Text to Kokoro phonemes, following misaki's US-English G2P (hexgrad/misaki `en.py`,
 * Apache-2.0): tokens are retokenized, pronounced right to left so each word knows whether
 * the next one starts with a vowel, and merged back. spaCy's tagger is replaced by a few
 * local rules (`tagTokens`); the lexicon lookups only need tags for a handful of words.
 *
 * Every phoneme token is assigned to the engine word (`tokenize` in @speeedy/engine) whose
 * text contains it, so the caller can time exactly one word per text word.
 */
import { tokenize } from "@speeedy/engine";
import {
	applyStress,
	CONSONANTS,
	type Context,
	CURRENCIES,
	isAlpha,
	type Lexicon,
	PRIMARY,
	stressWeight,
	VOWELS,
} from "./lexicon";
import { VOCAB } from "./vocab";

export type PhonemeToken = { phonemes: string; whitespace: boolean };
export type PhonemizedWord = { text: string; tokens: PhonemeToken[] };
export type Phonemized = { phonemes: string; words: PhonemizedWord[] };
/** Pronounce a word the lexicon does not know. Return "" to leave it silent. */
export type Oov = (word: string) => string;
export type PhonemizeOptions = { oov?: Oov };

type Kind = "word" | "num" | "sym" | "punct";

type Tok = {
	text: string;
	tag: string | null;
	whitespace: boolean;
	start: number;
	phonemes: string | null;
	isHead: boolean;
	prespace: boolean;
	currency?: string;
};

type Raw = {
	text: string;
	kind: Kind;
	start: number;
	whitespace: boolean;
	tag: string | null;
};

const PUNCTS = new Set(';:,.!?—…"“”');
const NON_QUOTE_PUNCTS = new Set(";:,.!?—…");
const SUBTOKEN_JUNKS = new Set("',-._‘’/");
const PUNCT_TAGS = new Set([
	".",
	",",
	"-LRB-",
	"-RRB-",
	"``",
	'""',
	"''",
	":",
	"$",
	"#",
	"NFP",
]);
const PUNCT_TAG_PHONEMES: Record<string, string> = {
	"-LRB-": "(",
	"-RRB-": ")",
	"``": "“",
	'""': "”",
	"''": "”",
};

const TOKEN_RE =
	/(\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*['’]?)|((?:(?<![\d\p{L}])-)?\d+(?:,\d{3})*(?:\.\d+)?(?:st|nd|rd|th|s|'s|ed|ing)?|\.\d+)|([$£€%&+@])|(\.\.\.|[—–-]+|[^\s\p{L}\p{M}\d])/gu;
const SUBTOKEN_RE =
	/^['‘’]+|\p{Lu}(?=\p{Lu}\p{Ll})|(?:^-)?(?:\d?[,.]?\d)+|[-_]+|['‘’]{2,}|\p{L}*?(?:['‘’]\p{L})*?\p{Ll}(?=\p{Lu})|\p{L}+(?:['‘’]\p{L})*|[^-_\p{L}'‘’\d]|['‘’]+$/gu;

const DETERMINERS = new Set([
	"the",
	"a",
	"an",
	"my",
	"your",
	"his",
	"her",
	"its",
	"our",
	"their",
	"this",
	"these",
	"those",
	"some",
	"any",
	"every",
	"each",
]);
const VERB_CUES = new Set([
	"to",
	"will",
	"would",
	"can",
	"could",
	"should",
	"shall",
	"may",
	"might",
	"must",
	"don't",
	"doesn't",
	"didn't",
	"won't",
	"can't",
	"please",
	"let's",
]);
/** Words after which "that" introduces a clause rather than pointing at something. */
const CLAUSE_STARTS = new Set([
	"i",
	"you",
	"he",
	"she",
	"it",
	"we",
	"they",
	"there",
	"the",
	"a",
	"an",
	"is",
	"was",
	"are",
	"were",
	"has",
	"had",
	"have",
	"will",
	"would",
	"can",
	"could",
	"should",
	"may",
	"might",
	"must",
	"does",
	"did",
	"do",
]);
const SENTENCE_ENDS = new Set([".", "!", "?", "…", "..."]);
const OPENING = new Set(["(", "[", "{", "“", "‘"]);

function lexTokens(text: string): Raw[] {
	const raw: Raw[] = [];
	for (const match of text.matchAll(TOKEN_RE)) {
		const start = match.index ?? 0;
		const kind: Kind = match[1]
			? "word"
			: match[2]
				? "num"
				: match[3]
					? "sym"
					: "punct";
		const prev = raw.at(-1);
		if (prev)
			prev.whitespace = /\s/u.test(
				text.slice(prev.start + prev.text.length, start),
			);
		raw.push({ text: match[0], kind, start, whitespace: false, tag: null });
	}
	const last = raw.at(-1);
	if (last)
		last.whitespace = /\s/u.test(text.slice(last.start + last.text.length));
	return raw;
}

const isCapitalised = (word: string) => /^\p{Lu}/u.test(word);

/** Part-of-speech tags for the few decisions misaki makes with spaCy's tags. */
function tagTokens(raw: Raw[]): void {
	let inDoubleQuote = false;
	let sentenceStart = true;
	raw.forEach((tk, i) => {
		const prev = raw[i - 1];
		const next = raw[i + 1];
		const lower = tk.text.toLowerCase();
		if (tk.kind === "num") tk.tag = "CD";
		else if (tk.kind === "sym")
			tk.tag = Object.hasOwn(CURRENCIES, tk.text) ? "$" : "NN";
		else if (tk.kind === "punct") {
			const t = tk.text;
			const touchesBoth =
				!!prev && !prev.whitespace && !!next && !tk.whitespace;
			if ("([{".includes(t)) tk.tag = "-LRB-";
			else if (")]}".includes(t)) tk.tag = "-RRB-";
			else if (t === '"') {
				tk.tag = inDoubleQuote ? "''" : "``";
				inDoubleQuote = !inDoubleQuote;
			} else if (t === "“" || t === "‘") tk.tag = "``";
			else if (t === "”" || t === "’") tk.tag = "''";
			else if (t === "'") tk.tag = next && !tk.whitespace ? "``" : "''";
			else if ((t === "-" || t === "–") && touchesBoth) tk.tag = "HYPH";
			else if (/^[—–-]+$|^\.\.\.$|^[;:…]$/u.test(t)) tk.tag = ":";
			else if (t === ",") tk.tag = ",";
			else if (".!?".includes(t)) tk.tag = ".";
			else tk.tag = "NFP";
		} else {
			const prevWord = prev?.kind === "word" ? prev.text.toLowerCase() : null;
			if (lower === "a") tk.tag = next?.text === "." ? "NN" : "DT";
			else if (tk.text === "I") tk.tag = "PRP";
			else if (lower === "in") tk.tag = "IN";
			else if (lower === "to") tk.tag = "TO";
			else if (lower === "used") tk.tag = "VBD";
			else if (lower === "that") {
				const nextWord = next?.kind === "word" ? next.text.toLowerCase() : null;
				tk.tag =
					!sentenceStart && nextWord && CLAUSE_STARTS.has(nextWord)
						? "IN"
						: "DT";
			} else if (DETERMINERS.has(lower)) tk.tag = "DT";
			else if (prevWord && DETERMINERS.has(prevWord)) tk.tag = "NN";
			else if (prevWord && VERB_CUES.has(prevWord)) tk.tag = "VB";
			else if (!sentenceStart && isCapitalised(tk.text)) tk.tag = "NNP";
		}
		if (tk.kind === "punct") {
			if (SENTENCE_ENDS.has(tk.text)) sentenceStart = true;
			else if (!OPENING.has(tk.text) && tk.tag !== "``") sentenceStart = false;
		} else sentenceStart = false;
	});
}

function subtokens(tk: Raw): Tok[] {
	const pieces = [...tk.text.matchAll(SUBTOKEN_RE)];
	const parts = pieces.length ? pieces : [{ 0: tk.text, index: 0 }];
	return parts.map((piece, j) => ({
		text: piece[0],
		tag: tk.tag,
		whitespace: j === parts.length - 1 ? tk.whitespace : false,
		start: tk.start + (piece.index ?? 0),
		phonemes: null,
		isHead: true,
		prespace: false,
	}));
}

const asciiLetters = (text: string) => /^[a-zA-Z]+$/.test(text);

/** misaki's retokenize: punctuation and currency get their phonemes, unspaced runs group. */
function retokenize(raw: Raw[]): (Tok | Tok[])[] {
	const words: (Tok | Tok[])[] = [];
	let currency: string | null = null;
	raw.forEach((token, i) => {
		const tks = subtokens(token);
		tks.forEach((tk, j) => {
			if (tk.tag === "$" && Object.hasOwn(CURRENCIES, tk.text)) {
				currency = tk.text;
				tk.phonemes = "";
			} else if (tk.tag === ":" && (tk.text === "-" || tk.text === "–")) {
				tk.phonemes = "—";
			} else if (
				tk.tag != null &&
				PUNCT_TAGS.has(tk.tag) &&
				!asciiLetters(tk.text)
			) {
				tk.phonemes =
					PUNCT_TAG_PHONEMES[tk.tag] ??
					Array.from(tk.text)
						.filter((c) => PUNCTS.has(c))
						.join("");
			} else if (currency != null) {
				if (tk.tag !== "CD") currency = null;
				else if (j + 1 === tks.length && raw[i + 1]?.tag !== "CD")
					tk.currency = currency;
			}
			const last = words.at(-1);
			if (tk.phonemes != null) words.push(tk);
			else if (Array.isArray(last) && !last.at(-1)?.whitespace) {
				tk.isHead = false;
				last.push(tk);
			} else words.push(tk.whitespace ? tk : [tk]);
		});
	});
	return words.map((w) =>
		Array.isArray(w) && w.length === 1 ? (w[0] as Tok) : w,
	);
}

function tokenContext(
	ctx: Context,
	ps: string | null,
	tk: { text: string; tag: string | null },
): Context {
	let futureVowel = ctx.futureVowel;
	if (ps) {
		for (const c of ps) {
			if (VOWELS.has(c) || CONSONANTS.has(c) || NON_QUOTE_PUNCTS.has(c)) {
				futureVowel = NON_QUOTE_PUNCTS.has(c) ? null : VOWELS.has(c);
				break;
			}
		}
	}
	const futureTo =
		tk.text === "to" ||
		tk.text === "To" ||
		(tk.text === "TO" && (tk.tag === "TO" || tk.tag === "IN"));
	return { futureVowel, futureTo };
}

const weight = (text: string) =>
	Array.from(text).reduce((a, c) => a + (c === c.toLowerCase() ? 1 : 2), 0);

function merge(span: Tok[]) {
	const tag = span.reduce((best, tk) =>
		weight(tk.text) > weight(best.text) ? tk : best,
	).tag;
	const currencies = span
		.map((tk) => tk.currency)
		.filter((c): c is string => c != null);
	return {
		text: span
			.map(
				(tk, i) => tk.text + (i < span.length - 1 && tk.whitespace ? " " : ""),
			)
			.join(""),
		tag,
		isHead: span[0]?.isHead ?? true,
		currency: currencies.length ? currencies.sort().at(-1) : undefined,
	};
}

const allJunk = (text: string) =>
	Array.from(text).every((c) => SUBTOKEN_JUNKS.has(c));

/** misaki's resolve_tokens: punctuation, spacing and stress inside one unspaced group. */
function resolveGroup(tokens: Tok[]): void {
	const text = merge(tokens).text;
	const classes = new Set(
		Array.from(text)
			.filter((c) => !SUBTOKEN_JUNKS.has(c))
			.map((c) => (isAlpha(c) ? 0 : /[0-9]/.test(c) ? 1 : 2)),
	);
	const prespace = text.includes(" ") || text.includes("/") || classes.size > 1;
	tokens.forEach((tk, i) => {
		if (tk.phonemes == null) {
			if (i === tokens.length - 1 && NON_QUOTE_PUNCTS.has(tk.text))
				tk.phonemes = tk.text;
			else if (allJunk(tk.text)) tk.phonemes = "";
		} else if (i > 0) tk.prespace = prespace;
	});
	if (prespace) return;
	let indices = tokens.flatMap((tk, i) =>
		tk.phonemes
			? [
					{
						primary: tk.phonemes.includes(PRIMARY),
						weight: stressWeight(tk.phonemes),
						i,
					},
				]
			: [],
	);
	const demote = (i: number) => {
		const tk = tokens[i];
		if (tk) tk.phonemes = applyStress(tk.phonemes, -0.5);
	};
	if (indices.length === 2 && tokens[indices[0]?.i ?? 0]?.text.length === 1) {
		demote(indices[1]?.i ?? 0);
		return;
	}
	const primaries = indices.filter((x) => x.primary).length;
	if (indices.length < 2 || primaries <= Math.floor((indices.length + 1) / 2))
		return;
	indices = indices
		.sort(
			(a, b) =>
				Number(a.primary) - Number(b.primary) ||
				a.weight - b.weight ||
				a.i - b.i,
		)
		.slice(0, Math.floor(indices.length / 2));
	for (const { i } of indices) demote(i);
}

const stripMarks = (word: string) =>
	word.normalize("NFD").replace(/\p{M}/gu, "");

/** Spell a word letter by letter through the lexicon's letter entries; "" if it cannot. */
export function spellLetters(word: string, lexicon: Lexicon): string {
	return lexicon.getNNP(word)[0] ?? lexicon.getNNP(stripMarks(word))[0] ?? "";
}

function pronounce(
	lexicon: Lexicon,
	tk: ReturnType<typeof merge>,
	ctx: Context,
): string | null {
	const ps = lexicon.call(tk, ctx);
	if (ps != null) return ps;
	const plain = stripMarks(tk.text);
	return plain !== tk.text ? lexicon.call({ ...tk, text: plain }, ctx) : null;
}

function resolve(words: (Tok | Tok[])[], lexicon: Lexicon, oov: Oov): void {
	let ctx: Context = { futureVowel: null, futureTo: false };
	for (let n = words.length - 1; n >= 0; n--) {
		const w = words[n] as Tok | Tok[];
		if (!Array.isArray(w)) {
			if (w.phonemes == null)
				w.phonemes = pronounce(lexicon, merge([w]), ctx) ?? oov(w.text);
			ctx = tokenContext(ctx, w.phonemes, w);
			continue;
		}
		let left = 0;
		let right = w.length;
		let fallback = false;
		while (left < right) {
			const span = w.slice(left, right);
			const tk = span.some((x) => x.phonemes != null) ? null : merge(span);
			const ps = tk ? pronounce(lexicon, tk, ctx) : null;
			if (tk && ps != null) {
				(w[left] as Tok).phonemes = ps;
				for (const x of w.slice(left + 1, right)) x.phonemes = "";
				ctx = tokenContext(ctx, ps, tk);
				right = left;
				left = 0;
			} else if (left + 1 < right) left++;
			else {
				right--;
				const last = w[right] as Tok;
				if (last.phonemes == null) {
					if (!allJunk(last.text)) {
						fallback = true;
						break;
					}
					last.phonemes = "";
				}
				left = 0;
			}
		}
		if (fallback) {
			const tk = merge(w);
			w.forEach((x, i) => {
				x.phonemes = i === 0 ? oov(tk.text) : "";
				x.prespace = false;
			});
			ctx = tokenContext(ctx, w[0]?.phonemes ?? null, tk);
		} else resolveGroup(w);
	}
}

const toVocab = (ps: string) =>
	Array.from(ps.replaceAll("ɾ", "T").replaceAll("ʔ", "t"))
		.filter((c) => VOCAB.has(c) && c !== " ")
		.join("");

/** Turn one sentence into Kokoro phonemes, grouped by the engine's words. */
export function phonemize(
	text: string,
	lexicon: Lexicon,
	options: PhonemizeOptions = {},
): Phonemized {
	const oov = options.oov ?? ((word: string) => spellLetters(word, lexicon));
	const raw = lexTokens(text);
	tagTokens(raw);
	const grouped = retokenize(raw);
	resolve(grouped, lexicon, oov);

	// Flatten to per-subtoken output, with misaki's in-group spaces made explicit.
	type Out = PhonemeToken & { start: number };
	const out: Out[] = [];
	let emitted = "";
	for (const w of grouped) {
		const members = Array.isArray(w) ? w : [w];
		members.forEach((tk, i) => {
			const ps = (tk.phonemes ?? "").split(" ");
			const prev = out.at(-1);
			if (
				i > 0 &&
				tk.prespace &&
				ps.join("") &&
				emitted &&
				!emitted.endsWith(" ") &&
				prev
			) {
				prev.whitespace = true;
				emitted += " ";
			}
			// A merged number ("twenty five") carries its own spaces; split it into tokens.
			ps.forEach((piece, k) => {
				const phonemes = toVocab(piece);
				const wantSpace = k < ps.length - 1 || tk.whitespace;
				emitted += phonemes;
				const whitespace =
					wantSpace && emitted !== "" && !emitted.endsWith(" ");
				if (whitespace) emitted += " ";
				if (phonemes || whitespace)
					out.push({ phonemes, whitespace, start: tk.start });
			});
		});
	}
	// No trailing space: the model's input ends at the last sound.
	for (let i = out.length - 1; i >= 0; i--) {
		const tk = out[i] as Out;
		if (!tk.phonemes) {
			out.splice(i, 1);
			continue;
		}
		tk.whitespace = false;
		break;
	}

	const engineWords = tokenize(text);
	const words: PhonemizedWord[] = engineWords.map((word) => ({
		text: word.text,
		tokens: [],
	}));
	let w = 0;
	for (const tk of out) {
		while (
			w + 1 < engineWords.length &&
			tk.start >= (engineWords[w + 1]?.start ?? Infinity)
		)
			w++;
		words[w]?.tokens.push({ phonemes: tk.phonemes, whitespace: tk.whitespace });
	}
	return {
		phonemes: out
			.map((tk) => tk.phonemes + (tk.whitespace ? " " : ""))
			.join(""),
		words,
	};
}
