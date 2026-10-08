# Following collection organization

## Investigation (before implementation)

Starting HEAD: `124f5e7994a391258e81f4192f7af9287fb139e4`, clean `master`,
two commits ahead of `origin/master`. Baseline: 131/131 Node tests pass.

The defect is incomplete UI wiring. Settings persists the organization boolean
through RepositoryClient and the existing Sync registers. LocalRepository already
implements author collection creation, renaming, deletion and memberships;
portable Following files preserve them. The arXiv Follow control already uses the
author collection picker when enabled. However, the Following page calls only
`listFollowing()`: it never reads the preference, collections or memberships and
has no collection controls. Existing browser tests cover the disabled list and
arXiv picker, but not an enabled Following collection workflow.

## Intended repair and data contract

Use the existing author library snapshot and author picker. Match Library's
sidebar, inline creation/rename, deletion confirmation and collection selection.
Keep paper/author repository models independent. Disabled organization hides
controls and displays all followed authors without modifying memberships.

There is no unclassified live follow in schema 5. A follow without an explicit
choice belongs to the default Following collection (or the last-used author
collection). All Following includes every live membership, including migrated
defaults. Retained author entities with no memberships are unfollowed metadata,
not hidden followed authors. Moving means adding the destination before removing
the source. Removing the last membership or deleting an author's sole collection
unfollows them; expose that consequence before deletion and in the picker.

No migration, schema change, Sync v1 change or portable format change is needed.
Legacy follows retain the existing idempotent migration to Following; malformed
stored records remain errors rather than being reset. All writes use existing
RepositoryClient operations. Library changes remain local; only the organization
preference uses Chrome Sync. Firefox remains
local-only; collection exports/imports keep their current independent contract.

## Using collections

Enable Settings → Following → Organize followed authors into collections. The
Following sidebar offers All Following and each collection with an author count.
Choose a collection to browse its members; empty collections remain selectable.
`+ New collection` opens inline entry (Enter saves, Escape cancels). Use the
row context menu (right-click or Shift+F10) for Rename/Delete collection.
Double-click or F2 also starts rename; single click still selects immediately.
Rename saves on Enter; Escape or outside click cancels without saving. Delete opens
a Cancel/Delete dialog
explaining sole-membership unfollows. Escape/outside dismiss the menu; keyboard
arrows navigate its actions and focus returns to the trigger after cancellation.
Collection names retain the existing unique-name validation.

Each author's folder-icon button opens the shared membership picker. Multiple
checked collections are allowed. For a move, check the destination before clearing
the source. The picker also creates a collection with that author assigned. Done,
outside click and Escape close it. Unfollow still removes all memberships.
No new Uncategorized entity is introduced: ordinary/default follows and migrated
legacy follows appear in All Following and their existing collection.

Mutations reload the repository snapshot immediately. Reload/reopening reconstructs
collections and memberships; selected collection is ephemeral, initially All
Following, just like Library's All Saved. Switching off organization shows the
original plain list. Refocusing reads remote changes through the existing RPC path.

## Regression evidence

The deterministic suite adds four tests: complete toggle/move/restart/metadata and
Bookmark isolation; legacy default membership plus idempotent collection import;
missing preference defaults and malformed membership non-reset; independent-device
Sync preference propagation with local-only toggle/move/rename/delete/restart
collection isolation. Existing migrations, portable
collision/legacy/atomicity and Sync failure tests remain unchanged.

The shared `scripts/following-workflow.mjs` scenario runs inside both existing
browser smoke commands, with native clicks and Enter/Escape events. It exercises
disabled/default state, enable/disable, create/cancel, rename/cancel/duplicate error,
assignment/move, counts/collection filtering, last-membership removal/restoration,
delete/cancel and preserving another membership, reload, metadata preservation and
Bookmark independence. Chrome also checks desktop/narrow layout and captures
screenshots when `ARXIV_SCREENSHOT_DIR` is set. The release suite checks remote
preference focus refresh and browsing restored assignments after full Chrome
profile restart, alongside the existing native portable transfer/Sync lifecycle.

Firefox remains a temporary generated add-on test: signed-installation restart,
native Firefox file transfer and actual account-mediated Chrome delivery remain
manual release checks. No account propagation is inferred from fixture browsers or
two-repository simulations. See [release status](release.md#release-assessment).

Final results on 2026-10-08: **135/135 Node tests**, no skips/failures;
`test:browser`, `test:firefox`, `test:release`, optional `test:arxiv`, both package
commands and `git diff --check` pass. Chrome 154.0.8037.57 / Firefox 157.0 with
geckodriver 0.37.1 were exercised in disposable profiles. Both packages have
60 files at version 0.2.0, match source runtime bytes, and add no permissions.
The live harness readiness check was strengthened after an initial premature
zero-row sample; rerun retrieved all five expected live author feeds.

## Author interaction polish — 2026-10-09

Whole-collection deletion now uses a native modal dialog naming the collection and
explaining sole-membership unfollows. Ordinary Unfollow or membership removal takes
effect immediately with an eight-second Undo. Metadata/removed memberships return
only if the item and target classifications are still unchanged; other authors,
Bookmarks, preferences and last-used pointers are never rolled back. Multiple
receipts are independent; newer changes to the same author invalidate older Undo.
Restarting the background safely invalidates the ephemeral receipt.

Following and Library share input focus, Enter/Escape, whitespace cancellation,
outside pointer cancellation and duplicate-submit guards. The shared Chrome/Firefox
workflow covers these changes and Unfollow/Undo, in addition to prior organization,
collection operations, reload and isolation checks. Author results also offer
Follow/Unfollow and the existing optional collection picker beside the name.
