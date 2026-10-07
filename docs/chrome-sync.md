# Chrome library synchronization

Portable version-2 Bookmarks and Following imports use the ordinary
LocalRepository write and this layer's existing projection. Only changed records
in the selected category should acquire new Sync revisions: paper/collection/
membership (`p/pc/pm`) or author/collection/membership (`a/ac/am`). New portable
files never carry preferences, replica IDs, revisions, generations, tombstones,
bootstrap snapshots or pending-publication data. Selecting one category from a
legacy combined version-1 file has the same projection boundary. This does not
change Sync representation v1 or its conflict rules.

## Design and state partition

Schema 5 remains the local application view. RepositoryClient, repository RPC,
LocalRepository operations and migrations stay intact. A synchronizing storage
adapter beneath LocalRepository projects durable intent into small records and
materializes remote records into a validated local envelope. Firefox uses the
original local adapter, with no synchronization.

| Partition | Contents |
| --- | --- |
| Sync representation v1 | Paper ID, complete title and ordered author names, save/update dates; author identity/display name/follow dates; paper and author collection IDs/names/dates; individual memberships/dates; the two boolean preferences; logical revisions and deletion markers |
| Local canonical/metadata | Schema-5 envelope, full existing paper metadata including abstracts/categories/publication dates/notes/tags/read/unknown fields; last-used paper and author collections |
| Local synchronization bookkeeping | Replica ID, logical clock, retained winning records, retry time/error, and a one-time pre-sync library snapshot |
| Local reconstructible | Author-feed caches and freshness/query metadata |
| Ephemeral | Filters, pickers, page results, request state, repository Promise queue |

Remote papers render offline with their full title and author names and canonical
arXiv links. Missing abstracts/categories/publication dates use existing domain
defaults. There is no network hydration requirement. Existing canonical local
paper records always keep their full metadata. No topic/category follows exist.
Legacy notes/tags/read and unknown metadata remain local; no editing UI is added.

## Records, ordering, and deletion

One sync key per entity, collection, membership pair, or preference avoids
overwriting unrelated changes. Keys start `xivary.sync:`; values have independent
representation version 1. Revisions are `[logicalCounter, replicaId]`, ordered by
counter then lexicographic replica ID. A device advances beyond every revision it
has observed. Concurrent edits to the same register resolve deterministically;
wall-clock dates are display metadata only. This is not chronological last-edit
ordering across disconnected devices.

Memberships and collections use durable null-value tombstones. Deletion revision
history is retained when a record is restored. Memberships carry that collection
generation, so restoration cannot revive memberships from an earlier generation,
including concurrent additions made before observing the deletion. Renames keep IDs.
A concurrent rename/delete follows register ordering; a winning rename can restore
an empty collection. Concurrent distinct collections with the same name retain
both IDs and receive deterministic numeric
display suffixes to satisfy schema-5 uniqueness.

Unsave/unfollow deletes the memberships known to that device. An unseen concurrent
membership in another collection survives; a same-pair add/delete follows revision
ordering. This observed-membership policy is deliberate. A deleted collection
suppresses its memberships, even if those arrive later. Paper display and author
records remain in the replica after removal, but a local favorite exists only
while it has a valid live membership. Unfollow still retains local Author entities.
There is no safe automatic tombstone expiry without knowing every offline peer;
this implementation does not compact them or provide unlimited library capacity.

Each device durably retains the maximum record it has observed. Change events
merge both old and new values, and startup/repository activity reconciles the
current sync area. A stale transport overwrite is repaired from retained winners.
Convergence requires participating replicas to eventually run and Chrome to
deliver successful writes; it is not an atomic transaction across devices or keys.
Dependencies arriving separately are retained until they can form a valid view.

## First use and failure policy

Validate/migrate the local library first, using unchanged migrations 1–5. Save a
one-time local pre-sync snapshot (excluding reconstructible feed caches). Seed
existing intent at logical revision zero; merge with remote records, retaining
disjoint memberships/entities. Existing
remote records win overlapping seeds, even if also at revision zero; later explicit
offline changes receive nonzero revisions. Overlapping local full paper metadata
remains local, and the snapshot retains original organization/preferences. Empty
devices hydrate from sync; empty sync areas receive local intent. A reinstall is
a new replica, not a reason to erase remote state.

Local changes and their replica records commit together in the local envelope
before any sync write. Sync failures never roll back successful local operations.
Malformed records or unknown representation versions pause synchronization without
overwriting them; local operations remain available. A durable diagnostic records
the error. There is no reset-on-error. Retry/deferred writes use one named alarm;
storage changes drive remote updates, not a polling loop. A one-shot alarm defers
bursts by at least a minute; writes are spaced at least 2.1 seconds apart, with a
five-minute retry delay after publication failure. Read failures also arrange a
five-minute recovery attempt. No busy loop or timer must keep the worker alive.
UI surfaces continue to read via RepositoryClient and refresh on focus/reopening.

