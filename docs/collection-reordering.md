# Library collection and paper ordering

Library keeps its ordinary rows and actions. A neutral divider below All Saved
separates the aggregate from collection subsets; the selected background, icons,
counts and divider above New collection stay unchanged.

Each real Library collection has a six-dot handle at the far left, revealed on
row hover or keyboard focus. The row reserves fixed handle and ellipsis tracks
around the folder/name/count button. Counts remain right-aligned; names truncate
without displacing the count or menu. The hover/focus ellipsis, right-click,
Shift+F10 or Context Menu key opens Rename/Delete; opening it does not select the
collection. Organized Following uses [the same sidebar interaction](following-collection-ordering.md).

Drag a handle directly to the subtle insertion indicator. There is no reorder
mode, Reorder menu action or Done button. Ordinary rows, titles and actions are
not reorder triggers. Each completed move saves immediately. Escape, pointer
cancellation and dropping outside the real reorderable rows cancel the move.
The shared controller restores post-save focus only for keyboard moves; pointer
drag completion/cancellation releases its own focused handle. No CSS focus
outlines are suppressed. See [focus investigation and verification](following-reordering.md#focus-after-dragging).
All Saved and New collection are outside the drop region. Handles support
Arrow Up/Down and Home/End, with accessible movement instructions and a live
announcement. Focus returns to the moved handle. No movement animation is used.
Hover/focus controls occupy reserved space and do not shift titles, counts or
sidebar width. Long lists scroll conservatively near their edges while dragging.

All Saved remains first and New collection remains below the list. Every real
collection can move, including an initial or user-created Saved Papers; names
have no ordering semantics. Collection moves preserve selection and membership.

Inside an individual collection, paper rows reserve a left handle gutter and
support the same direct drag/keyboard interaction. Each collection owns its
paper order. All Saved, Feed, Following and Offline gain no paper-reorder handles.
Following has separate [global and per-collection author reordering](following-reordering.md).
Text/date filtering keeps its existing behavior. If it hides any collection
members, visible paper handles are disabled and explain “Clear filters to reorder
the complete collection.” Filters remain usable and are never cleared silently.
Empty collections have no paper handles; single-item moves are harmless no-ops.

## Local schema

Local schema 8 retains the schema-6 requirement for the JSON-compatible `paperOrdering` value below. Older
schema-5 records migrate automatically; no manual transfer is needed:

```json
{
  "version": 1,
  "collectionIds": ["paper-collection:geometry", "paper-collection:algebra"],
  "paperOrders": [
    {
      "collectionId": "paper-collection:geometry",
      "paperIds": ["2610.12279", "math/0601001"]
    }
  ]
}
```

Stable collection IDs and canonical paper IDs determine order independently of
names and metadata. The local data schema advances independently of the extension version.
Migration derives collection order from the existing collection array; collections
without manual paper order retain the existing Library array order. Initialization
persists the current schema once with a recovery snapshot. Completed ordinary
reads do not write ordering. See [migration safety](storage-migrations.md).

All moves cross RepositoryClient and the shared background PaperRepository.
Move commands express an item and its `beforeId` (null means the end), rather than
sending a possibly stale whole list. The repository resolves the intent against
current membership and serializes one local write. Invalid or missing targets
fail without mutation; ineffective moves do not write. Storage failures leave the
previous persisted state intact.

Reconciliation appends new collections and newly added papers to manual orders,
removes deleted collections/removed memberships, and deduplicates references.
Rename does not affect ordering. Existing guarded, eight-second Undo restores a
removed paper's position before its next surviving successor without rewinding
other moves. Receipt lifetime and metadata/membership rules remain unchanged.
Ordering survives browser restart and worker suspension, stays device-local, and
never enters Chrome Sync preference registers. No extra permissions, dependencies,
background requests or writes to Offline PDF storage are introduced.

## Export/import status

The new `xivary-library` version-3 multi-file backup exports explicit collection
and per-collection paper ordering and restores it into a fresh profile. Existing
profiles retain their own order and append imported IDs. Collection JSON exports
include complete member records and their own order. See
[the backup format and merge rules](import-export.md). Internal older single-JSON
repository methods remain unchanged and do not carry manual ordering; the Settings
transfer UI now uses version 3. Release packaging is separate from these user
backup files; see [the release workflow](release.md).

## Verification

`tests/paper-ordering.test.js` covers repository/client/background moves, independent
orders, Saved Papers, metadata/membership/preference isolation, rename/add/delete,
Undo, no-op and invalid moves, failed writes, recreation and reconciliation.
`tests/reorder.test.js` covers keyboard moves, thresholds, drop indicators,
commit-on-drop, fixed aggregate/drop boundaries, disabled filtered handles,
detachment and Escape/pointer/outside-drop cancellation.

Run `node scripts/reorder-smoke.mjs` after `npm run build` for native Chrome checks
in a disposable profile. It exercises collection and handle-only paper dragging,
fixed aggregate/New collection placement and drop exclusion, selection/count/menu
alignment under long names and six-digit counts, hover/focus geometry, keyboard
moves, cancellation, filtered-subset protection, empty/single collections, ordinary paper actions,
accessibility-tree handle names, 360px layout, reload, service-worker suspension
full profile restart and full-backup restoration. Screenshots are written to
`/tmp/xivary-reorder-screenshots`. Papers in this deterministic test are fixtures;
no live arXiv retrieval is needed for ordering. Physical touch and assistive
technology speech output remain manual checks.

Historical direct-handle milestone verification at version 0.5.0: 323 archive-free unit tests pass
(`npm test -- --test-skip-pattern='both ZIP artifacts'`), both unpacked production
builds pass, and Chrome 154 / Firefox 157 full regressions pass. The direct drag
suite, native fresh-profile backup round trip and unchanged-version migration
suite also pass. No release ZIP is generated by these checks; Firefox smoke uses
`XIVARY_NO_ARCHIVE=1`. Storage schema remains 6.
