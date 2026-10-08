# Release notes

## 0.3.0 — 2026-10-09 (prepared; not submitted)

- Filter Library and Author Results by publication date with rolling one/three-year
  presets or inclusive custom year ranges. Combine Library date, text and Collection
  filters; keep Abstract/PDF links and compact paper rows.
- Toggle Author Results search without losing the query; use a neutral keyboard
  time menu and explicit year-range Apply/Clear controls.
- Follow or unfollow from author results with consistent + Follow / ✓ Following
  buttons. Undo ordinary removals for eight seconds; confirm whole-Collection deletion.
- Make Library/Following Collection navigation compact: double-click or F2 to rename,
  right-click or keyboard context menus for Rename/Delete, and outside-click cancel.
  Anchor membership pickers to their controls and keep them inside the viewport.
- Refine shared controls, dialogs and the compact toolbar popup. Choose new/current-tab
  navigation for popup Library/Following rows, independently of arXiv navigation.
- Extend existing abstract-page author navigation to standard arXiv search results;
  prefer full visible names and preserve native modified/middle-click destinations.
- Place the arXiv Bookmark action beside the paper title; disable stale extension
  controls with a quiet reload hint after extension updates.
- Preserve contextual Settings gears, local Bookmarks/Following/Collections,
  schema 5 and compatible manual Import/Export. Only four designated preferences
  synchronize through Chrome; Firefox remains local-only. No new release permissions.

See [verification, upgrade limits and manual submission](docs/release.md#v030-release-preparation).

## 0.2.0 — 2026-10-08 (release candidate)

- Fix incomplete Following collection organization: honor the opt-in setting on
  Following, expose inline create/rename/delete and collection browsing, and reuse
  the author membership picker for assigning/moving. Preserve assignments when
  disabled; disclose final-membership unfollow consequences. No data migration.
- Add a native browser API boundary and generate Firefox's module event-page
  manifest from the shared Chromium source. Application files remain identical.
- Synchronize only `openArxivLinksInNewTab` and
  `organizeFollowedAuthorsIntoCollections` through Chrome Sync v1 preferences.
  Keep Bookmarks, Following, collections and memberships local. Ignore legacy
  library Sync records without deleting remote history or current local data.
  Retain preference conflict/retry behavior and inert old replica bookkeeping.
- Keep full local metadata, feed caches and both last-used collection pointers local;
  Firefox continues to use local-only persistence. Schema 5/migrations are unchanged.
- Add scoped Bookmarks and Following JSON Import/Export, with All/collection
  selection, collection restoration and idempotent isolated merges. Preferences
  have no manual transfer. Accept category selection from combined v1 backups and
  earlier unscoped v2 files; do not export raw storage or Sync internals.
- Add matching header Settings gears opening the existing Settings page.
- Route supported abstract author links to the existing author view/query/cache/
  paper-row experience. Full visible names survive direct refresh, viewing never
  follows, namesakes are disclosed, and native modified/middle navigation survives.
- Repair the Firefox test harness's unsupported direct extension navigation by
  entering through the extension's own author action and origin. Add focused
  preference simulations and native Chrome transfer/Sync lifecycle tests.
- Verification: 135 Node tests; Chrome and Firefox fixture suites; actual Chrome
  transfers, events/alarm/worker/reload/profile recovery; three live arXiv abstracts;
  both 60-file packages. Account delivery and remaining manual distribution checks
  are **not verified**. This candidate is not store-published or signed. See
  [release assessment](docs/release.md#release-assessment).

## 0.1.0 — 2026-09-24

Initial public-quality release of Xivary for Chromium.

### Included

- Save and unsave papers from arXiv abstract pages and author feeds.
- Follow and unfollow authors directly on arXiv author lines.
- Browse followed authors and retrieve cached author feeds from arXiv's public API.
- Organize saved papers into named collections.
- Filter the Library and author feeds locally, including date-range filtering.
- Configure link behavior and optional author-collection controls in Settings.
- Local-only persistence through the Manifest V3 service worker and repository layer.

### Known limitations

- Author identity is based on normalized names and cannot distinguish namesakes.
- Author feeds are limited to the 50 newest matching arXiv API results.
- There is no account, backend sync, built-in data import/export, or mobile client.
- The field-aware Search page is retained internally but is not part of primary
  navigation.
