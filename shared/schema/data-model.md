# Shared data model (schema version 1)

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

`2401.00001v2` and `2401.00001v3` both identify `2401.00001`.
Legacy identifiers retain their archive prefix, for example `hep-th/9901001`.
URLs are generated from the ID, not trusted from arbitrary page links. They point
to the latest revision. Saving another revision toggles the existing favorite;
there is only one favorite per paper. Unfavorite removes the record; saving again
starts fresh timestamps and default user metadata. Editing user metadata is not
part of this MVP.

## AuthorReference and Author

Each entry in `Paper.authors` is an AuthorReference:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Versioned, deterministic reference key described below |
| `displayName` | string | Visible author name, NFKC with whitespace collapsed |
| `normalizedName` | string | Normalization v1, for comparison; **not unique** |
| `sourceArxivId` | string | Unversioned paper that supplied this reference |
| `sourceAuthorIndex` | integer | Zero-based position within that paper's authors |

A followed Author has all those fields plus:

| Field | Type | Meaning |
| --- | --- | --- |
| `followedAt` | ISO timestamp | When this reference was followed |
| `updatedAt` | ISO timestamp | Last record change; initially equals `followedAt` |

`Paper.authors` does not embed follow timestamps; favorites and follows have
independent lifetimes.

### Normalization and identity strategy v1

1. Apply Unicode NFKC to the display name.
2. Trim leading/trailing whitespace and collapse each internal whitespace run
   to one ASCII space.
3. Use JavaScript `toLowerCase()` (locale-independent Unicode lowercasing).
4. Preserve punctuation, initials, accents and name order. Do not transliterate,
   remove diacritics, expand initials, or infer surname order.

For example, `  Ａlex  KIM ` becomes `alex kim`; `Renée Smith` and `Renee Smith`
remain different. Prefer visible page names because citation metadata sometimes
reverses given/surname order. Metadata is an extraction fallback only.

The reference ID is:

```text
arxiv-author:v1:{sourceArxivId}:{sourceAuthorIndex}:{encodeURIComponent(normalizedName)}
```

Example: `arxiv-author:v1:2401.00001:0:alex%20kim`.

The source paper, author position and normalized name together identify an
**occurrence**, not a globally verified person. This is deliberate: two people
can share a name, and arXiv author-search URLs are not unique person identifiers.
Duplicate names at different positions also remain separate. An unchanged author
at the same position across paper revisions has the same ID. A name or author
order change may produce a new reference. The same person on different papers
has separate references and separate follows until a future explicit identity
resolution feature links them. Existing keys must not be silently regenerated
when normalization rules change; such a change needs a versioned migration.

## Local persistence

The `arxivResearchLibrary` key in `chrome.storage.local` holds:

```json
{
  "schemaVersion": 1,
  "favorites": [],
  "following": []
}
```

Only an absent storage key creates an empty library. An unsupported envelope
version or invalid record produces an error rather than resetting the library.
Unknown fields are preserved on retained records. Writes replace the envelope
through one serialized repository instance. Lists are returned as detached copies.
The collection is intentionally simple for this MVP; a larger local library may
need indexed or per-record storage and a migration.

## Future additions, not current behavior

- `version`: per-record revision, separate from envelope `schemaVersion`.
- `deletedAt`: nullable timestamp/tombstone for deletions awaiting sync.
- Verified person identifiers and explicit links between author references.
- Server-assigned change cursors and conflict-resolution metadata.

Current hard deletes and device-clock `updatedAt` values do not implement sync.
Before enabling sync, define version ownership, conflict handling, migration,
retention and deletion acknowledgment. Keep primary keys stable through that work.
