# Store listings for the Speeedy launcher

Text and links for the three store forms. The owner submits them; nothing here is submitted
yet. `<site>` is the live Speeedy site (not registered at the time of writing). Build the
packages with `SPEEEDY_RELEASE=1 SPEEEDY_ORIGIN=<site> pnpm --filter @speeedy/extension build`
and zip each folder under `extension/dist/` (`chrome`, `edge`, `firefox`).

## Short description (132 characters or fewer)

Send the page you are reading to Speeedy and read it fast. Nothing leaves your browser except the page you send.

## Links each listing carries

| Store | Build folder | Support link | Privacy link |
| --- | --- | --- | --- |
| Chrome Web Store | `dist/chrome` | `<site>/support?ref=chrome-store` | `<site>/privacy?ref=chrome-store#extension` |
| Microsoft Edge Add-ons | `dist/edge` | `<site>/support?ref=edge-store` | `<site>/privacy?ref=edge-store#extension` |
| addons.mozilla.org | `dist/firefox` | `<site>/support?ref=amo` | `<site>/privacy?ref=amo#extension` |

The `#extension` anchor on `/privacy` belongs to the privacy page (ticket 66) and must exist
before submission. The options page already links both URLs with the right `ref`.

## Permission justifications

- `activeTab`: reads the page you are on, only after you click the toolbar button or the menu entry.
- `scripting`: injects the script that extracts the article from that one page.
- `contextMenus`: adds the "Send page to Speeedy" entry.

The extension asks for no site access, runs no script on pages by itself, and has no
`host_permissions`.

## Data use declarations

- Collects no data. Firefox: `data_collection_permissions` is `none`.
- No account, no analytics, no network requests of its own. The page goes to the Speeedy tab the
  extension opens, by `postMessage`, and its address stays on the device.
- Single purpose: send the current page to Speeedy's Library.

## Before submitting

- The app must be built with the store extension IDs, or it refuses every extension: a
  production build with `SPEEEDY_EXTENSION_ORIGINS` unset trusts none. Set it to
  `chrome-extension://<chromeId>,chrome-extension://<edgeId>,moz-extension://*`. Chrome and Edge IDs
  are known after the first store upload. Firefox pages are kept only after the reader confirms
  them (docs/adr/0005).
- The Firefox add-on ID is `launcher@speeedy.app`. It cannot change after the first AMO submission.
