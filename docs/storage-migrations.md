# Automatic storage migration and upgrade safety

A normal Xivary update never requires an Export/Import round trip, reset, or
recreation of user data. Every persistent model change must ship its automatic
migration and upgrade-path tests in the same milestone.

## Independent versions

| Representation | Current version | Owner |
| --- | --- | --- |
| Browser-local research envelope | 8 (`schemaVersion`) | `repository/local-schema.js` |
| Following selection UI preference | 1 | `domain/following-selection.js` |
| Library selection UI preference | 1 | `domain/library-selection.js` |
| Library RPC snapshot | 2 (`snapshotVersion`) | `domain/library-snapshot.js` |
| Portable research backup | 3 | `repository/portable-backup.js` |
| Chrome preference Sync | 1 | `repository/sync-model.js` |
| Migration recovery IndexedDB | 1 | `repository/migration-recovery.js` |
| Offline IndexedDB | 2 | `repository/offline-storage.js` |
| Persisted Feed queue | 3 | `feed/queue.js` |
| Extension manifest | 0.5.1 | `extension/manifest.json` |

These versions are independent. No migration decision uses the manifest version.
Schema 6 introduced required ordering while retaining schema 5's local
papers/authors/collections/memberships and adding mandatory `paperOrdering` plus
the current settings defaults. Existing explicit
collection/per-collection paper orders survive; absent schema-5 ordering derives
from the original collection and Library arrays. Unordered collections stay on
their existing fallback order; migration does not invent manual paper orders.

## Registry and initialization

`STORAGE_MIGRATIONS` explicitly registers one transition per source version:

1. 1 → 2: convert paper-position author identities to name keys. Preserve optional
   metadata; conflicting optional metadata for collapsed names stops migration.
2. 2 → 3: introduce separate author collections/memberships with the stable
   `collection:following` ID; retain original follow timestamps and metadata.
3. 3 → 4: introduce an absent author-result cache without clearing an existing one.
4. 4 → 5: introduce paper collections/memberships with the stable Saved Papers ID.
   Existing complete groups are retained; incomplete groups fail safely.
5. 5 → 6: persist current defaults only where absent and initialize/validate
   ordering. Known partially introduced ordering fields can be completed;
   malformed values fail instead of being replaced by empty arrays.
6. 6 → 7: make the author array authoritative for manual Following order. Initialize
   live-author slots from the previous stable newest-followed-first UI ordering.
   Retained unfollowed records keep their slots. No author field, identity,
   timestamp, alias, membership, Library order, Feed cache or PDF changes. New
   follows append; a re-follow resumes its retained slot. No new ordering field
   or portable version is needed.

7. 7 → 8: add required `authorOrdering: {version: 1, collectionOrders: []}` for
   independent manual author orders inside Following collections. Empty manual
   orders retain each collection's existing global-array subsequence. No author,
   collection, membership, global order or custom metadata is rewritten. The exact
   original envelope is saved before activation and interrupted upgrades retry.

The entire candidate is constructed and validated in memory before any migration
write. Records, canonical IDs, timestamps, duplicate identities, collection names,
memberships, settings and ordering are checked. Unknown owner metadata remains on
the cloned envelope. No arXiv request, metadata replacement or random ID is needed.
A current version missing mandatory fields is an integrity error, not an empty
installation. Only an absent storage key means a fresh installation.

`MigrationStorage` wraps the raw local adapter **below SyncStorage**. LocalRepository
serializes operations, holds a shared `navigator.locks` lock across the complete
read/modify/write and Sync bookkeeping, and receives initialized current data.
Fixture adapters use a shared-identity promise queue. The common background is the
only repository entry point; all views use RepositoryClient. Offline calls wait
for initialization before invoking their separate repository/database operations.
PDF download time does not hold the local migration lock.

Checks occur at background module startup, runtime onInstalled/onStartup, every
lazy repository read, and after worker restart. An unchanged-version unpacked
reload is covered by module startup even if an update event is absent. Completed
current data does not execute migration steps or receive migration writes on
ordinary page loads. Validation still detects damaged data. Failed initialization
is retryable; no cached rejection permanently blocks recovery.

## Failure-safe commit and recovery snapshots

For the production BrowserLocalStorage adapter:

1. Read the active `arxivResearchLibrary` key.
2. Build and validate the complete candidate.
3. Write an exact original snapshot to the separate, local-only key
   `xivary:local-migration:<from>:<to>`. If duplicating the envelope exceeds the
   local-area quota, commit it transactionally in the independent
   `xivary-storage-recovery` IndexedDB database instead.
4. Write the validated active envelope and its new `schemaVersion` together in
   one storage-key replacement.

The recovery value is an internal `xivary-local-migration` version-1 journal with
`from`, `to`, `createdAt` and `source`. It is **not** a portable backup, is not
uploaded or exported, and contains no Offline PDF bytes. Recovery IndexedDB version 1 creates only its
own `snapshots` store in an upgrade transaction; it never opens `xivary-offline`.
This fallback allows large existing Libraries to upgrade without doubling their
usage of Chrome’s 10-MiB local-area quota or adding permissions. Existing snapshots are
retained. A retry reuses a matching snapshot and its original timestamp. A
conflicting snapshot/data pair blocks migration; neither is overwritten.

A crash before the active write leaves the old key usable by its old representation
and the recovery snapshot durable. A crash after it leaves a complete new version.
There is no separate success marker that can advance before the records commit.
No cross-key transaction is assumed. Single-key test/backend adapters can stage
`_storageMigrationJournal` alongside unchanged old records, then atomically replace
the envelope with the candidate and retained source journal. A restart validates
that staging still matches the source before retrying. Current-schema checks do
not replay completed journals. On a later schema upgrade, an older completed or
interrupted in-band journal is retained inside the exact source snapshot of a new
journal targeting the current schema. An interrupted same-target migration checks
the source body and resumes; incompatible or conflicting journals stop safely.

