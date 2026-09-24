# Shared data model (schema version 5)

The extension stores JSON-compatible objects. Timestamps are UTC ISO 8601 strings
generated on save, such as `2026-09-24T01:02:03.000Z`. The same record shapes can
later cross a REST/JSON API; they have no Chrome or cloud-provider types.

## Paper

| Field | Type | Meaning |
| --- | --- | --- |
| `arxivId` | string | Primary key: unversioned modern or legacy arXiv ID |
| `title` | string | Nonempty title, NFKC-normalized with whitespace collapsed |
| `authors` | AuthorReference[] | Ordered references, preserving the author list |
| `absUrl` | string | `https://arxiv.org/abs/{arxivId}` |
| `pdfUrl` | string | `https://arxiv.org/pdf/{arxivId}` |
| `savedAt` | ISO timestamp | When this favorite was created |
| `updatedAt` | ISO timestamp | Last record change; initially equals `savedAt` |
| `tags` | string[] | Defaults to `[]`; trimmed, nonempty, unique strings |
| `note` | string | Defaults to `""` |
| `read` | boolean | Defaults to `false` |
| `categories` | string[] | arXiv categories when available; defaults to `[]` |
| `abstract` | string | arXiv abstract when available; defaults to `""` |
| `publishedAt` | ISO timestamp or null | arXiv publication date when available |

`2401.00001v2` and `2401.00001v3` both identify `2401.00001`.
Legacy identifiers retain their archive prefix, for example `hep-th/9901001`.
URLs are generated from the ID, not trusted from arbitrary page links. They point
to the latest revision. There is only one canonical record per paper regardless
of how many collections contain it. A paper is globally saved if and only if it
has at least one PaperCollectionMembership. Removing its final membership removes
the compatibility `favorites` record; saving again starts fresh timestamps and
default user metadata. Editing user metadata is not part of this MVP.

## PaperCollection and PaperCollectionMembership

Paper collections are separate from author collections. A PaperCollection has an
opaque `paper-collection:{UUID}` ID, normalized nonempty `name` (maximum 80
characters), and `createdAt`/`updatedAt` timestamps. Names are case-insensitively
unique but are never used as identifiers. The built-in default uses the stable ID
`paper-collection:saved-papers` and display name **Saved Papers**.

A PaperCollectionMembership contains `arxivId`, `collectionId`, `addedAt`, and
`updatedAt`. The `(arxivId, collectionId)` pair is unique. Adds are idempotent.
Papers may belong to any number of collections. Renaming changes no IDs or
memberships. Deleting a collection deletes only its memberships; papers that
remain in another collection remain saved. Papers left with no memberships are
globally unsaved. **All Saved** is a UI aggregate, not a stored collection.

## AuthorReference and Author

Each entry in `Paper.authors` is an AuthorReference:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Canonical name key described below; independent of paper/position |
| `displayName` | string | Original visible author name, preserving case and punctuation |
| `normalizedName` | string | Name-key normalization v1; **not a verified person identity** |
| `sourceArxivId` | string | Unversioned paper that supplied this reference |
| `sourceAuthorIndex` | integer | Zero-based position within that paper's authors |

A stored Author has `id`, `displayName`, `normalizedName` and the following
timestamps. Paper provenance remains metadata on paper references and never
contributes to follow identity:

| Field | Type | Meaning |
| --- | --- | --- |
| `followedAt` | ISO timestamp | First time this canonical author was followed; retained after unfollow |
| `updatedAt` | ISO timestamp | Last record change; initially equals `followedAt` |

`Paper.authors` does not embed follow timestamps; favorites and follows have
independent lifetimes. Authors persist after their final membership is removed.
`updatedAt` describes Author metadata, not membership changes. No ORCID discovery
is implemented; an optional future `orcid` can be metadata without replacing the
canonical name key.

### Canonical name-key strategy v1

1. Apply Unicode NFKC to the display name.
2. Trim leading/trailing whitespace and collapse each internal whitespace run
   to one ASCII space.
