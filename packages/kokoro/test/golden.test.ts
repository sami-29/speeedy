// Conformance with Python misaki. The expected phonemes were produced by misaki 0.9.4
// (`en.G2P(trf=False, british=False, fallback=None)`, spaCy en_core_web_sm) over the same
// sentences. The lexicon is the pinned misaki data, fetched into `.cache` on first run.
import { beforeAll, describe, expect, it } from "vitest";
import { type Lexicon, phonemize, spellLetters } from "../src/index";
import golden from "./fixtures/golden-phonemes.json" with { type: "json" };
import { realLexicon } from "./helpers";

let lexicon: Lexicon;
beforeAll(async () => {
	lexicon = await realLexicon();
}, 120_000);

describe("misaki conformance", () => {
	for (const { text, phonemes } of golden) {
		it(text, () => {
			expect(phonemize(text, lexicon).phonemes).toBe(phonemes);
		});
	}

	it("spells unknown words the way misaki's get_NNP does", () => {
		expect(spellLetters("Brzkt", lexicon)).toBe("bˌiˌɑɹzˌikˌAtˈi");
		expect(spellLetters("qwrtp", lexicon)).toBe("kjˌudˌʌbᵊljuˌɑɹtˌipˈi");
		expect(phonemize("The qwrtp sat.", lexicon).phonemes).toBe(
			"ðə kjˌudˌʌbᵊljuˌɑɹtˌipˈi sˈæt.",
		);
	});
});
