# A Firefox launcher page is kept only after the reader confirms it

The launcher extension sends the page it extracted to a Speeedy tab by `postMessage`, and the Library accepts a message only when it comes from the window that opened the tab and from a trusted extension origin. In Chromium the origin is `chrome-extension://<id>`, and the ID is fixed by the store, so a build pins it and saves the page at once. Firefox gives every install of an add-on a random `moz-extension://<uuid>` origin, so the Library cannot tell the Speeedy launcher from any other Firefox extension. For a message that matched only the Firefox pattern, the Library shows "Keep this page?" with the page's title and the site it came from, and saves it only when the reader chooses Keep.

We chose this over trusting every Firefox extension silently, which would let any installed add-on write to the reader's Library and switch the tab to the reader with no action from them. We also rejected a shared secret between the extension and the app: the secret would have to ship in the extension, where every installed copy and every other add-on can read it.

## Consequences

- The Firefox launcher takes one extra click. Chromium and Edge builds with a pinned ID do not.
- A Firefox page the reader discards is refused: the extension's tab says Speeedy did not keep it.
- A page from a Firefox add-on still passes the same checks as any other (opener window, origin shape, schema, size caps) before the question is asked, so the question never shows hostile or malformed data.
- Revisit this if Firefox gains a stable per-add-on origin, or if the extension can prove its identity another way.

A production app build trusts no extension origin unless `SPEEEDY_EXTENSION_ORIGINS` lists them (the Chromium store IDs, and `moz-extension://*` for Firefox). The development extension's ID is trusted only in `vite dev` and the e2e builds, because its public key is in the repository.

See `.planning/issues/2.0/67-launcher-extension.md` (local).