3. Map apostrophes U+2018, U+2019 and U+02BC to ASCII `'`; map dashes U+2010–U+2015
   and minus U+2212 to ASCII `-`. NFKC also normalizes fullwidth variants.
4. Use JavaScript `toLowerCase()` (locale-independent Unicode lowercasing).
5. Preserve other punctuation, initials, accents and name order. Do not
   transliterate, remove diacritics, expand initials, or infer surname order.

Only the key and `normalizedName` are normalized. `displayName` retains the original
input string, including case, Unicode punctuation and whitespace.

For example, `  Ａlex  KIM ` becomes `alex kim`; `Renée Smith` and `Renee Smith`
remain different. Prefer visible page names because citation metadata sometimes
reverses given/surname order. Metadata is an extraction fallback only.

The stable author key is:

```text
arxiv-author:name:v1:{encodeURIComponent(normalizedName)}
```

Example: `arxiv-author:name:v1:alex%20kim`. Neither paper ID, author position nor
other paper metadata is included. Page extraction computes this key; page rendering
compares it to IDs from `listFollowing()`. Following or unfollowing affects every
paper containing that canonical name. Existing open pages refresh on focus or
visibility, as before.

Namesakes share follow state under this approximation. Initials, reordered names
and spelling variants not covered by these rules remain separate. Verified person
identity and any future key changes require an explicit migration.

## AuthorCollection

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Opaque `collection:{UUID}`, independent of the name |
| `name` | string | NFKC/whitespace-normalized, nonempty, at most 80 characters |
| `createdAt` | ISO timestamp | Creation time |
| `updatedAt` | ISO timestamp | Creation or most recent rename time |

Duplicate collection names (case-insensitive after normalization) are rejected.
Names are display values and never membership keys. The migration's default
collection has reserved ID `collection:following`; newly created defaults get
UUID-based IDs like any other new collection.

## AuthorCollectionMembership

| Field | Type | Meaning |
| --- | --- | --- |
| `authorId` | string | References `Author.id` |
| `collectionId` | string | References `AuthorCollection.id` |
| `addedAt` | ISO timestamp | Membership creation time |
| `updatedAt` | ISO timestamp | Membership's last change; initially equals addedAt |

The `(authorId, collectionId)` pair is unique. Adds are idempotent and do not
reset timestamps on an existing membership. An author is followed if and only
if at least one membership exists. Removing a membership or deleting a collection
never deletes an Author entity. Removing all memberships globally unfollows the
author. These are local hard deletes, not sync tombstones.

## Settings

`lastUsedAuthorCollectionId` is an author collection ID or `null`. Creating a
collection or explicitly adding membership updates it; unchecking does not.
`followAuthor` does nothing if already followed, otherwise adds to last-used,
falling back to the first remaining collection. If none exist, it creates
Following. Deleting last-used selects the first remaining collection, or null.
Collection creation with an initial author saves both in one atomic repository
operation. The setting never holds a dangling collection ID.

`lastUsedPaperCollectionId` is independent. Creating a paper collection or adding
a paper to one updates it. A one-click save uses that collection, falls back to the
first paper collection, and recreates **Saved Papers** if none exists. Creating a
collection with a paper atomically creates both collection and membership.

## Local persistence

The `arxivResearchLibrary` key in `chrome.storage.local` holds:

```json
{
  "schemaVersion": 5,
  "favorites": [],
  "paperCollections": [{
    "id": "paper-collection:saved-papers",
    "name": "Saved Papers",
    "createdAt": "…",
    "updatedAt": "…"
  }],
  "paperMemberships": [],
  "authors": [],
  "collections": [],
  "memberships": [],
  "authorPaperCaches": [],
  "settings": {
    "lastUsedAuthorCollectionId": null,
    "lastUsedPaperCollectionId": "paper-collection:saved-papers"
  }
}
```

Only an absent storage key creates an empty library. An unsupported envelope
version or invalid record produces an error rather than resetting the library.
Unknown fields are preserved on retained records. Writes replace the envelope
through one serialized repository instance. Lists are returned as detached copies.
The collection is intentionally simple for this MVP; a larger local library may
need indexed or per-record storage and a migration.

