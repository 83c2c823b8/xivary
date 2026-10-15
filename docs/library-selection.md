# Last selected Library collection

Library remembers only its selected collection. A fresh Library document restores
that stable ID before rendering the sidebar or paper list, so All Saved does not
briefly appear selected first. Selecting All Saved stores the empty string.
Renaming or reordering a collection does not change its ID. Missing, malformed or
unavailable IDs resolve to All Saved without changing research data.

Search queries, publication-time filters and scroll positions remain transient.
Following has its own independent [collection selection](following-collection-ordering.md). There are no new controls, indicators or settings.

## Persistence boundary

`xivary:library-selection` is a separate local UI preference:

```json
{ "version": 1, "collectionId": "paper-collection:example" }
```

It is independent of the research envelope (schema 8), extension version (0.5.1),
Chrome Sync v1 and portable backup v3. Existing installations have no key and need
no transformation: absence safely means All Saved. No existing schema is bumped,
no old data is overwritten with defaults, and no research envelope write is needed
to remember a selection. An unsupported future preference version is left intact;
reads fall back safely and writes report that they cannot replace it.

The Library RPC snapshot has an optional `selectedCollectionId`; older workers
can omit this UI preference without invalidating their research snapshot. Only
initial rendering reads it into page state. Later focus refreshes retain the
current page's explicit selection. `setLibrarySelection` crosses RepositoryClient,
the shared repository lock/migration barrier, and the local storage adapter below
SyncStorage. The background owns each immediately dispatched write, including
when the sending page subsequently closes. Unchanged selections cause no writes.
Save failures use the existing status line and leave previous stored data intact.

Only `lib/storage.js` accesses the browser storage key. It is not a default target
for bookmarking: `lastUsedPaperCollectionId` keeps its existing meaning. The
selection is not synchronized or included in any research backup, and imports
leave a destination's UI preference alone. Offline bytes, names, memberships,
manual order and Following records are untouched.

## Explicit navigation

An explicit `?collectionId=<stable-id>` takes precedence over the saved choice;
`?collection=<stable-id>` is also accepted. `?collectionId=` means All Saved.
Unknown/deleted collection IDs fall back to All Saved. Other URL parameters do not
restore or persist filters. No history entries or URL rewrites are introduced.
The page's new explicit selection becomes its last choice.

## Verification

`tests/library-selection.test.js` covers repository/RPC writes, reload-equivalent
repository recreation, renaming, All Saved, deletion/stale/malformed/future values,
failed writes, upgrades from installed data, backup exclusion and destination
preference preservation, and explicit routes. Two-device Sync tests verify
independent local selections through preference changes and worker recreation.

After `npm run build`, `node scripts/library-selection-smoke.mjs` uses disposable
Chrome profiles for native tab navigation, close/reopen, service-worker/browser
restart, first-render mutation observation, rename/deletion/fallback, explicit
routes, unchanged research state, collection/paper ordering, transient search/date
filters and a narrow layout. Screenshots are in
`/tmp/xivary-library-selection-screenshots`. No real user profile is accessed.

Verified on 2026-10-15: 341 archive-free Node tests, both production builds,
Chrome 154 and Firefox 157 regression suites, and native selection, ordering,
focus, migration, backup and Sync lifecycle suites pass. Release-archive checks
were excluded because this milestone does not generate release packages.
