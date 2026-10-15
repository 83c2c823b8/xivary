# Direct Following author ordering

Following uses the same handle-only pointer dragging as Library collections and
collection papers. Six dots appear on row hover or keyboard focus in a reserved
28px gutter. Author links, Unfollow and the optional membership picker retain their
existing behavior. There is no editing mode or Done button. Following's collection
sidebar separately supports [direct collection reordering and selection restoration](following-collection-ordering.md). Author row ordering is unchanged by that feature.

On a handle, Arrow Up/Down moves one position and Home/End moves to either end.
Moves save immediately through RepositoryClient and the serialized repository
lock, and announce the resulting position. There is no movement animation.
Empty lists have no handles and a single-author move is a no-op.

## Global, collection order and filters

The live subsequence of the existing `authors` array is the authoritative global
Following order. A move changes only live-author slots. Retained unfollowed records
keep their slots; no identity, display name, alias, timestamp or membership changes.
New follows append. Re-follow and guarded Undo resume the retained record's slot.
Author-page paper ordering remains unchanged.

Each selected user collection owns an independent manual author order, falling
back to the global subsequence until its first move. A scoped move never changes
All Following, other collections (even shared authors), or the sidebar order.
New members append to an existing manual order; removals prune references, guarded
Undo restores the removed position, rename preserves order and deletion removes
its order. Search hiding any member of the current scope disables handles with
Clear search instructions; a query matching the whole scope remains reorderable.

The inert-handle regression was this old global-filter guard: a collection with
three visible authors out of four followed authors disabled all three buttons.
Chrome showed registered pointer listeners and correct hit targets, but
`disabled=true`, `cursor=default`, and opacity .55. Source, generated build and
loaded extension module agreed. The repository previously supported only global
moves, so removing the guard alone would wrongly reorder other collections.
Now the guard compares with the selected scope and dispatches a scoped move.
Enabled handles inherit `cursor: grab`; active author drags use `grabbing`.

## Persistence, migration and backups

Local schema 7 introduced global-order semantics without adding a new data field.
The registered 6 → 7 migration initializes live-author slots to the old UI's stable
newest-followed-first comparator, preserving previously visible order. It keeps
all record fields, retained records and unrelated data unchanged. Schemas 1–5
upgrade through the existing consecutive steps. The exact original envelope is
backed up before activation; failed writes are retryable. See
[storage migrations](storage-migrations.md).

Schema 8 adds `authorOrdering: {version: 1, collectionOrders: []}`. Each explicit
order is `{collectionId, authorIds}` using stable IDs. The registered 7 → 8 step
adds the empty representation, preserving all previous visible/global order and
metadata. It uses the same validated recovery-snapshot and activation barrier.

The author-order milestone shipped in extension version 0.5.1. Portable backup version remains 3: its existing
`ordering.following` represents global order; additive optional
`ordering.authorsByCollection` carries explicit `{collectionId, authorIds}` orders.
Previously exported v3 files without it remain valid. Export All, Following
ZIP and self-contained author-collection JSON preserve the relevant orders.
A fresh import restores it exactly; populated destinations keep their existing
order and append new imported IDs. Offline PDF bytes and Feed caches remain excluded.
Order remains local and never enters Chrome Sync. Moving authors does not trigger
arXiv requests or alter discovery scope.

## Focus after dragging

The shared `bindReorder` helper distinguishes pointer completion from keyboard
completion. Pointerdown prevents native text/image dragging and focuses its
handle for click-to-keyboard access. An actual pointer drag releases only its own
focused handle on drop,
Escape, pointer cancellation, capture loss, window blur or explicit cancellation. A click below
the movement threshold retains normal native focus and keyboard access.

Only keyboard moves restore focus after asynchronous persistence/rerendering. A
focus-change guard prevents that restoration from stealing focus from another
control. Library and Following no longer unconditionally focus handles after saves.
No focus outlines are suppressed in CSS; the existing `:focus-visible` styling
continues to identify keyboard focus.

Chrome reproduced the old issue with cleared drag state but a real focused handle
matching `:focus-visible`. Programmatic focus at pointerdown, followed by unconditional
post-save focus (sometimes onto a replacement DOM node), inherited browser focus
visibility heuristics. Cancellation had no matching focus cleanup. This explains
why blurring in pointerup alone could not prevent the later asynchronous refocus.

## Verification

`tests/following-order.test.js` covers populated schema-6 migration, aliases and
retained slots, RPC moves, worker recreation, failure/retry, empty/single/no-op
moves, Undo, all/section/collection backups, and conservative populated imports.
Storage migration tests cover older completed/interrupted journals. Two-device
Sync tests verify independent local orders through preference updates and restart.
Shared reorder tests cover focus restoration, cancellation paths and another
control receiving focus during an asynchronous keyboard save.

`tests/author-collection-order.test.js` covers independent overlapping collection
orders through RPC, unchanged global/sidebar order and metadata, empty/single/no-op
cases, write failures, membership and Undo, fresh/populated/multiple-file backups,
malformed orders, v3 files without the optional field and schema-7 upgrade recovery.

After `npm run build`, run:

- `node scripts/author-collection-reorder-smoke.mjs`: the actual right-hand author
  list with George Dimitrov, Tom Bridgeland and Hiroshige Kajiura inside a selected
  collection plus hidden authors in another collection. Checks hit testing,
  computed grab/grabbing cursor, insertion, repeated up/down drags, cancel,
  keyboard focus, silent live announcements, search guards, unchanged sidebar and
  other author orders, page/worker/browser restarts, same-version schema-7 upgrade
  and full/section/collection backup restores. Screenshots are in
  `/tmp/xivary-author-collection-screenshots`.

- `node scripts/following-reorder-smoke.mjs`: actual 0.5.0 → current-version upgrade,
  direct upward/downward drag, keyboard/cancel, long names, search guards and collection
  handles, 360px layout, AX labels, metadata and PDF retention, worker/browser
  restart and full backup restore in disposable Chrome profiles.
- `node scripts/reorder-smoke.mjs`: Library interactions, independent ordering,
  fixed sidebar rows, geometry and backup persistence.
- `node scripts/reorder-focus-smoke.mjs`: repeated native mouse/emulated-touch drags, mixed
  keyboard/pointer input, cancellations and keyboard focus across all three row
  types. `XIVARY_FOCUS_PROBE=1` logs focus diagnostics without assertions for
  before/after investigation.

Screenshots are under `/tmp/xivary-following-reorder-screenshots`,
`/tmp/xivary-reorder-screenshots` and `/tmp/xivary-reorder-focus-screenshots`.
Native tests use deterministic local records rather than live arXiv queries.
Physical touch hardware and assistive speech still need manual verification.

Pre-release author-collection fix verification: 355 archive-free unit tests and both production
builds pass at extension version 0.5.0. Real Chrome 154/Linux passed the selected
collection author-drag suite (including computed cursors, reload/worker/browser
restart, names/membership isolation and full/section/collection backups). Existing
Library, Following sidebar/global-author ordering, shared mouse/emulated-touch
focus and migration regressions pass. Firefox 157 general regressions pass.
The native transfer/Chrome Sync lifecycle suite also passes (including recovery
alarm, worker recreation and browser restart; no account propagation claimed).
`git diff --check` passes. Release archives are not generated; the unit check for
existing release ZIP artifacts is excluded. These checks use disposable fixture
profiles, not the user's installed extension/profile.