## AuthorPaperCache

| Field | Type | Meaning |
| --- | --- | --- |
| `authorId` | string | Stable author key used for the feed |
| `papers` | PaperResult[] | Normalized external arXiv results |
| `fetchedAt` | ISO timestamp | Completion time of the arXiv request |
| `queryUsed` | string | Exact author query used for retrieval |

Caches use a centralized 24-hour TTL. A stale cache renders immediately and is
refreshed in the background. Cached results do not contain saved timestamps or
user notes and are not canonical saved-paper records. Bookmarking a result
explicitly creates a Paper through the repository.

### Migrations

#### Schema 1 identity migration (preserved)

Previously, follows used
`arxiv-author:v1:{sourceArxivId}:{sourceAuthorIndex}:{encodedNormalizedName}`.
This caused one person's follow state to differ by paper. On the first repository
operation after updating (including a list read), the sole worker repository:

1. Validates the existing library and legacy author IDs/timestamps.
2. Computes each follow's new key from its stored `displayName`, not its old ID.
3. Merges records with the same key. The earliest `followedAt` is retained; the
   latest `updatedAt` record supplies `displayName`, `updatedAt` and optional
   fields. Equal update timestamps keep the first stored record. Migration does
   not replace these timestamps with the migration time.
4. Removes `sourceArxivId` and `sourceAuthorIndex` from followed Author records.
5. Continues directly to the collection migration below. Favorites (including
   embedded legacy author references) and unrelated envelope fields are unchanged.

The write completes before the requested operation proceeds. Invalid data or a
failed migration write rejects the request without replacing the stored library;
the next request can retry. Schema 5 reads do not repeat migration. New paper
references use canonical author keys; old embedded references remain display-only
metadata and are never used to look up follow state. The original pre-normalization
spelling of legacy display names cannot be recovered if the old code changed it.

#### Schema 2 to 3 collections

On the first repository operation (including reads), existing `following` becomes
`authors` without changing its records or canonical IDs. Create exactly one
collection named Following (`collection:following`) and one membership per author.
Membership `addedAt`/`updatedAt` use the existing `followedAt`/`updatedAt`; collection
timestamps use migration time. Set last-used to that collection and remove the
old `following` property. Even an empty legacy library gets the empty default
collection. A genuinely new library starts empty and creates Following on demand.

Validate authors, collections, unique pairs, foreign keys, settings and favorites
before persisting the migrated envelope once. No partially migrated envelope is written. Failed
writes leave the old library intact; migration retries on the next operation.
Repeated reads/restarts never recreate collections or memberships. Retained
unknown record/envelope fields and all Favorites remain unchanged.

#### Schema 3 to 4 author paper cache

Schema 3 libraries receive an empty `authorPaperCaches` array. Existing saved
papers, authors, collections, memberships, settings, and unknown fields are
retained. Cache refreshes never change `favorites`.

#### Schema 4 to 5 paper collections

On the first repository operation, create exactly one **Saved Papers** collection
and one membership for every existing favorite. Membership timestamps reuse each
paper's `savedAt` and `updatedAt`; collection timestamps use migration time. The
paper records are not rewritten or duplicated. Set `lastUsedPaperCollectionId` to
the default while retaining the author setting and all author records,
memberships, caches, and unknown fields. The complete v5 envelope is validated
before one serialized replacement write. Failed writes leave v4 unchanged, and
subsequent v5 reads never repeat the migration.

Reload the extension and open arXiv tabs after updating so all UI contexts use the
new key format. No manual clearing or re-following is necessary.

## Future additions, not current behavior

- `version`: per-record revision, separate from envelope `schemaVersion`.
- `deletedAt`: nullable timestamp/tombstone for deletions awaiting sync.
- Verified person identifiers and explicit links between author references.
- Server-assigned change cursors and conflict-resolution metadata.

Current hard deletes and device-clock `updatedAt` values do not implement sync.
Before enabling sync, define version ownership, conflict handling, migration,
retention and deletion acknowledgment. Keep primary keys stable through that work.
