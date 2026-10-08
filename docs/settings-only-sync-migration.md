# Settings-only Chrome Sync cutover

## Investigation and strategy, before implementation

Starting HEAD: `f33a925dd812ad04005cb864d7aae0defbb605e4`, clean `master`,
three commits ahead of origin. Baseline: 135/135 Node tests pass.

Previously `sync-model.js` projected `p/a/pc/ac/pm/am/s` records and reconstructed
the library from their merged registers. `SyncStorage` validated every prefixed
remote/observed/local replica record, merged them and published retained winners.
LocalRepository first validated/migrated schema 1–5; manual portable imports passed
through the same decorator and consequently uploaded their library changes.

The cutover is a narrower interpretation of the existing Sync v1 preference
registers, not a new protocol or local schema migration:

1. Only the exact canonical keys for `openArxivLinksInNewTab` and
   `organizeFollowedAuthorsIntoCollections` may project, validate, merge,
   materialize, advance the active clock from remote input or publish.
2. Preserve the entire current local library, metadata, memberships, local
   last-used pointers, caches and unknown fields. Even previously downloaded
   library data stays local: provenance cannot safely distinguish it from edits.
3. Retain old local replica library records and bootstrap snapshots as inert
   bookkeeping, without validation/merge/publication. Retain replica identity and
   logical counter; existing preference winners and pending edits keep revisions.
   New replicas snapshot only eligible preferences. No automatic reset or cleanup.
4. Ignore all other remote keys/events, including legacy library records,
   tombstones, malformed legacy records, unsupported legacy versions and unknown
   preferences. They cannot restore, delete, rename or overwrite local entities.
   Do not remove, tombstone, rewrite or republish any of those remote keys.
5. Validate known preference records strictly. A malformed/unsupported active
   preference pauses synchronization and retains local intent and remote bytes.
   Existing bootstrap/conflict/retry semantics remain: remote overlaps win initial
   revision-zero seeds, independent booleans merge by logical revision/replica,
   local desired state commits before best-effort publication.
6. An older replica missing preference registers merges valid remote preferences
   first, then seeds only absent keys at revision zero. Repeated read/restart is
   idempotent. Empty/fresh installations receive preferences, never a library.
7. Manual Bookmarks/Following All/collection imports and exports remain unchanged
   and local; preferences remain excluded. Firefox remains local-only.

Schema 5, migrations 1–5, Sync v1 preference key/value encoding, portable v2 and
permissions are unchanged. Old library records may occupy Chrome Sync quota;
quota failures leave preferences local and pending. No quota-driven deletion.
Older extension versions may still synchronize library data among themselves;
updated installations ignore it. This update does not promise retroactive remote
erasure. Any future cleanup would require a separate explicit user decision.

There is no unresolved decision needed for this nondestructive cutover. Removal
of old remote or already-restored local data is deliberately outside its scope.

## Verification record — 2026-10-08

- **135/135 Node tests pass**, including 40 independent-repository Sync simulations
  and 15 portable-file tests. Obsolete library propagation expectations are replaced
  by explicit non-propagation and legacy-cutover tests; preference recovery and
  conflict coverage remains. All local migrations and portable legacy formats pass.
- **Chrome 154 / Firefox 157 smoke pass** with Following/Library/Settings and
  content/UI workflows. Firefox remains local-only.
- **Chrome release suite passes**: existing local legacy replica and untouched
  remote library records, fresh profile preference-only restoration, native category
  imports without library upload, real onChanged, deferred pending/alarm/worker,
  extension reload and full profile restart. Peer records are test-authored in
  unsigned-in disposable profiles, not real account propagation.
- **Both 60-file packages pass** source/manifest comparisons, version 0.2.0; no
  schema, permission, dependency or portable-format change. Archives stay ignored.
- Account-mediated preference propagation/library non-propagation, minimum versions,
  signed Firefox installation/restart and native Firefox transfer remain manual
  release checks. No account credentials, signing, publishing or push is automated.
