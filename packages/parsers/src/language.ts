import type { DetectedLanguage } from "./types";

/**
 * Language detection for the reader to override: declared metadata first, then the script
 * of the letters, then stopword counts for Latin and Cyrillic text. It looks at a bounded
 * sample, so cost does not grow with the file.
 */

const SAMPLE_UNITS = 20_000;
const MAX_TAG_LENGTH = 35;

/** The primary language subtag of a valid BCP 47 tag, or null. `und` is not a language. */
export function normalizeLanguageTag(tag: unknown): string | null {
	if (typeof tag !== "string") return null;
	const trimmed = tag.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) return null;
	try {
		const canonical = Intl.getCanonicalLocales(trimmed)[0];
		const primary = canonical?.split("-")[0]?.toLowerCase();
		if (!primary || primary === "und" || primary.length > 3) return null;
		return primary;
	} catch {
		return null;
	}
}

const count = (text: string, pattern: RegExp): number =>
	text.match(pattern)?.length ?? 0;

const SCRIPTS = {
	latin: /\p{Script=Latin}/gu,
	cyrillic: /\p{Script=Cyrillic}/gu,
	greek: /\p{Script=Greek}/gu,
	arabic: /\p{Script=Arabic}/gu,
	hebrew: /\p{Script=Hebrew}/gu,
	han: /\p{Script=Han}/gu,
	kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
	hangul: /\p{Script=Hangul}/gu,
	thai: /\p{Script=Thai}/gu,
	devanagari: /\p{Script=Devanagari}/gu,
} as const;

type Script = keyof typeof SCRIPTS;

const SINGLE_SCRIPT_LANGUAGE: Partial<Record<Script, string>> = {
	greek: "el",
	hebrew: "he",
	hangul: "ko",
	thai: "th",
	devanagari: "hi",
};

function arabicScriptLanguage(sample: string, letters: number): string {
	const urdu = count(sample, /[ٹڈڑںہے]/g);
	if (urdu * 100 >= letters) return "ur";
	const persian = count(sample, /[پچژگکی]/g);
	if (persian * 50 >= letters) return "fa";
	return "ar";
}

const words = (sample: string): string[] =>
	(sample.toLowerCase().match(/\p{L}+/gu) ?? []).filter(
		(word) => word.length <= 40,
	);

const stop = (list: string): ReadonlySet<string> => new Set(list.split(" "));

const CYRILLIC_STOPWORDS: Record<string, ReadonlySet<string>> = {
	ru: stop(
		"и в не на что он как это по из за но до так его все они был была было ещё еще потому чтобы этот она мы вы то же бы или уже только",
	),
	bg: stop(
		"и в не на че се да от по за като със с които ще е си но преди защото до той тя то те ние вие бе били беше или вече само",
	),
};

const LATIN_STOPWORDS: Record<string, ReadonlySet<string>> = {
	en: stop(
		"the of and to in is that it was he for on are as with his they at be this from have or by had not but you were we there an which their said will would she her been him who what when about into could than",
	),
	es: stop(
		"de la que el en y los se del las un por con no una su para es al lo como más pero sus le ya este sí porque entre cuando muy sin sobre también me hasta hay donde desde todo nos uno les ni contra otros ese eso ante ellos esto antes qué",
	),
	fr: stop(
		"le la les un une des du de et est en que qui dans pour pas sur au aux avec ne se ce il elle ils nous vous je tu son sa ses plus par mais ou où comme était être avait fait très tout cette ces avant leur sans sous entre même",
	),
	de: stop(
		"der die das den dem des ein eine einen einem einer und ist nicht zu von mit auf für im in an als auch es sich war er sie wir ihr ich du dass daß aber wie bei nach nur oder noch wurde werden hat haben sein aus um so wenn dann bevor über vor durch unter zum zur",
	),
	it: stop(
		"il lo la i gli le un uno una di a da in con su per tra fra e è che non si ma come più anche se ci mi ti del della dei delle al alla nel nella sono era ha ho questo quello perché quando molto prima dopo ancora",
	),
	pt: stop(
		"o a os as um uma de do da dos das em no na nos nas e que com para por não se mais como mas foi ao ele ela eles seu sua ou já também muito quando até tinha são está à às depois antes pelo pela entre",
	),
	nl: stop(
		"de het een en van dat die niet zijn is ze hij zij met voor maar ook aan op te in er om als bij naar uit nog dan wel zou was waren had hebben dit deze door over zo wat wie kon meer werd toen hun haar ons mijn jij je ik we onder tot",
	),
	tr: stop(
		"ve bir bu şu için ile de da ama çok gibi daha ne o ki kadar sonra önce her ben sen biz değil olarak var yok çünkü ancak veya ise olan oldu bütün kendi üzere mi mı mu mü",
	),
	pl: stop(
		"i w na z do nie się że to jest o jak ale po co tak za od przez czy tym już być był była było są dla który która które jego jej ich tylko bardzo gdy aby może przed zanim ponieważ ten ta te tego oraz lub też",
	),
	cs: stop(
		"a v se na je že s z do to o i ale jako by pro po za od si jsou byl byla bylo být tak jeho její jejich nebo který která které když protože než až už jen také ještě před kde jak co tedy pak",
	),
	sk: stop(
		"a v sa na je že s z do to o i ale ako by pre po za od si sú bol bola bolo byť tak jeho jej ich alebo ktorý ktorá ktoré keď pretože než už len tiež ešte pred kde čo potom",
	),
	hr: stop(
		"i je se da u na za su od to s ne koji koja koje što kao ali bio bila bilo sam će ili kada jer pa već ni nije bi iz do po prije poslije",
	),
	sl: stop(
		"in je se na da za so ki pa kot ne po tudi ali bil bila bilo ker ko pred od iz do s z to ta ni bo lahko",
	),
};

