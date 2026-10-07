# Architecture

Portable transfer is a repository-level scoped merge. Bookmarks and Following are
separate ownership categories: importing one must not change the other or
preferences. Version-2 files declare the category and All/collection selection;
version-1 combined files are read with an explicitly selected category. Neither
the raw schema-5 envelope nor Sync v1 records are portable files.

## Shared desktop extension client

```text
arXiv content quick actions ─┐
popup launcher ──────────────┤
Library / Following / Author ├── RepositoryClient ── runtime messages ── LocalRepository
Search result bookmarks ─────┘                                      │
                                                                  storage adapter
                                                                       │
                                                    schema-5 browser-local view
                                                                       │
                                            Chrome only: sync record projection
                                                                       │
                                                           native storage.sync

Author page / Search page ── arXiv paper service ── export.arxiv.org Atom API
                                      │
                     pure query building + result normalization
```

The arXiv content module integrates bookmark and author-follow controls and narrowly
recognizes abstract-page author-search anchors. An ordinary primary activation sends
the displayed author name to a validated background navigation handler, which opens
the existing `author/` page in a new tab. Modified and middle activations retain the
original arXiv href. The author page reconstructs a transient name-key reference
when no followed record exists, then uses its existing query, cache, filters, paper
rows and save actions. Viewing never calls `followAuthor`. The name key can combine
namesakes; neither arXiv's abbreviated search query nor the displayed name verifies
a person. Unrecognized links navigate normally. The
popup owns counts and navigation. Browsing and management live in full extension
tabs: `library/`, `authors/`, `author/`, and `search/`.

The popup is navigation-only; its gear opens a minimal Settings page. Library and
Following expose the same page through compact header gears. There are no separate
page settings stores or panels. Preferences
are persisted through `RepositoryClient` with the rest of the settings. Extension-owned arXiv
anchors omit `target` by default and use `_blank` only when that preference is
enabled, preserving native modifier-click behavior.

The default author interaction is deliberately binary: Follow and Following.
Following removes all memberships on unfollow. Author-collection data and
repository methods remain intact and their picker is exposed only by an opt-in
preference; disabling it never mutates collection data. Paper collections remain user-facing through the Library sidebar, with
progressive disclosure for creation and management. Search exists but is absent
from primary navigation.

All persistence crosses the asynchronous `PaperRepository` contract. UI modules
instantiate only `RepositoryClient`; the background context owns the sole
`LocalRepository`. `extension/src/lib/storage.js` is the only module that accesses
browser storage areas. The handler validates a method allowlist and
argument counts. LocalRepository serializes reads, migrations, and writes to avoid
local read-modify-write races.

The internal `favorites` array remains the canonical paper-record compatibility
layer. Schema v5 adds `paperCollections` and `paperMemberships`; membership is the
single definition of saved state. Schema migrations validate the complete result
before one replacement write and preserve unknown fields.

## Records and services

Schema 5 keeps canonical saved papers, paper collections and memberships, authors,
author collections and memberships, independent last-used settings, and author
paper caches in one local envelope. Cache records are external
search results rather than user-owned saved records. Explicitly bookmarking a
result creates a canonical Paper through `savePaper`; refreshing a cache can
therefore never erase notes or saved state.

## Portable import/export

Settings sends `exportCategory` and `importCategory` through the same
RepositoryClient/RPC boundary. The Export dialog gets collection names through
ordinary repository reads. `repository/portable-library.js` projects scoped
version-2 `xivary-library` documents; the legacy combined version-1 reader remains
for selected-category imports. It validates the entire untrusted document, merges
only the selected category into a detached clone, then LocalRepository validates
the proposed schema-5 result and submits one repository state write. The sync storage decorator,
when present, sees one ordinary desired-state change and projects it normally.

Caches, last-used pointers, envelope extensions and sync bookkeeping never enter
the portable projection. The merge retains local-only state and shared collection
name collision handling lives in `repository/collection-names.js`. Format and
merge details are documented in [import-export.md](import-export.md).

## Browser platform boundary

`platform/browser-api.js` selects the native Promise API namespace (`browser`,
falling back to `chrome`) lazily. The repository client, storage adapter,
background entry point, and popup depend on it; Settings already uses only the
repository. Native API objects retain their receivers and Promise rejections.
No polyfill, framework, transpiler, or bundler is required. The classic manifest
content loader in `platform/content-loader.js` must resolve an extension URL before
it can import an ES module, so its initial namespace selection is the sole
bootstrap exception, kept within the platform directory.

