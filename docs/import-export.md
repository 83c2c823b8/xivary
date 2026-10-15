# Portable research backups

Settings → Data has Export All / Import All plus the existing Bookmarks and
Following actions. Export All downloads **one ZIP**. Section exports download a
ZIP; the Include selector offers only All bookmarks / All following and a
Collections group. Selecting a collection exports self-contained JSON, including
empty collections. Options use stable collection IDs, not display names.
Installed storage upgrades happen automatically; portable import is never needed
after a normal extension update. See [upgrade safety](storage-migrations.md).

Import accepts a full ZIP, section ZIP, collection JSON, bookmark JSON,
Following JSON, or multiple individual JSON files in one operation. Category
Import applies only that category, even from a full backup. All Import applies
all included sections. There is no Preferences transfer or PDF transfer.

## Version 3 structure

The independent portable format is `xivary-library`, version **3**, separate from
local schema 8, Chrome Sync v1, and extension version 0.5.1. The new transfer UI
accepts version 3 only; unsupported/older versions fail clearly. Internal v1/v2
repository methods remain for existing regression coverage, without migration
into the new format.

```text
xivary-backup/
  manifest.json
  ordering.json
  bookmarks/<sha256>.json
  following/<sha256>.json
  collections/<sha256>.json
```

Every bookmark, explicitly followed author, and paper/author collection has its
own UTF-8, indented JSON file. SHA-256 filenames derive from record type,
category and stable identity, never user names. The manifest has `format`,
`version`, `exportedAt`, `sections`, `selection`, `counts` and `files`. Each file
entry declares `path`, `type`, `category` and `id`; paths and IDs must agree.
Counts specify `bookmarks`, `following` and `collections`.

Each record file is an envelope with exactly:

```json
{
  "format": "xivary-library",
  "version": 3,
  "type": "collection",
  "category": "bookmarks",
  "record": {
    "id": "paper-collection:example",
    "name": "My Geometry",
    "createdAt": "2026-10-15T00:00:00Z",
    "updatedAt": "2026-10-15T00:00:00Z"
  },
  "memberships": [
    {
      "arxivId": "2610.12279",
      "collectionId": "paper-collection:example",
      "addedAt": "2026-10-15T00:00:00Z",
      "updatedAt": "2026-10-15T00:00:00Z"
    }
  ]
}
```

Types are `bookmark`, `following`, or `collection`; categories are `bookmarks` or
`following`. Only collection envelopes carry memberships. Author memberships use
`authorId` in place of `arxivId`. Stable IDs preserve shared membership without
duplicating a bookmark in the ZIP. An individual JSON document contains
`format`, `version`, `exportedAt`, `sections`, `selection`, `records` and `ordering`.
Its records use the same envelopes. A collection JSON includes its member records
and only its own memberships. An individual bookmark/Following JSON includes that
record and its collection records, with only that record's memberships. Thus
individual imports are self-contained. Missing references reject the whole import;
incomplete memberships are never silently invented.

The executable validator in `repository/portable-backup.js` is authoritative.
It validates all record types, identities, timestamps, field sets, references,
selections and ordering before any mutation. The JSON field schema is:

- Bookmark: `arxivId`, `title`, full `authors` provenance, `savedAt`, `updatedAt`,
  `tags`, `note`, `read`, `categories`, `abstract`, `publishedAt`. Supported optional
  custom fields are `customTitle`, `customName`, `displayName`, `originalTitle`,
  `originalMetadata`, `userMetadata`, `metadataEdits`.
- Following: `id`, `displayName`, `normalizedName`, `followedAt`, `updatedAt`;
  optional `alias`, `aliases`, `customName`, `originalName`, `identity`,
  `searchIdentifiers`. Identity remains Xivary's existing name key, with its
  documented namesake limitation. No verified identity is inferred.
- Collection: `id`, `name`, `createdAt`, `updatedAt`; optional `customName`, `alias`.
  Existing hidden author collections are preserved alongside paper collections.
- Author references contain `id`, `displayName`, `normalizedName`,
  `sourceArxivId`, `sourceAuthorIndex`; provenance is validated without a lookup.
- Custom-name fields are strings; aliases are string arrays; custom metadata and
  identity/search extensions are bounded JSON objects. Unknown record fields
  reject on import, and export projects only the documented fields.

The current UI edits collection names, stores paper titles directly, and has no
separate bookmark-title/Following-alias editor. Backup preserves existing titles
and names exactly; supported stored original/custom metadata stays distinguishable.
It never substitutes newly fetched arXiv metadata. Existing note/read/tag fields
are retained without exposing new note controls.

## Explicit ordering

`ordering.json` has exactly `bookmarks`, `following`, `paperCollections`,
`authorCollections`, `papersByCollection`, `manualPaperCollections`, and optional
`authorsByCollection`:

```json
{
  "bookmarks": ["2610.12279"],
  "following": [],
  "paperCollections": ["paper-collection:example"],
  "authorCollections": [],
  "papersByCollection": [
    { "collectionId": "paper-collection:example", "paperIds": ["2610.12279"] }
  ],
  "manualPaperCollections": ["paper-collection:example"],
  "authorsByCollection": []
}
```

