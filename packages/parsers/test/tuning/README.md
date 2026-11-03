# Saved-page filter: tuning record

`html-pages.json` is the data behind `LINK_DENSITY_MAX` in `src/html.ts`. `../html-filter.test.ts` re-measures it on every run.

## The pages

Saved on 2026-11-03 with `curl` and kept byte for byte under `../fixtures/html/`. Licences are the ones the sites state; **a human should confirm redistribution before 2.0 ships** (the Rust blog line is the least certain).

| Fixture | Source | Licence |
|---|---|---|
| `wikipedia-lorenz-cipher.html` | en.wikipedia.org/wiki/Lorenz_cipher | CC BY-SA 4.0 |
| `python-tutorial.html` | docs.python.org/3/tutorial/introduction.html | PSF licence (Python docs) |
| `govuk-highway-code.html` | gov.uk/guidance/the-highway-code/introduction | Open Government Licence v3.0 |
| `rust-blog-1-87.html` | blog.rust-lang.org/2025/05/15/Rust-1.87.0/ | MIT or Apache-2.0 (blog repository, to confirm) |
| `mdn-blockquote.html` | developer.mozilla.org/en-US/docs/Web/HTML/Element/blockquote | CC BY-SA 2.5 (MDN text) |
| `wikinews-ev-chargers.html` | en.wikinews.org (Monta EV charger ranking) | CC BY 2.5 |
| `nasa-artemis-blog.html` | nasa.gov Artemis blog post, 2026-10-23 | NASA content, public domain unless credited |
| `wikinews-main-page.html` | en.wikinews.org/wiki/Main_Page | CC BY 2.5 (control: a hub of links, no article) |
| `gutenberg-modest-proposal.html` | gutenberg.org/ebooks/1080 | Public domain (US); Project Gutenberg licence text kept |

## Method

The truth for each page is the prose inside the article container (`p`, `li`, `h1`-`h6`), found with the selector recorded in the JSON and read from a DOM built with `htmlparser2` and `domutils` (a one-off script, not part of the package). Reference lists, tables, figures, tables of contents and edit links are left out of the truth. A filter output block matches a truth block by the first 60 characters of its text. Recall counts the truth blocks present. Noise counts output blocks, other than code, images, table rows and the h1, whose text is nowhere in the article container.

## Result

| Threshold | Recall (7 article pages) | Noise | Control hub page, blocks kept |
|---|---|---|---|
| 0.5 | 354 of 366 | 4 | 92 |
| 0.8 | 356 of 366 | 4 | 94 |

0.8 never kept less of an article than 0.5 and never added noise. It rescued two heavily linked paragraphs on the Highway Code page. On a BBC News article that is not redistributable and so not in the fixtures, it rescued one more paragraph. Its cost is two link bars ("Copy us • Newsroom • …") kept on the hub page, where the bullets dilute the link share below 0.8. **Chosen: 0.8.**

The evidence is thin, because most furniture is removed by structure (`nav`, `aside`, roles, class names) before the threshold applies, so the threshold only decides the prose paragraphs in between. Lists and table rows are exempt from it, because link-only list items (API lists, see-also, bibliographies) are content once navigation is gone; on the Rust blog this was 75 of 106 truth blocks.

## Known misses

- Short paragraphs that act as headings and end without punctuation, such as Sphinx's "See also" and "Footnotes", are dropped.
- Footnote bodies inside an `aside` (Sphinx) are dropped with the aside.
- Pages with no semantic markup at all (every block a bare `div`) are only caught by the link-density and length rules.
