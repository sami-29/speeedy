# Saved-page filter: tuning record

`html-pages.json` is the data behind `LINK_DENSITY_MAX` in `src/html.ts`. `../html-filter.test.ts` re-measures it on every run.

## The pages

Six real saved pages (sources, licences and attribution in `../NOTICE.md`) and one synthetic page, `synthetic-release-blog.html`, written for this repository. The synthetic page has the structure of a typical blog post: cookie banner, header navigation, archive sidebar, a post in a bare `div`, a list of link-only items, code, a share bar, comments, a newsletter form and a footer, with unclosed `li` and `p` tags. It stands in for a real page whose licence was unclear. A seventh real page, `wikinews-main-page.html`, is a control: a hub of links with no article.

## Method

The truth for each real page is the prose inside the article container (`p`, `li`, `h1`-`h6`), found with the selector recorded in the JSON and read from a DOM built with `htmlparser2` and `domutils` (a one-off script, not part of the package). Reference lists, tables, figures, tables of contents and edit links are left out of the truth. For the synthetic page the truth is the list of article blocks it was generated from. A filter output block matches a truth block by the first 60 characters of its text. Recall counts the truth blocks present. Noise counts output blocks, other than code, images, table rows and the h1, whose text is nowhere in the article container.

## Result

| Threshold | Recall (7 article pages) | Noise | Control hub page, blocks kept |
|---|---|---|---|
| 0.5 | 283 of 296 | 4 | 92 |
| 0.8 | 285 of 296 | 4 | 94 |

0.8 never kept less of an article than 0.5 and never added noise. It rescued two heavily linked paragraphs on the Highway Code page. On a BBC News article that is not redistributable and so not in the fixtures, it rescued one more paragraph. Its cost is two link bars ("Copy us • Newsroom • …") kept on the hub page, where the bullets dilute the link share below 0.8. **Chosen: 0.8.**

The evidence is thin, because most furniture is removed by structure (`nav`, `aside`, roles, class names) before the threshold applies, so the threshold only decides the prose paragraphs in between. Lists and table rows are exempt from it, because link-only list items (API lists, see-also, bibliographies) are content once navigation is gone; the synthetic page has 20 of them.

## Known misses

- Short paragraphs that act as headings and end without punctuation, such as Sphinx's "See also" and "Footnotes", are dropped.
- Short bylines with a link are dropped.
- Footnote bodies inside an `aside` (Sphinx) are dropped with the aside.
- Pages with no semantic markup at all (every block a bare `div`) are only caught by the link-density and length rules.