Arrays use stable IDs, never ZIP/filesystem ordering. Library's existing array
order, collection sidebar order and independent manual paper order round-trip
exactly into a fresh profile. `manualPaperCollections` distinguishes actual manual
orders from fallback display order. `following` preserves the global manual
author order (the live subsequence of the local author array); section and collection
exports retain its relevant subsequence. Fresh imports restore that order exactly.
Existing profiles keep their own author order and append new imported authors.
The optional `authorsByCollection` array contains explicit
`{collectionId, authorIds}` orders for Following collections. It is validated against
that collection's exported memberships; missing/duplicate/foreign author IDs reject
before any write. Its absence in an existing v3 backup means no manual overrides.
Full/Following/collection exports include the relevant orders; fresh imports restore
them exactly. Existing collection order wins and new members append; unrelated
collection/global orders remain unchanged. Bookmarks-only import never touches
Following orders.
There are no persistent sorting preferences or manual author-paper ordering systems
in the current application. Transient text/date filters are not
preferences and are not exported.

## Conservative merge and atomic commit

Canonical arXiv IDs detect duplicates, including versioned IDs and legacy IDs.
Following uses stable name identities. Existing nonempty fields win conflicts;
absent/empty custom names or metadata can be restored from imported records.
An imported custom title can replace a destination title only when explicit
original-title evidence shows that the destination title is uncustomized. Without
that evidence, its title wins. Tags merge by union. Existing customized collection names win for matching IDs;
new collections with colliding names receive a deterministic `(2)`, `(3)` suffix
while retaining their own IDs and memberships. No stored record is refetched.

Memberships merge by stable entity/collection pair. Existing order remains in
place, and new IDs append in imported order; unrelated entries are not rearranged.
A fresh profile replaces only the untouched empty factory paper collection when
restoring Bookmarks, then restores imported IDs and ordering. Last-used pointers
are excluded and repaired locally if necessary. Existing caches, preferences and
Offline storage remain intact.

Equivalent duplicate records across selected JSON files merge once, with skipped
records reported. Conflicting duplicate record or membership definitions reject
the batch. Every file is parsed and validated before the serialized repository
mutation, which validates the full proposed local state and performs **one local
write**. Invalid data or a failed write does not partially apply a batch. Settings
reports imported, merged, skipped and invalid counts, plus conflicting fields;
a rejected batch displays its reason and states that no records were imported.
Reimporting an identical backup is idempotent.

## Exclusions and limits

No PDF bytes, Feed entries, inferred coauthors, evidence caches, API results,
preferences, last-used settings, Chrome Sync records/replica revisions, tokens,
secrets, machine paths, or runtime state enter the backup. Only current explicit
Following memberships are exported. Portable imports remain local and never
publish Bookmarks, Following, collections, memberships or ordering to Chrome Sync.
Preferences continue through their existing dedicated path.

ZIP exports use the standard stored method; imports support stored and Deflate.
The small local transport checks central/local headers, paths, duplicate names,
contiguous records, CRCs and declared/actual sizes. Traversal, absolute paths,
unknown entries, ambiguous paths, symlinks, encryption, split archives, ZIP64 and
unsupported extra fields/compression methods are rejected. No archive contents
execute, extract to disk, or cause remote requests. JSON values reject prototype
keys and nonportable sensitive field names and limit nesting to 12 levels.

Limits: 20 MiB per backup and per selected batch (both archive/input bytes and
expanded JSON), 1 MiB per JSON file, 5,000 unique records, and 5,002 JSON ZIP
entries. Individual collection JSON exceeding 1 MiB must use a section ZIP.
These are deliberate local memory/message budgets. Arbitrary third-party ZIP
layouts are not supported; a compliant Xivary backup is the portability target.

## Verification

`tests/portable-backup.test.js` exercises complete/section/individual/multi-file
round trips, customization, Unicode, shared memberships, order, canonical IDs,
existing-profile conflict handling, category isolation, malformed data, missing
references, unsupported versions, atomic failure and malicious ZIP structures.
It checks standard Deflate input and stored ZIP compatibility with unzip.
Two-device Sync tests ensure transfer/reordering remain local while designated
preferences still propagate through the simulated transport.

`node scripts/backup-smoke.mjs` installs the production build in disposable Chrome,
uses Settings' real Export All download and native file chooser in a clean second
profile, and verifies names/custom fields, organization/order, repeat import,
restart, no restore-time arXiv requests, no research-data Sync upload, preserved
independent PDF bytes, normal Library/Following/Feed/Offline views, and 360px Settings.
Screenshots are in `/tmp/xivary-backup-screenshots`. `npm run test:release` retains
native scoped transfer and Chrome Sync event/alarm/worker/restart checks. These
fixtures do not prove Google-account propagation or physical screen-reader speech.

The separate last-selected Library collection UI preference is not exported or
imported. It is distinct from explicit manual collection/paper ordering.

Following collection sidebar order uses the existing `ordering.authorCollections`
array. Full and Following-section restores preserve it exactly in a fresh profile.
The last-selected Following collection UI preference is excluded, independently
of Library's selection; importing never changes either destination preference.
