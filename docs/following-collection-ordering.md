# Following collection ordering and selection

With author organization enabled, Following collections use Library's direct
handle interaction. Each row reserves `[handle] [folder/name] [count] [menu]`
tracks. Six-dot handles and the ellipsis appear on hover/focus without shifting
names or counts. Names truncate and keep their full tooltip/accessibility text.
All Following stays above the real collections; New collection stays below them.
Neither is a drag target. Rename/Delete, right-click, F2 and Shift+F10 remain.

Drag only from the handle. The shared `bindReorder` helper supplies the subtle
insertion line, pointer cancellation/focus cleanup, and Arrow Up/Down/Home/End
movement. Keyboard focus survives a successful move; pointer drags do not leave
blue focus rings. A visually hidden polite live region announces collection
moves without a visible success message. No global focus styling changes.

## Existing storage and backups

The existing `collections` array is already the Following sidebar order, and
portable v3 already exports it as `ordering.authorCollections`. `moveAuthorCollection`
resolves one stable ID and `beforeId` (null means end) against the current array
under the repository lock. It writes only a reordered array of unchanged records.
Author array order, names/aliases, membership, metadata, last-used destinations,
Library ordering, PDFs and Feed caches are unchanged. New collections append;
rename keeps the position; deletion removes the record with its existing rules.
No-op moves do not write; invalid targets or failed writes retain existing data.

No new ordering field, research-schema version or backup format is introduced.
Existing v0.5.0 collection arrays keep their exact order. Existing registered
upgrades still run automatically before repository operations; this change does
not add a migration step. Full and Following-section backups restore the exact
collection order into a fresh profile. Individual collection files restore that
collection and its membership; populated imports keep their own order and append
new imported IDs, following the existing conservative merge policy.

## Last selected Following collection

A separate local key, `xivary:following-selection`, holds only:

```json
{ "version": 1, "collectionId": "collection:example" }
```

The empty string means All Following. The optional `selectedCollectionId` in the
author-library snapshot is applied before the first sidebar/list render. Explicit
`?collectionId=<id>` or `?collection=<id>` wins; an explicitly empty value selects
All Following. Collection routes apply when author organization is enabled.
Missing, malformed or deleted IDs use the aggregate safely. No
history entries or URL rewrites are introduced. Ordinary focus refresh retains
the current view's explicit selection.

This follows Library's existing approach without changing Library's implementation.
Writes cross RepositoryClient/PaperRepository, the migration barrier and repository
lock, then the local adapter below SyncStorage. Background-owned writes dispatch
immediately; unchanged selections do not write. Read/write failures use the
existing recoverable status behavior. Unsupported future preference versions
are retained and cannot be overwritten. Missing keys need no installed-data
transformation. No research schema bump is needed for this optional version-1 key.

The key is independent from Library's selection and the last-used author collection
for new follows. It never enters Chrome Sync or research backups; imports preserve
the destination's selection. Disabling organization hides the sidebar and displays
the aggregate without rewriting the stored selection. Re-enabling restores it.
Search, filters and scroll are not persisted, and author ordering is unchanged.

## Verification

`tests/following-collections-order.test.js` covers RPC moves, metadata/membership
and author-order isolation, zero/single/no-op cases, failures, rename/add/delete,
selection independence, stale/corrupt/future preferences, old installed data,
all/section/individual-collection backups and populated merges. Two-device Sync
tests check local order/selection through preference updates and worker recreation.

After the archive-free production build, run
`node scripts/following-collections-smoke.mjs`. It uses disposable Chrome profiles
for repeated upward/downward pointer drags, keyboard movement/focus, cancellation,
fixed rows, long names/count/menu geometry, hidden announcements, all top-level
navigation and Settings, independent Library selection, close/reopen/worker/browser
restart, hidden organization, explicit routes, rename/delete/stale fallback,
empty/single collections, 360px layout and clean-profile full ZIP restoration.
Screenshots are in `/tmp/xivary-following-collections-screenshots`.

Library's selection and direct reordering suites remain separate regressions.
Verified on Linux with Chrome 154 (including the dedicated collection suite)
and Firefox 157 (existing regression suite). Both production builds passed;
348 unit tests passed with only the release-archive artifact check excluded,
because release packages were not generated. Native backup, migration, Sync
lifecycle, Library selection/reordering, author reordering and shared drag-focus
regressions passed. `git diff --check` passed.

Physical touch hardware and assistive speech still require manual checks; native
AX-tree and keyboard checks do not prove spoken screen-reader output.
