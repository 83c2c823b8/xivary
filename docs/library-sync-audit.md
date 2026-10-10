# Optional library synchronization audit — 2026-10-10

**Implementation stopped at the safety gate.** Strict operation acceptance order
cannot be obtained through Chrome's extension storage API. This audit does not
enable library synchronization, add a functioning Sync toggle, migrate user data
or replace the existing preference conflict policy. A compact snapshot fitting
quota is not evidence of safe synchronization. The user's revised section 7
supersedes the earlier requested conflict model; do not quietly reinstate Sync v1
library records or substitute replica ordering for authority acceptance order.

Starting state: clean `master`, HEAD
`34e61c70eb111fd5d2f6854c1c2f95da91c6ef63`. Baseline: 182/182 Node tests pass.
Version 0.3.0 and permissions remain unchanged. No real user profile was read or
modified; measurements use reproducible synthetic fixtures and disposable profiles.

## Existing persistence and UX

`RepositoryClient` sends allowlisted operations to the background-owned
`LocalRepository`. Its queue serializes local reads, validated migrations and
writes. Only `lib/storage.js` opens native storage areas. One schema-5 envelope,
`arxivResearchLibrary`, in `storage.local` contains:

- `favorites`: full paper titles, identifiers, ordered author references, URLs,
  saved/updated/publication dates, categories, abstracts, read state, tags and notes.
- `authors`, `collections`, `memberships`: retained author metadata and separate
  many-to-many author organization. Membership, not retained metadata, means followed.
- `paperCollections`, `paperMemberships`: paper organization and saved state.
- Settings, both local last-used collection pointers, author-feed caches, unknown
  preserved fields and Chrome replica/pending diagnostics.

Paper IDs are unversioned arXiv identifiers. Author IDs use normalized name keys
(NFKC/whitespace/punctuation/case); namesakes still share identity. Collection IDs
are stable UUID-based opaque identifiers, with stable default IDs. Membership
identity is the entity/collection pair. No timestamp is a global operation ID.

Chrome's `SyncStorage` decorator projects **only four** boolean preference
registers. Firefox never uses its sync area. Chrome's local state and pending
preference winners are committed together before best-effort upload. Unknown
active versions fail closed, unavailable reads never become empty remote state,
and retained local winners survive write failure/restart. Legacy library records
and tombstones are inert and untouched locally/remotely. The four preferences are
currently automatic, not governed by a user-visible Xivary ON/OFF setting.

Local save/follow/delete/collection operations and validated category imports
work independently of provider writes. Imports validate the whole document before
one local write; portable v2 files remain category-scoped and idempotent, exclude
settings/caches/Sync bookkeeping, and accept selected categories from combined v1.
Final paper membership removal removes its canonical favorite; unfollow removes
memberships but retains author metadata. Collection deletion removes its
memberships. Eight-second Undo receipts and entity guards live in worker memory,
not durable synchronization history. Schema 1–5 migrations preserve unknown data.

Remote preference events reconcile the background queue. Open pages reread on
focus/reopen and after their own mutations; there is no general live library event
subscription. Do not assume a newly synchronized library would immediately refresh
every open view without a repository notification/lifecycle design.

The requested three UX behaviors already exist and remain unchanged:

| Request | Existing implementation |
| --- | --- |
| Contextual author Follow/Unfollow | `author/author.js`, actual membership reread, desired-state RPC, local errors and Undo |
| Configurable arXiv author navigation | Default-true `openAuthorResultsInNewTab`, validated background handler, preserved original href and native modified/middle clicks |
| Collection form Enter/Escape/outside behavior | Shared `ui/collection-create.js`, pointerdown containment, no blur creation, duplicate validation and single submission path |

## Measured capacity

