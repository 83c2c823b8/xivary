# Architecture

## Implemented MVP

```text
arXiv content UI ─┐
                 ├─ RepositoryClient (PaperRepository contract)
Extension popup ─┘          │ Chrome runtime JSON messages
                           v
                  MV3 service worker
                           │ validated method allowlist
                           v
                  LocalRepository
                           │ storage adapter
                           v
                  chrome.storage.local
```

UI code only invokes the asynchronous `PaperRepository` methods. A
`RepositoryClient` carries those calls to the worker. The worker creates exactly
one `LocalRepository`, backed by `ChromeLocalStorage`. Only
`extension/src/lib/storage.js` accesses Chrome's storage API. The content script
is a small classic-script bootstrap that imports ES modules; its module graph is
declared web accessible only to the arXiv origin. There is no bundler, framework,
remote script loading or application HTTP request.

The worker accepts same-extension messages on a versioned channel, allows only
the six repository operations, checks argument counts and validates domain data
before saving. Page text is treated as text, never HTML. Abstract and PDF links
are derived from validated arXiv identifiers. The only extension API permission
is `storage`; content injection is restricted to HTTPS arXiv abstract pages.
Implementation follows Chrome's [content script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
and [message passing documentation](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

Repository contract (all methods return promises):

| Method | Result |
| --- | --- |
| `listFavorites()` | `Paper[]`, newest saved first |
| `listFollowing()` | `Author[]`, newest followed first |
| `toggleFavorite(paper)` | Saved `Paper`, or `null` after removal |
| `removeFavorite(arxivId)` | No value; idempotent |
| `toggleFollow(authorReference)` | Saved `Author`, or `null` after removal |
| `unfollowAuthor(id)` | No value; idempotent |

Errors reject the promise and appear in the UI. An unsuccessful write never
produces a successful toggle response. Read and write operations share a queue
in the worker, preventing interleaved read-modify-write races across tabs and the
popup. A failed operation does not block later operations. Storage is read on
every operation; the worker keeps no authoritative in-memory cache, so worker
suspension or restart does not discard saved state. This queue is only an
in-process concurrency mechanism, not a distributed lock. Additional writers
must not instantiate their own repository in UI contexts.

The popup loads when opened and can refresh explicitly. Page buttons refresh
when the window receives focus or the document becomes visible. There is no
cross-window realtime event stream. Favorites and following are separate
collections; deleting a favorite does not unfollow its authors.

## Future system — not implemented

```text
Chromium extension
        |
        | HTTPS / REST / JSON
        v
Shared backend API ----------------> PostgreSQL
        ^                                 ^
        | HTTPS / REST / JSON             |
        |                         periodic arXiv polling
   Android app                            |
                                     notifications
```

Both clients use the REST/JSON API. Neither connects directly to PostgreSQL.
The shared backend owns database access, future authentication and future
background jobs. Deploy it on an ordinary Linux machine or Raspberry Pi using
a standard application process, PostgreSQL and an HTTPS reverse proxy. Hosting
provider, container runtime and programming language remain open choices.
No Firebase, Supabase or proprietary cloud SDK is assumed by the client contract.

At the worker composition root, a future `HttpRepository` can implement the same
contract, or a synchronizing repository can combine local persistence and remote
HTTP operations. Existing UI calls remain unchanged. A remote toggle must be
implemented atomically on the server; automatic retries require idempotency
semantics to avoid toggling twice. This MVP does not retry mutations automatically.

Records are plain JSON, use explicit timestamps and stable keys, and live in a
versioned storage envelope. An explicit migration can add per-record `version`
and `deletedAt` fields without restructuring the UI/domain boundary. Current
removals are hard deletes; before synchronization exists they must become
tombstones, with a defined conflict-resolution and acknowledgment strategy.
Client clock timestamps alone are not sufficient for distributed ordering.

Author identity resolution must remain separate from display-name normalization.
Future verified identifiers (for example ORCID) and explicit reference-to-person
links can unify occurrences without changing existing saved reference IDs. Do
not silently merge historical records using normalized names.

Backend, authentication, synchronization, Android, polling and notifications
remain future work. The repository contains no implementation of these features.