## Chrome constraints

Checked against the [official Chrome Storage API documentation](https://developer.chrome.com/docs/extensions/reference/api/storage)
on 2026-10-03: `QUOTA_BYTES=102400`, `QUOTA_BYTES_PER_ITEM=8192`,
`MAX_ITEMS=512`, `MAX_WRITE_OPERATIONS_PER_MINUTE=120`, and
`MAX_WRITE_OPERATIONS_PER_HOUR=1800`. The old sustained-write quota is deprecated.
These constants are exposed on the sync storage area. Quota failures reject
Promise calls. No cross-key transaction, distributed lock, or conflict ordering
is promised by that documentation; the replica merge supplies ordering.

Check serialized byte sizes/counts before publishing a batch, accounting for
unrelated existing keys. Never truncate titles/authors to fit. Oversized state
remains local and pending. Coalesce writes and retry conservatively; Chrome remains
the final quota authority. Tombstones consume quota. This is for small libraries,
not arbitrary collections of arXiv metadata.

A 100-paper fixture (105-character titles and three authors each, one membership
per paper, the default collection and both preferences) fits below 75,000 serialized
bytes in 203 records. This is an example, not a promised paper count.
Followed authors, additional collections, long names,
and deletion history consume additional quota. Preflight checks the entire proposed
batch plus other existing sync keys. An oversized record or total budget blocks
publication of that batch; it does not silently drop records or truncate metadata.

Only the Chromium manifest adds `alarms`. The [Chrome Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)
documents potentially delayed delivery and unreliable alarm persistence on older
Chrome versions, so background startup checks pending state again. There is no
strong timing guarantee. The create call also works on the declared Chrome 102
minimum, where it returns no Promise (await accepts that); get uses its supported
Promise API. Minimum-version runtime behavior remains untested.

Diagnostics are local, inside `arxivResearchLibrary`: `_chromeSync.lastError` for
publication failures, `_chromeSync.retryAt` for scheduling, and `_chromeSyncError`
for read/validation failures. `_chromeSync.records` is the durable pending/winning
replica and `_chromeSync.bootstrapSnapshot` retains original user data. Inspect
these through extension DevTools when troubleshooting; there is no reset or
sync-status UI for this bookkeeping. The separate user backup export deliberately
excludes every one of these fields. Do not delete tombstones as a quota workaround:
offline peers may reintroduce deleted intent. Unsupported records are left intact
and require a compatible version or deliberate diagnosis, not automatic reset.

Chrome account sync must be enabled, and installations must share the same
extension ID. Sync-disabled Chrome stores this area locally; offline Chrome queues
its own propagation. Unpacked copies with different IDs do not share a library.
This repository does not assign a Chrome Web Store identity; matching installation
identity and signed distribution remain to be verified. Do not change an existing
installation's extension ID as a shortcut: its local storage belongs to that ID.
There is no Xivary account or server. Google handles the synchronized research
library data. Firefox remains independent and does not use its sync area.

## Settings policy and compatibility

The persistent Settings inventory is complete:

| Setting | Classification | Reason |
| --- | --- | --- |
| `openArxivLinksInNewTab` | Synchronized boolean user preference | Durable link behavior follows user intent |
| `organizeFollowedAuthorsIntoCollections` | Synchronized boolean user preference | Durable preferred author organization UI |
| `lastUsedPaperCollectionId` | Device-local convenience state | Current local saving context, repaired only if invalid |
| `lastUsedAuthorCollectionId` | Device-local convenience state | Independent local following context, repaired only if invalid |

Unknown retained settings are not projected. `_chromeSync`, diagnostics, feed cache
query/freshness, request queues, filters and pickers are internal/derived or ephemeral,
not preferences. There are no other implemented persistent user settings.

Both preferences already fit Sync v1's `["s", preferenceName]` boolean registers.
A setter writes the desired boolean, never a toggle event. Independent preferences
merge independently; a changed value advances the existing logical revision, an
unchanged value does not. Counter/replica ordering and retained winners are identical
to other registers. Remote changes use the existing background onChanged path;
Settings reads through RepositoryClient on focus/reopening.

| Installation / remote state | Deterministic behavior |
| --- | --- |
| Existing local preferences, no remote registers | Publish retained local values at revision zero |
| Fresh default local, populated remote | Existing remote register wins bootstrap, including remote revision zero |
| Both sides populated | Remote overlap wins initial seed; after bootstrap, maximum logical revision then replica ID wins |
| Old bootstrapped Sync v1 without preferences | Merge/validate remote first; seed only registers missing on both sides at revision zero, without revising library records or advancing its clock |
| Malformed boolean, unknown preference or unsupported version | Pause synchronization, preserve preferences/library/remote data and diagnostics; local edits remain possible |
| Sync unavailable or publication fails | Local changes and pending registers remain durable; normal retry/alarm/startup recovery publishes later |
| Firefox / local-only adapter | Both preferences persist locally with no Sync replica or transport |

The older-replica seeding correction is compatible with existing Sync v1 data.
It neither changes schema 5/migrations nor increments the wire version. Missing
registers are not assigned an artificial recent revision that could overwrite
remote intent. A replica's earlier explicit edits and winning records remain intact.

## Verification

131 Node tests pass, including 39 independent-device Sync tests and 15 portable
format tests. Twelve focused preference tests cover classification, empty/fresh/
old-replica bootstrap, remote revision-zero intent, both-way propagation, independent
settings, stale/duplicate/delayed events, concurrency, restart, unchanged values,
failed publication/retry, malformed/unavailable transport, local-only persistence
and category-transfer non-interference. These transport tests are **simulations**.

Both 59-file packages pass byte/manifest comparisons. Chrome and Firefox fixture
smoke suites pass. The Chrome release suite also observes real sync-area reads and
writes, storage.onChanged, Settings focus refresh, pending alarm registration and
delivery, worker stop/recreation, extension reload and browser-profile restart.
It uses one dedicated unsigned-in profile with test-authored peer records; it does
**not** establish Google's account-mediated delivery. See
[browser verification](browser-support.md) and [release record](release.md).

## Pending real Chrome runtime procedure

Use only a dedicated test profile and test library. Run the Chromium smoke and
release suites first; the following is a read-only diagnostic for manual checks.
For manual inspection, open DevTools for an extension page in that test profile
(not the arXiv page's main-world console). The following reads storage and installs
a temporary diagnostic listener; it does not modify stored records:

```js
const onSyncChange = (changes, area) => {
  if (area === "sync") console.log("sync onChanged", Object.keys(changes));
};
chrome.storage.onChanged.addListener(onSyncChange);
const sync = await chrome.storage.sync.get(null);
const local = (await chrome.storage.local.get("arxivResearchLibrary")).arxivResearchLibrary;
console.log({
  syncKeys: Object.keys(sync),
  replicaVersion: local?._chromeSync?.version,
  bootstrapped: local?._chromeSync?.bootstrapped,
  publicationError: local?._chromeSync?.lastError,
  readError: local?._chromeSyncError,
  retryAt: local?._chromeSync?.retryAt,
  alarm: await chrome.alarms.get("xivary-sync-pending"),
  permissions: chrome.runtime.getManifest().permissions,
});
// After the interactive checks, remove this diagnostic listener:
// chrome.storage.onChanged.removeListener(onSyncChange);
```

1. Save/unsave, follow/unfollow, edit collections/memberships and change each boolean
   preference through the UI. Observe actual sync change events and re-read the
   snapshots above after deferred publication. Expected keys start `xivary.sync:`;
   records contain `v:1`, `rev`, `value`, `deleted`, and membership values include
   `generation`. Compare against the wire table in the shared data-model document.
2. Check actual sync records contain no `authorPaperCaches`, full library envelope,
   abstracts, notes/tags/read fields, last-used settings or bootstrap snapshot.
   Confirm feed loading populates only the local cache. Verify visible saves and
   follows through RepositoryClient-backed pages, not solely by inspecting keys.
3. Confirm `storage` and `alarms` permissions and pending alarm registration. Make
   several quick UI changes to create deferred publication, then close worker
   DevTools and avoid further repository/UI activity while waiting for the alarm.
   Re-read storage afterward to check publication; record whether alarm delivery
   was actually observed rather than inferring it from API availability.
4. With a separate pending change, reload the extension and then test a full restart
   of that dedicated Chrome profile. Confirm the local replica ID/library survive
   and pending records publish. A page reload alone is not evidence of worker or
   browser restart recovery. Record worker suspension/recreation as unverified if
   it cannot be reliably observed; do not force lifecycle behavior by changing code.
5. Perform the account propagation procedure in
   [browser-support.md](browser-support.md#pending-manual-chrome-sync-checks).
   A local `storage.onChanged` event or two unsigned-in profiles does not prove
   Google's cross-device transport. No personal-profile mutation, automatic login,
   storage clearing, tombstone deletion or production quota-filling is needed.
