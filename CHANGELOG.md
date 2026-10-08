# Release notes

## 0.2.0 — 2026-10-08 (release candidate)

- Fix incomplete Following collection organization: honor the opt-in setting on
  Following, expose inline create/rename/delete and collection browsing, and reuse
  the author membership picker for assigning/moving. Preserve assignments when
  disabled; disclose final-membership unfollow consequences. No data migration.
- Add a native browser API boundary and generate Firefox's module event-page
  manifest from the shared Chromium source. Application files remain identical.
- Synchronize small saved/followed intent, collections/memberships and the two
  boolean preferences through existing Chrome extension Sync v1. Retain logical
  revisions, collection generations, tombstones, pending writes and local-first
  failure behavior. Seed missing preferences in older replicas compatibly.
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
