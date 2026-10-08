# Release notes

## Unreleased — UI and Interaction Polish

- Polish Author Results with a query-preserving search toggle, neutral keyboard
  time menu, explicit inclusive year-range Apply/Clear controls, compact header
  Collection icon and responsive toolbar. Rolling presets and data contracts stay
  unchanged; custom ranges remain open-ended where an endpoint is blank.

- Make Collection sidebars minimal: single-click selection, double-click/F2 rename,
  right-click/keyboard Rename/Delete menus, and outside-click rename cancellation.
- Anchor Collection pickers to their controls, flip/constrain at viewport edges,
  and reposition on scroll, resize and content changes without losing input state.

- Unify Library/Following sidebar icons, selected/hover surfaces and stable counts;
  keep management actions in accessible Rename/Delete context menus.
- Reduce header/list spacing, right-align filtered Library counts and provide Clear
  search for no matches. Lighten the Library saved-bookmark surface.
- Compact the existing toolbar popup to 300 × 159px while retaining counts, routes,
  Settings gear and launcher preference behavior.
- Document actual UI conventions and reusable design principles. Collection IDs,
  data semantics, schema, settings-only Sync, portable formats and 0.2.0 are unchanged.

- Refine shared control/dialog rounding, neutral pickers and destructive confirmation
  styling. Following rows reuse ✓ Following and folder/chevron Collections triggers.
- Keep the compact toolbar popup; add default-new-tab Library/Following launcher
  preference through settings-only Sync as a fourth additive register. Settings
  gear, routes, local data, portable formats and version 0.2.0 remain unchanged.

- Share the arXiv Follow button presentation with author headings: dark + Follow,
  gray ✓ Following, action labels/tooltips, focus rings and responsive alignment.
  Existing Unfollow, Undo and collection behavior is unchanged.

- Add explicit Follow/Unfollow and optional collection assignment beside author names.
- Add default-new-tab inbound author navigation preference, separate from outbound
  arXiv link behavior; synchronize this third designated preference only.
- Support current standard arXiv search-result author anchors with visible full
  names, native fallback links and unmodified-click-only interception.
- Add eight-second Undo to ordinary item/membership removals, preserving metadata
  and rejecting stale receipts. Confirm whole-collection deletion with actual consequences.
- Share Library/Following creation behavior: focus, Enter, Escape, outside cancellation,
  whitespace cancellation and guarded submission.
- Prevent contradictory loading/empty states and caching non-Atom success responses.
  No reproduced store-specific slowdown or speculative networking redesign.
- Retain version 0.2.0 for implementation; choose the next version at release preparation.
  User reports Chrome Web Store publication of the preceding version; historical
  candidate evidence below describes the earlier preparation run.

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
