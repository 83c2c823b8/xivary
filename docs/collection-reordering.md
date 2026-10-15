# Library collection and paper ordering

Library keeps its ordinary rows and actions. A neutral divider below All Saved
separates the aggregate from collection subsets; the selected background, icons,
counts and divider above New collection stay unchanged.

A collection's hover/focus ellipsis, right-click, Shift+F10 or Context Menu key
opens its existing menu. Rename and Delete retain their positions, followed by
Reorder collections and Reorder papers. Following's menu remains unchanged.

Reordering is temporary. Six-dot handles appear only on hover or keyboard focus
in the chosen mode. Drag a handle to the subtle drop indicator; ordinary rows,
titles and actions are not draggable. Each completed move saves immediately.
Done exits without another save. Escape cancels an active drag, or exits the mode
when no menu or dialog is open. Dropping outside the list cancels the move.
Handles support Arrow Up/Down and Home/End, with movement instructions and a live
status announcement. Focus returns to the moved handle; no movement animation is
used. Narrow layouts reserve a small gutter only in paper-reordering mode;
titles stay aligned as handles appear on hover/focus. Long sidebars and pages scroll conservatively near their edges while the
pointer moves.

All Saved remains first and New collection remains below the list. Every real
collection can move, including the initial or a user-created Saved Papers; names
have no special ordering semantics. Collection reordering preserves selection.
Reorder papers selects that collection and temporarily shows all its members,
ignoring and disabling text/date filters without changing their values. Done
restores filtering. Paper order belongs to that collection alone; All Saved and
collections without a manual order retain their existing presentation.

## Local schema

Local schema 6 requires the JSON-compatible `paperOrdering` value below. Older
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
commit-on-drop and Escape/pointer/outside-drop cancellation.

Run `node scripts/reorder-smoke.mjs` after `npm run build` for native Chrome checks
in a disposable profile. It exercises collection and handle-only paper dragging,
fixed aggregate/New collection placement, selection/count stability, keyboard
moves, cancellation, complete filtered collections, ordinary paper actions,
accessibility-tree handle names, 360px layout, reload, service-worker suspension
and full profile restart. Screenshots are written to
`/tmp/xivary-reorder-screenshots`. Papers in this deterministic test are fixtures;
no live arXiv retrieval is needed for ordering. Physical touch and assistive
technology speech output remain manual checks.