The current [Chrome storage reference](https://developer.chrome.com/docs/extensions/reference/api/storage)
documents 102,400 bytes total, 8,192 bytes per item and 512 items for Sync, plus
120 writes/minute and 1,800/hour. Quota counts serialized JSON values and keys;
`getBytesInUse` reports native usage. Native Promise writes can reject. Chrome
sign-in and provider configuration govern propagation; offline/disabled provider
behavior does not turn a local write into a remote acknowledgment. The existing
MV3 Chromium manifest permits storage and alarms, with minimum Chrome 102. Neither
new permissions nor newer `getKeys` APIs are needed for this audit.

The estimator uses UTF-8 bytes of each key plus `JSON.stringify(value)` and checks
all three ceilings. It matches native `getBytesInUse` for these fixtures, including
Unicode/escaping. Native rejection remains authoritative for other data/browser
versions. The entire proposed area must include existing legacy/unknown keys.

Reproduce:

```sh
node scripts/sync-capacity-audit.mjs
node scripts/sync-capacity-browser.mjs
```

Fixtures: 100 researchers with varied Unicode names; 13 collections (8 paper,
5 author); 4–8 authors and >1,000-character mathematical abstracts per paper;
one membership per entity, with every third entity in a second collection.
No caches, inert old bookkeeping or deletion history are included. These are
actual serialized fixture sizes, not measurements of a user's existing library.

| Papers | Memberships | Full local envelope bytes | Removed v1 wire bytes / keys | Compact snapshot lower bound bytes / keys |
| ---: | ---: | ---: | ---: | ---: |
| 300 | 534 | 865,828 | 287,921 / 951 | 31,170 / 10 |
| 500 | 801 | 1,411,728 | 435,859 / 1,418 | 43,484 / 12 |
| 1,000 | 1,468 | 2,776,486 | 805,629 / 2,585 | 74,264 / 17 |

The local sizes use the real envelope key. They are below the current Chrome local
limit, but cannot be copied to Sync as one item. Removed v1 projection, inspected
at `f33a925`, keeps offline titles/authors, dates and individual membership/generation
registers. This audit includes today's four preferences. Its largest items are
432–433 bytes; **both total bytes and key count fail** even at 300 papers.

The compact measurement includes four preference registers (532 bytes), versioned
6 KiB shards, stable IDs, collection names, numeric display dates, snapshot-local
collection references and a SHA-256 part manifest. Maximum items are 6,105/6,134/
6,134 bytes. Titles/abstracts/large author lists stay out. The manifest describes
capacity only: it supplies no accepted-operation sequence, concurrent writer
ownership, deletion fences, acknowledgments or safe compaction. It is never loaded
by extension code. It must **not** be shipped as whole-library replacement sync.

Chrome 154 native checks match the estimator. Snapshot-only native usage is
30,638/42,952/73,732 bytes; add the 532-byte preferences for the table totals.
The native local audit key is one byte shorter than the real key. A 98,830-byte
area is accepted (>90%); per-item, total and item-count violations are deliberately
rejected in the disposable harness without modifying prior values. Product code
must preflight known-impossible writes rather than copying those rejection tests.

Remaining capacity is not a fixed capacity promise: retained foreign/legacy data,
multiple devices, operation history, long names, collection density and manifests
all consume it. For example, 503 existing unrelated keys plus the 10-key 300-paper
candidate fail item count despite fitting bytes. A future protocol must budget its
actual next complete publication, rollback/staging needs and conservative headroom,
not automatically suspend just because usage crosses 90%.

## Why strict acceptance ordering is blocked

The public API exposes key/value reads/writes and local change events, not a
global append operation, compare-and-swap, accepted sequence number, authority
receipt or replayable ordered log. `onChanged` exposes old/new values, without an
authority index. Successful `set` is not account delivery evidence. There is no
supported way to recover an authoritative order from these observations.

Counterexample: operations `a:1 = add X` and `b:1 = remove X` produce identical
unique-operation key maps in either acceptance order. The required final state
differs (absent after add/remove; present after remove/add). A new offline replica
reading that map cannot distinguish those histories. Local notification order
may differ between replicas; sorting operation IDs or Lamport counters is a
different conflict policy. Device-local dates must not order conflicts.

Unique immutable operation IDs could preserve independent additions and retries,
but do not solve acceptance ordering. Shared mutable chunks can overwrite another
writer's additions. Missing snapshot parts cannot imply empty/deleted memberships.
Deleting removal/deduplication history permits a stale offline add to look new.
Time-based tombstone expiry is unsafe for indefinitely offline replicas. None of
these issues is fixed by packing smaller tuples or a successful provider write.

`tests/sync-arrival-contract.test.js` records these specification counterexamples;
it is not a test of a deployed operation protocol. Existing preference logical
counter/replica ordering remains documented as eventual preference convergence,
not strict server-arrival consistency.

## What is necessary before library implementation

For the strict contract, an authoritative sequencer must durably accept operation
IDs exactly once and expose ordered replay/checkpoints. Chrome Sync alone provides
no such facility. No service, account, credential flow or server was introduced.
Alternatively, a separately accepted relaxed contract could specify deterministic
operation conflicts explicitly; this audit does not treat silence as acceptance.

Either route still needs:

1. A versioned, independently owned operation representation with stable IDs,
   durable local outbox, complete-dependency validation, restart-safe retries and
   compatible treatment of mixed/unknown versions and untouched legacy keys.
2. Add/remove and collection-generation rules covering deletion, rename,
   memberships, Undo, category import, and edits while the toggle is off. No remote
   incomplete snapshot may replace current local state or discard unknown fields.
3. Safe history bounding: acknowledged checkpoints and explicit replica retirement/
   stale-replica rebootstrap, or retained history plus capacity pause. Never expire
   deletion fences merely to free quota. Removing independent operations early
   cannot be justified by one successful local provider write.
4. A metadata hydration model: schema 5 requires a nonempty title and author list
   for every saved paper. An ID-only remote paper cannot currently materialize.
   Offline placeholders/lazy fetch must preserve existing full metadata and must
   not make a save dependent on network availability.
5. A local default-OFF preference separate from automatic pause diagnostics.
   Persist local state/outbox before transport. Derive Disabled/Pending/Paused/
   Error honestly; any Enabled label must qualify provider/account uncertainty.
   OFF must retain local intent/history and remote data. No destructive reset.
6. Preflight full provider occupancy, exact per-key/key-count/byte budgets and
   actual quota failures. Keep pending operations while paused. Known-impossible
   publications should wait for changed capacity/explicit retry; recovery must
   read/validate/reconcile before publishing, never prune user data to fit.
7. Multi-device protocol tests for concurrent additions/removals/follows, offline
   edits, collections, retries, partial publication, reordered events, quota
   recovery and retired/stale replicas. These audit counterexamples and existing
   preference tests are insufficient to claim a completed library protocol.

No new toggle/status/capacity UI is added while that backend is blocked. This
avoids presenting Disabled or Enabled as states of an unimplemented library feature.
The current preference adapter still retries failures on its existing alarms;
this audit does not claim new pause controls or pending **library** operations.

## Support and verification scope

No valid Buy Me a Coffee URL was found in repository source/documentation. The
optional support footer/link remains a follow-up awaiting a real configured URL;
no placeholder, donation banner or paid-server claim was added. Existing Settings
remains unchanged. Screen-reader, real Google-account delivery, store-signed and
minimum-version checks remain outside disposable-profile verification.

The audit adds fixture/quota tests and the specification counterexamples. The
target-size local test exercises rejected provider writes, subsequent save/follow,
pending preference retention/restart/recovery, unknown versions and preservation
of the original records/memberships. It explicitly verifies **no library upload**.
Final verification:

- **192/192 Node tests pass**, including existing independent-device preference
  simulations and the ten new capacity/safety tests.
- **Chrome 154 native capacity audit passes** for all three fixture sizes,
  Unicode accounting, >90% occupancy and provider rejection of all three ceilings.
  A startup race in the new harness initially captured preferences before their
  bootstrap; the harness now explicitly awaits all four registers and passes.
- **Chromium browser and polish suites pass on isolated rerun.** The first
  concurrent run failed the existing collection-menu focus assertion at
  `following-workflow.mjs:188`. No application/test assertion was weakened or
  changed to obtain the passing rerun; retain this result as a runtime-test caveat.
- **Firefox 157 smoke passes**, using direct Firefox/geckodriver binaries in the
  installed Snap distribution. Native Chrome Sync checks do not apply to Firefox.
- **Release integration passes** native transfer, preference events, real deferred
  alarm/worker recovery, reload and full disposable-profile restart.
- **Both 144-file browser packages pass**; runtime source, version and permissions
  are unchanged. `git diff --check` passes. Generated archives are not committed.
- Inspected Chromium Settings, Library creation focus and author Follow control,
  plus Firefox Settings and narrow author-header captures. Existing UI stays
  restrained and functional. No new Sync/support UI is claimed or screenshot-tested.

No account credentials, normal browser profile, proprietary service, push, store
upload or signing was used. These results verify the audit and retained behavior;
they do not fulfill strict authority-ordered library synchronization.