The existing message channel, sender validation, callback response plus `true`
keepalive, and serialized LocalRepository operations are unchanged. Firefox runs
`background/service-worker.js` as a module event page via `background.scripts`;
Chromium runs it as a module service worker. Neither context relies on its memory
for persistence. Only `lib/storage.js` opens storage areas; the local adapter's older
`ChromeLocalStorage` export remains an alias for compatibility with existing tests.

`extension/manifest.json` is the common source and still works directly for
Chromium Load unpacked. `scripts/browser-manifest.mjs` generates the Firefox
background declaration and Gecko metadata, removing the Chrome minimum-version
key. Packaging copies the shared runtime tree and replaces only manifest data.
Firefox has a stable add-on ID and a desktop minimum of 140, including support for
its built-in data-transmission declaration. Existing arXiv queries are declared as
`searchTerms`. Firefox remains local-only, and its package omits Chrome's sync
retry alarm permission.

Installing in Chrome and Firefox creates independent local libraries. The storage
key, schema version, IDs, migrations, and repository operations are unchanged.
Chrome synchronization is a separate layer described below; there is no backend. See
[browser support and verification](browser-support.md) before claiming runtime
support and the distinction between fixture, live-network and account evidence.

## Chrome synchronization

The background chooses a `SyncStorage` decorator beneath `LocalRepository` only
for the Chromium service-worker package. UI/RPC/domain operations are unchanged.
The decorator reuses exported `prepareState` for existing migrations/validation;
`sync-model.js` projects and merges version-1 per-record registers. Local schema 5
is not the wire format. All local operations still use the same repository queue.
That queue is not a cross-device lock.

The local envelope's `_chromeSync` field atomically retains identity, logical clock,
winning records, pending/retry information and a pre-sync snapshot with each domain
write. Local storage succeeds before best-effort publication. `storage.onChanged`
feeds incoming old/new records into the same queue; the worker also reconciles at
startup and on one-shot retry alarms. Writes are coalesced, capped below documented
rates and checked against size/item quotas. There is no steady-state polling.

Collection/membership null records and collection generations prevent replay from
reviving old relationships. Membership is still the definition of saved/followed
state. The full conflict/partition/bootstrap policy is in [chrome-sync.md](chrome-sync.md).
Only `openArxivLinksInNewTab` and `organizeFollowedAuthorsIntoCollections` are
preference registers; both last-used collection pointers remain local. Old v1
replicas missing preference registers seed only absent local/remote keys at revision
zero after validated reconciliation, without resetting library records.
Full saved metadata and caches remain local; newly received papers get enough
display metadata for offline rows. Local fields and unknown fields on retained
records survive. Author, Settings, Library, Following and arXiv surfaces refresh
repository state on focus; popup/reopened pages load fresh state. No UI listens
to sync storage. The hidden Search page refreshes saved state when searching.

The reusable arXiv service maps an author identity to a name query, builds API
queries, normalizes Atom entries into a Paper-like result, and defines the 24-hour
freshness rule. Browser navigation uses the platform boundary; DOM rendering stays in page modules.
The field expansion modules are also pure and deterministic. These contracts can
be ported to a backend or mobile client without Chrome storage or UI types.

Direct result retrieval uses the public arXiv Atom endpoint under the manifest's
single host permission. Search retains an equivalent native arXiv URL but is
currently hidden from primary navigation. Author feeds defensively require one
returned author to match the selected normalized full name; namesakes remain an
explicit limitation. ORCID linking is future work.

## Repository contract

Alongside paper-collection and author-collection operations, the repository exposes
`getAuthorPaperCache(authorId)` and `putAuthorPaperCache(cache)`. Follow operations
are fast and never fetch. Cache writes and saved-paper writes remain distinct.
Paper and author collections deliberately use separate records and last-used IDs.
Their JSON-compatible IDs and join records can cross a future REST API unchanged;
any future backend would need its own explicit compatibility design.

Paper note UI is deferred. The legacy-compatible Paper shape is not expanded and
no note control or migration is part of the current product surface.

## Future system

```text
Chromium extension   Android   iPad/iOS   Web app
         \              |        |         /
          +-------------+--------+--------+
                         |
                  HTTPS REST/JSON API
                         |
                     PostgreSQL
```

The future API owns authentication, conflict handling, tombstones, and server-side
ordering. Clients will not connect directly to PostgreSQL. No provider-specific
cloud SDK is assumed; the backend can run on Linux or a Raspberry Pi. None of that
custom-backend, mobile, embedding, or semantic-search work is implemented here.
