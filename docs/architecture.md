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

All persistence crosses the asynchronous `PaperRepository` contract. UI modules
instantiate only `RepositoryClient`; the MV3 worker owns the sole
`LocalRepository`. `extension/src/lib/storage.js` is the only module that accesses
`chrome.storage.local`. The worker validates a method allowlist and argument counts,
and serializes reads, migrations, and writes to avoid local read-modify-write races.

The internal `favorites` name and methods remain as a compatibility layer, while
all visible language says Saved Papers and Library. Schema migrations validate the
complete result before one replacement write and preserve unknown fields.

## Records and services

Schema 4 keeps canonical saved papers, authors, author collections, memberships,
settings, and author paper caches in one local envelope. Cache records are external
search results rather than user-owned saved records. Explicitly bookmarking a
result creates a canonical Paper through `toggleFavorite`; refreshing a cache can
therefore never erase notes or saved state.

The reusable arXiv service maps an author identity to a name query, builds API
queries, normalizes Atom entries into a Paper-like result, and defines the 24-hour
freshness rule. Chrome-specific navigation and DOM rendering stay in page modules.
The field expansion modules are also pure and deterministic. These contracts can
be ported to a backend or mobile client without Chrome storage or UI types.

Direct result retrieval uses the public arXiv Atom endpoint under the manifest's
single host permission. Search always exposes the equivalent native arXiv URL.
Author matching currently uses canonical display names, so namesakes remain an
explicit limitation. ORCID linking is future work.

## Repository contract

Alongside saved-paper and author-collection operations, the repository exposes
`getAuthorPaperCache(authorId)` and `putAuthorPaperCache(cache)`. Follow operations
are fast and never fetch. Cache writes and saved-paper writes remain distinct.

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
