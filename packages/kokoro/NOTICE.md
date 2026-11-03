# Notice for ported code and downloaded data

## Ported code

- `src/lexicon.ts` and `src/g2p.ts` port the English lexicon lookup, stress rules, number and currency handling and token merging from misaki's `en.py` (https://github.com/hexgrad/misaki, commit `fba1236595f2d2bf21d414ba6e57d25256afada3`). Copyright hexgrad, Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Changed from the original: rewritten in TypeScript; spaCy's tagger is replaced by a small rule-based tagger; there is no espeak or neural fallback, so a word the lexicon does not know is spelled through the lexicon's letter entries; number formatting covers what num2words does for cardinals, ordinals and years only.
- `src/timing.ts` ports `KPipeline.join_timestamps` from Kokoro (https://github.com/hexgrad/kokoro), copyright hexgrad, Apache License 2.0. Changed from the original: rewritten in TypeScript and returns one span per token.
- `src/vocab.ts` holds Kokoro's phoneme vocabulary from the model's `config.json` (Apache License 2.0).

misaki.js (the JavaScript port in the misaki repository) was not used.

## Downloaded at runtime, never committed or bundled

| File | Source | Licence |
|---|---|---|
| `onnx/model.onnx`, `voices/af_msa.bin` | https://huggingface.co/mrfakename/Kokoro-7M-Distill-ONNX at revision `2b3cb7963716406d0596568588ea360da6b168ce` | Apache License 2.0, as stated on the model card. |
| `us_gold.json`, `us_silver.json` | misaki's `misaki/data` at the commit above | The repository is Apache License 2.0, but the data files carry no licence or notice of their own and their sources are not stated. They are fetched from GitHub at a pinned commit and checked by sha256, so this repository never redistributes them. |
