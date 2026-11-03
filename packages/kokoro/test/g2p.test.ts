import { describe, expect, it } from "vitest";
import { Lexicon, phonemize, spellLetters, VOCAB } from "../src/index";
import { fixtureLexicon } from "./helpers";

const lexicon = new Lexicon(fixtureLexicon);

describe("phonemize", () => {
	it("joins lexicon entries with the source whitespace and punctuation", () => {
		expect(phonemize("The cat sat on the mat.", lexicon).phonemes).toBe(
			"ðə kˈæt sˈæt ˌɔn ðə mˈæt.",
		);
	});

	it("gives every text word its own group of phoneme tokens", () => {
		const { words } = phonemize("Hello, world!", lexicon);
		expect(words.map((word) => word.text)).toEqual(["Hello,", "world!"]);
		expect(words.map((word) => word.tokens)).toEqual([
			[
				{ phonemes: "həlˈO", whitespace: false },
				{ phonemes: ",", whitespace: true },
			],
			[
				{ phonemes: "wˈɜɹld", whitespace: false },
				{ phonemes: "!", whitespace: false },
			],
		]);
	});

	it("spells an out-of-vocabulary word letter by letter through the letter entries", () => {
		// Expected value from misaki 0.9.4: `G2P().lexicon.get_NNP("zyxqv")`.
		expect(phonemize("zyxqv", lexicon).phonemes).toBe("zˌiwˌIˌɛkskjˌuvˈi");
		expect(spellLetters("zyxqv", lexicon)).toBe("zˌiwˌIˌɛkskjˌuvˈi");
	});

	it("lets the caller replace the out-of-vocabulary function", () => {
		const seen: string[] = [];
		const result = phonemize("The zyxqv sat.", lexicon, {
			oov: (word) => {
				seen.push(word);
				return "kˈæt";
			},
		});
		expect(seen).toEqual(["zyxqv"]);
		expect(result.phonemes).toBe("ðə kˈæt sˈæt.");
	});

	it("keeps a word with no pronunciation as an empty word rather than dropping it", () => {
		const silent = phonemize("cat zyxqv", lexicon, { oov: () => "" });
		expect(silent.words.map((word) => word.text)).toEqual(["cat", "zyxqv"]);
		expect(silent.words[1]?.tokens.map((t) => t.phonemes).join("")).toBe("");
	});

	it("only emits characters the model has ids for", () => {
		const { phonemes } = phonemize("Hello, world! zyxqv apple", lexicon);
		for (const char of phonemes) expect(VOCAB.has(char), char).toBe(true);
	});

	it("maps straight quotes to curly opening and closing quotes", () => {
		expect(phonemize('"Stop," she said.', lexicon).phonemes).toBe(
			"“stˈɑp,” ʃi sˈɛd.",
		);
	});
});