Backup quota errors, malformed data or failed active writes leave user records
intact. Migrations never clear an area, reset preferences, remove memberships,
or touch/delete the independent Offline stores. Legacy name-key identity changes
retain the complete original source for recovery and fail on conflicting custom
metadata instead of silently discarding it.

## The collectionIds regression

New Library code dereferenced `library.ordering.collectionIds`, but the previous
committed background returned a Library DTO without `ordering`. The current
repository already derived ordering when the optional stored field was absent;
missing stored ordering alone could not explain that particular error.

The native test reproduces the exact error with the previous worker and newer UI
files, then repairs rendering through an explicit, validated v1 → v2 RPC snapshot
adapter in RepositoryClient. This adapter uses real validated records/memberships
and their known previous array ordering. It does not write storage or synthesize
empty papers. A declared v2 response missing ordering or containing broken
references is rejected. New background replies always declare v2 and storage v8.

Loading the same unpacked path through Chrome's testing LoadUnpacked command can
reuse the running worker. The source-upgrade test performs a genuine runtime
reload/re-enable, with the same extension path/ID and unchanged manifest version,
to test the migration barrier. Ordinary Library response compatibility remains
safe while old responses are in flight. New persistent features require the
updated worker, as with any extension-code update.

## Sync and Offline boundaries

Only the four designated boolean preference registers are synchronized. Migration
versions, recovery journals, bookmarks, Following, collections, ordering, PDFs
and Feed/evidence caches stay local. Sync v1 remains independent of local schema
8. Migration happens before remote merge/flush; legacy library records from old
devices remain inert and untouched. Validated preference revisions retain their
existing winner rules; migration adds no wall-clock conflict order or replay loop.

Offline IndexedDB has its own transactional upgrade: version 1 → 2 adds the
savedAt index without rewriting or deleting copy records/PDF blobs. Connections
close on versionchange and blocked upgrades report an error. Local schema 8 does
not change that database. Feed queue migration/eligibility remains on its existing
versioned path; local research migration preserves its cache and provenance.

## Diagnosing a failure

Library displays an initialization error and a small Retry loading action rather
than “No saved papers.” Existing displayed data can remain visible, with edits
disabled until a successful retry. Retry reruns the same validation/barrier.
Other repository views receive the same initialization failure.

Inspect the error, the active key's schema version, and the matching local recovery
key (or the `snapshots` recovery store when local quota caused fallback)
non-destructively. Do not clear local storage, reset a replica, uninstall the
extension or delete IndexedDB. Back up the affected profile before any manual
repair. If source/recovery disagree or required records are invalid, fix the
specific cause with a reviewed, lossless repair; do not blindly restore an older
snapshot over newer work. Unsupported future schema versions stop safely.

## Future changes and verification

Add the next consecutive registry step, advance STORAGE_SCHEMA_VERSION, update
fresh-state creation/current validation, and add tests for populated previous
states, user customizations, interrupted writes/restarts, concurrency and Sync
isolation. Keep stable IDs and deterministic ordering. For IndexedDB/Feed changes,
advance their own version and test the corresponding transaction/cache upgrade.
For new RPC fields, evolve the explicit snapshot adapter/contract rather than
assuming every open view and worker changes simultaneously.

`tests/storage-migrations.test.js` exercises fresh/current/no-write behavior,
previous schema data/order/customization, malformed and partial data, sidecar and
in-band interruption/recovery, concurrent repository/client operations, Offline
barrier isolation and the exact DTO regression. Existing schema 1–4 tests remain;
two-device Sync tests cover migration plus older-peer preference/legacy records.

After the production build, `node scripts/migration-smoke.mjs` uses a disposable
Chrome profile, real old-worker/new-UI mismatch, actual unchanged-version source
upgrade, custom metadata/order/membership, retained Feed/PDF bytes, recovery error
and retry, worker suspension, repeated reload and browser restart. Screenshots are
in `/tmp/xivary-migration-screenshots`. It reads and modifies only test profiles.
`node scripts/migration-quota-smoke.mjs` exercises actual Chrome local quota with
a six-MiB annotation, verifies the IDB snapshot before activation, and opens Library
directly and after worker restart. The real affected profile is not accessed or
reset by these suites. Physical devices,
Google-account propagation and assistive speech remain separate manual checks.

`tests/following-order.test.js` and `scripts/following-reorder-smoke.mjs` cover the
schema 6 → 7 order transition followed by 7 → 8 during a real 0.5.0 → current
source upgrade,
including original recovery data, custom metadata, PDF bytes, manual movement,
worker/browser restart and full backup restoration. See [Following ordering](following-reordering.md).

The optional local Library-selection preference uses a separate version-1 key;
existing installations initialize by absence without transforming the research
envelope. Its upgrade-path tests preserve installed research data and migration
recovery snapshots. See [last selected collection](library-selection.md).

Following collection moves reuse existing collection-array semantics, so they need
no schema transition. The optional version-1 Following selection key initializes
by absence independently of Library; installed-data/backup tests preserve prior
records and order. See [Following collections](following-collection-ordering.md).

`tests/author-collection-order.test.js` additionally checks the exact schema-7
source, failed activation/retry, concurrent initialization, current-schema corruption,
independent overlapping orders, Undo, portable restoration and category isolation.
`node scripts/author-collection-reorder-smoke.mjs` verifies the actual right-hand
author handles, grab/grabbing cursors and native drags inside a collection, plus
same-version extension reload, worker/browser restart and all/section/collection
backup restores in disposable Chrome profiles.