/** Letters that point at one language, used to settle close stopword scores. */
const MARKER_LETTERS: Record<string, RegExp> = {
	tr: /[ıİğĞşŞ]/g,
	pl: /[łŁąĄęĘżŻźŹśŚćĆńŃ]/g,
	cs: /[řŘěĚůŮ]/g,
	sk: /[äÄôÔĺĹŕŔľĽ]/g,
	es: /[ñÑ¿¡]/g,
	pt: /[ãÃõÕ]/g,
	fr: /[œŒ]/g,
	de: /[ßäÄöÖüÜ]/g,
	hr: /[đĐ]/g,
};

function bestStopwords(
	tokens: string[],
	lists: Record<string, ReadonlySet<string>>,
	sample: string,
): { code: string; hits: number } | null {
	let best: { code: string; score: number; hits: number } | null = null;
	let second = 0;
	for (const [code, list] of Object.entries(lists)) {
		let hits = 0;
		for (const token of tokens) if (list.has(token)) hits++;
		const marker = MARKER_LETTERS[code];
		const bonus = marker ? Math.min(count(sample, marker), 12) * 0.5 : 0;
		const score = hits + bonus;
		if (!best || score > best.score) {
			if (best) second = best.score;
			best = { code, score, hits };
		} else if (score > second) {
			second = score;
		}
	}
	if (!best || best.hits < 3) return null;
	if (best.hits / Math.max(tokens.length, 1) < 0.06) return null;
	if (best.score <= second) return null;
	return { code: best.code, hits: best.hits };
}

function cyrillicLanguage(sample: string, tokens: string[]): string {
	if (/[іїєґІЇЄҐ]/.test(sample)) return "uk";
	if (/[ўЎ]/.test(sample)) return "be";
	if (/[ђћџљњјЂЋЏЉЊЈ]/.test(sample)) return "sr";
	if (/[ѓќѕЃЌЅ]/.test(sample)) return "mk";
	if (/[ыэёЫЭЁ]/.test(sample)) return "ru";
	return bestStopwords(tokens, CYRILLIC_STOPWORDS, sample)?.code ?? "ru";
}

const UNKNOWN: DetectedLanguage = { code: "und", source: "unknown" };

const CYRILLIC_MARKERS = /[іїєґІЇЄҐўЎђћџљњјЂЋЏЉЊЈѓќѕЃЌЅыэёЫЭЁ]/;

/**
 * Detect a document's language. A valid `declared` tag (file metadata, front matter) wins.
 * Otherwise the dominant script decides, and Latin and Cyrillic text fall back to stopword
 * counts. Returns `und` when there is no usable signal, rather than a guess.
 */
export function detectLanguage(
	text: string,
	declared?: unknown,
): DetectedLanguage {
	const metadata = normalizeLanguageTag(declared);
	if (metadata) return { code: metadata, source: "metadata" };

	const sample =
		text.length > SAMPLE_UNITS ? text.slice(0, SAMPLE_UNITS) : text;
	const counts = {} as Record<Script, number>;
	for (const script of Object.keys(SCRIPTS) as Script[]) {
		counts[script] = count(sample, SCRIPTS[script]);
	}
	const weights: Record<string, number> = {
		latin: counts.latin,
		cyrillic: counts.cyrillic,
		greek: counts.greek,
		arabic: counts.arabic,
		hebrew: counts.hebrew,
		cjk: counts.han + counts.kana,
		hangul: counts.hangul,
		thai: counts.thai,
		devanagari: counts.devanagari,
	};
	let top = "latin";
	for (const [name, weight] of Object.entries(weights)) {
		if (weight > (weights[top] ?? 0)) top = name;
	}
	const dominant = weights[top] ?? 0;
	if (dominant === 0) return UNKNOWN;

	switch (top) {
		case "cjk":
			return {
				code: counts.kana * 20 >= counts.han ? "ja" : "zh",
				source: "script",
			};
		case "arabic":
			return {
				code: arabicScriptLanguage(sample, counts.arabic),
				source: "script",
			};
		case "cyrillic":
			if (dominant < 2) return UNKNOWN;
			return {
				code: cyrillicLanguage(sample, words(sample)),
				source: CYRILLIC_MARKERS.test(sample) ? "script" : "stopwords",
			};
		case "latin": {
			const best = bestStopwords(words(sample), LATIN_STOPWORDS, sample);
			return best ? { code: best.code, source: "stopwords" } : UNKNOWN;
		}
		default: {
			const code = SINGLE_SCRIPT_LANGUAGE[top as Script];
			return dominant >= 2 && code ? { code, source: "script" } : UNKNOWN;
		}
	}
}
