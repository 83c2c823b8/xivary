# Architecture

## Implemented Chromium client

```text
arXiv content quick actions ─┐
popup launcher ──────────────┤
Library / Following / Author ├── RepositoryClient ── runtime messages ── LocalRepository
Search result bookmarks ─────┘                                      │
                                                                  storage adapter
                                                                       │
                                                              chrome.storage.local

Author page / Search page ── arXiv paper service ── export.arxiv.org Atom API
                                      │
                     pure query building + result normalization
```

The arXiv content module only integrates bookmark and author-follow controls. The
popup owns counts and navigation. Browsing and management live in full extension
tabs: `library/`, `authors/`, `author/`, and `search/`.

The default author interaction is deliberately binary: Follow and Following.
Following removes all memberships on unfollow. Author-collection data and
repository methods remain intact for backward compatibility but have no default
UI. Paper collections remain user-facing through the Library sidebar, with
progressive disclosure for creation and management. Search exists but is absent
from primary navigation.

All persistence crosses the asynchronous `PaperRepository` contract. UI modules
instantiate only `RepositoryClient`; the MV3 worker owns the sole
`LocalRepository`. `extension/src/lib/storage.js` is the only module that accesses
`chrome.storage.local`. The worker validates a method allowlist and argument counts,
and serializes reads, migrations, and writes to avoid local read-modify-write races.

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

The reusable arXiv service maps an author identity to a name query, builds API
queries, normalizes Atom entries into a Paper-like result, and defines the 24-hour
freshness rule. Chrome-specific navigation and DOM rendering stay in page modules.
The field expansion modules are also pure and deterministic. These contracts can
be ported to a backend or mobile client without Chrome storage or UI types.

Direct result retrieval uses the public arXiv Atom endpoint under the manifest's
single host permission. Search retains an equivalent native arXiv URL but is
currently hidden from primary navigation. Author feeds defensively require one
returned author to match the followed normalized full name; namesakes remain an
explicit limitation. ORCID linking is future work.

## Repository contract

Alongside paper-collection and author-collection operations, the repository exposes
`getAuthorPaperCache(authorId)` and `putAuthorPaperCache(cache)`. Follow operations
are fast and never fetch. Cache writes and saved-paper writes remain distinct.
Paper and author collections deliberately use separate records and last-used IDs.
Their JSON-compatible IDs and join records can cross a future REST API unchanged;
sync will still require server versions and deletion tombstones.

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
sync, mobile, backend, embedding, or semantic-search work is implemented here.
