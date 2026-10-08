# Chrome settings synchronization

Chrome Sync synchronizes **only** `openArxivLinksInNewTab` and
`organizeFollowedAuthorsIntoCollections`. Bookmarks, Following, paper/author
collections and memberships remain local to each installation, including after
manual import. Firefox uses local-only storage for everything. There is no Xivary
account, OAuth, backend or alternative provider.

## Partition and boundaries

| State | Policy |
| --- | --- |
| Two designated boolean user preferences | Chrome Sync v1 desired-state registers |
| Both last-used collection pointers | Device-local interaction context |
| Papers, followed authors, collections, memberships, full metadata | Local only |
| Author-feed caches, unknown settings/fields, queries and freshness | Local only |
| Replica identity/clock/winners/pending retry/diagnostics | Local bookkeeping |
| Filters, pickers and request/queue state | Ephemeral |

Settings → RepositoryClient → shared RPC → LocalRepository → SyncStorage →
BrowserSyncStorage remains the only persistence path. UI/domain code never opens
native storage or subscribes to storage events. Schema 5 and migrations 1–5 are
unchanged. Portable `xivary-library` v2 All/collection files remain a separate
representation: no preferences, caches, last-used pointers or Sync internals.
Category imports change local library state without acquiring Sync revisions.

## Active Sync v1 contract

The exact canonical keys are:

- `xivary.sync:["s","openArxivLinksInNewTab"]`
- `xivary.sync:["s","organizeFollowedAuthorsIntoCollections"]`

Each value remains `{v:1, rev:[logicalCounter,replicaId], value:boolean, deleted}`.
Existing encoding/ordering is retained; no protocol version increment is needed.
`deleted` is the retained legacy deletion revision or null; preference values
cannot be null/toggle events. Projection, validation, observation, merge,
materialization and publication all use the same explicit key allowlist. Unknown
preferences, malformed/noncanonical keys and legacy library types are inactive.
No library constructors or collection reconstruction exist in the active model.

Independent booleans merge independently. Logical counter then lexicographic
replica ID orders conflicts, with the existing deterministic equal-revision value
rule. Wall-clock dates do not order conflicts. Unchanged desired values do not
advance revisions. Retained winners merge old/new events, repair stale overwrites
and survive restart. Convergence requires eventual successful provider delivery
and participating replicas; it is not a cross-device transaction.

## Nondestructive legacy cutover

See [the strategy recorded before implementation](settings-only-sync-migration.md).
Older versions uploaded `p/a/pc/ac/pm/am` library registers. Updated installations:

- Preserve the entire current local library, including already-restored data and
  unknown metadata. There is no reliable provenance for automatic removal.
- Ignore those remote records, generations and tombstones on reads/events. They
  cannot add, overwrite, rename or delete local library records, even on a fresh
  installation, delayed event, restart or extension reload.
- Preserve legacy local replica records and earlier bootstrap snapshots as inert
  bookkeeping. Never validate, merge, repair or publish their library entries.
  Retain replica identity/counter and active preference winners/pending revisions.
- Never delete, clear, tombstone or rewrite remote legacy records. Older versions
  may continue synchronizing library data among themselves. This update does not
  retroactively erase data from Chrome's synchronization mechanism.

New replicas snapshot only the two preferences. Existing snapshots are unchanged.
There is no schema migration, collection rewrite, new permission or cleanup UI.
A later remote cleanup would require a separate explicit product/user decision.

## Bootstrap, failure and recovery

