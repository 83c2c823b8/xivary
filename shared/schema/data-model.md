# Shared data model (schema version 2)

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
| `id` | string | Canonical name key described below; independent of paper/position |
| `displayName` | string | Original visible author name, preserving case and punctuation |
| `normalizedName` | string | Name-key normalization v1; **not a verified person identity** |
| `sourceArxivId` | string | Unversioned paper that supplied this reference |
| `sourceAuthorIndex` | integer | Zero-based position within that paper's authors |

A followed Author has only `id`, `displayName`, `normalizedName` and the following
timestamps. Paper provenance remains metadata on paper references and never
contributes to follow identity:

| Field | Type | Meaning |
| --- | --- | --- |
| `followedAt` | ISO timestamp | When this canonical author name was followed |
| `updatedAt` | ISO timestamp | Last record change; initially equals `followedAt` |

`Paper.authors` does not embed follow timestamps; favorites and follows have
independent lifetimes.

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

## Local persistence

The `arxivResearchLibrary` key in `chrome.storage.local` holds:

```json
{
  "schemaVersion": 2,
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

### Migration from schema 1

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
5. Persists the library with `schemaVersion: 2`. Favorites (including embedded
   legacy author references) and unrelated envelope fields are left unchanged.

The write completes before the requested operation proceeds. Invalid data or a
failed migration write rejects the request without replacing the stored library;
the next request can retry. Schema 2 reads do not repeat migration. New paper
references use canonical author keys; old embedded references remain display-only
metadata and are never used to look up follow state. The original pre-normalization
spelling of legacy display names cannot be recovered if the old code changed it.

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