| Situation | Result |
| --- | --- |
| Existing local values, absent remote preferences | Seed retained values at revision zero |
| Fresh defaults, established remote preferences | Remote overlap wins initial seeds, including revision zero; library remains empty/local |
| Both sides initialized | Maximum logical revision/replica ordering wins each boolean |
| Older v1 replica without preferences | Validate/merge active remote first, seed only keys absent on both sides at revision zero |
| Legacy library data, malformed/unsupported legacy records, unknown preferences | Ignore without applying or rewriting; known preferences can still synchronize |
| Malformed/unsupported **known** preference | Pause active synchronization, retain local values/library and untouched remote bytes with diagnostic |
| Unsupported/damaged local replica | Keep verbatim; local operations remain possible, publication pauses |
| Failed/unavailable Sync or exhausted quota | Keep local intent/pending records; existing alarm/startup recovery retries |
| Firefox | Preferences and library remain local; no Sync area/replica |

Local canonical state and pending preference registers commit together before
best-effort publication. A local write failure rejects without publishing that
operation. Provider failure never rolls back a successful local edit. Read failure
never becomes a fabricated empty remote snapshot. No reset-on-error, polling,
wall-clock conflict ordering, toggle replay or automatic history expiry is added.

The shared background observes active preference changes, serializes reconciliation
through the repository queue, and resumes pending writes on startup/one-shot alarms.
Legacy-only events do not wake reconciliation. UI refreshes via RepositoryClient
on focus/reopening. Writes retain the existing 2.1-second interval, five-minute
failure retry and at-least-minute deferred alarm. Alarm delivery is not an exact
scheduler; startup also checks pending state.

## Quota, privacy and diagnostics

The existing preflight accounts for the complete proposed sync area, including
foreign and legacy keys. Native Chrome storage limits remain the final authority.
Legacy data can occupy quota and cause preference uploads to remain pending;
Xivary must not delete it to make room. No research-library upload is performed.
`storage` and Chromium-only `alarms` remain justified for local persistence and
preference recovery; Firefox omits `alarms` and never enables its Sync backend.

Diagnostics remain in `arxivResearchLibrary`: `_chromeSync.lastError` (publication),
`_chromeSync.retryAt` (recovery), `_chromeSyncError` (read/validation), and
`_chromeSync.records` (active winners/pending preferences plus inert old entries).
Old `_chromeSync.bootstrapSnapshot` data is retained locally. None enters portable
files. Do not interpret local deletion or this cutover as a remote purge.

Chrome account synchronization must be enabled with matching extension IDs.
Dedicated unsigned-in profiles and fake transports do not prove account delivery.
No credentials or ordinary profiles are automated. See [privacy](../PRIVACY.md),
[browser verification](browser-support.md) and [release record](release.md).

## Verification

The deterministic suite covers two independent local disks/repositories and a
shared fake transport: only preference propagation; separate libraries; legacy
live/tombstone/malformed/unsupported records and pending replicas; idempotent
cutover; migrations; bootstrap; conflicts/replay/restart; local/provider failures;
quota and coalescing; category-import isolation. It replaces obsolete expectations
that library records should propagate with explicit non-propagation assertions.
These tests are simulations, not Google-account evidence.

The real Chrome release harness exercises retained local/remote legacy records,
a fresh profile receiving only preferences, native All/collection transfer with no
library upload, onChanged/focus refresh, deferred alarm/worker recovery, extension
reload and full profile restart. Chrome/Firefox UI fixture suites and package byte/
manifest checks remain required. Final counts/status are recorded in
[the release record](release.md#settings-only-sync-cutover).

## Manual release checks

Use dedicated matching-ID installations A/B on the same developer-provided account:

1. Change each boolean on A then B; refocus Settings/Following and observe delivery.
2. Save/follow/create/rename/move/delete locally; verify the other installation's
   library and last-used pointers do not change, including after restart.
3. Import a Bookmarks/Following collection on A; verify it remains absent from B
   while preference propagation still works.
4. Upgrade installations with legacy local and remote state. Confirm local data
   survives and legacy remote records remain unchanged/ignored; fresh installation
   restores only preferences. Record old-version coexistence separately.
5. Verify offline preference convergence, unavailable/disabled Sync, retry recovery
   and quota occupancy without deleting history or using normal profiles.
